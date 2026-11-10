'use strict';

/*
 * A stand-in for the USB-C cable's vendor interface: one 519-byte feature report (id 0x06), no 20-byte output report.
 * A read is a SET_FEATURE with the read command followed by a GET_FEATURE; a GET on its own returns whatever the last
 * request left behind (nothing at the start). Built from what two open-source projects document about this cable, so it
 * proves the app does what that description says, not that a real keyboard agrees with it.
 */

const P = require('../src/js/protocol.js');
const K = require('../src/js/keys.js');
const L = require('../src/js/layout.js');
const { FakeHidDevice } = require('./fake-hid.js');

const BODY = P.FEATURE_LEN - 1; // 519: what the descriptor declares, without the report id

class CableKeyboard {
  /**
   * @param opts.serves   which blocks answer a read: any of 'led', 'rgb', 'colors', 'matrix' (default: all four)
   * @param opts.dropMatrixWrites  a keyboard that ignores writes to its key layers
   * @param opts.matrixBytes  length of each key layer the keyboard holds (default 512)
   * @param opts.layoutKeys   the layout's keys, for the factory key layers (default: the F75's)
   * @param opts.getFails number of GETs that fail first, as a device that is still busy does
   * @param opts.silent   never answers anything
   */
  constructor(opts = {}) {
    this.serves = new Set(opts.serves || ['led', 'rgb', 'colors', 'matrix']);
    this.dropMatrixWrites = !!opts.dropMatrixWrites;
    const keys = opts.layoutKeys || L.MODELS[0].keys; // the key table of the model being simulated
    const layerBytes = opts.matrixBytes ?? K.LAYER_SIZE; // a keyboard whose layers are shorter than 512 bytes
    this.layers = [K.defaultLayer(0, keys), K.defaultLayer(1, keys), new Uint8Array(K.LAYER_SIZE), new Uint8Array(K.LAYER_SIZE)].map((b) => b.slice(0, layerBytes));
    this.getFails = opts.getFails ?? 0;
    this.silent = !!opts.silent;
    this.feature = true; // marks the backend as a feature-report device for FakeHid.add
    this.led = new Uint8Array(P.LED_SIZE);
    this.led[0x7e] = 0x5a;
    this.led[0x7f] = 0xa5;
    P.setMode(this.led, 3);
    this.led[P.OFF.SLEEP] = 10;
    for (let slot = 0; slot < 19; slot++) {
      this.led[P.slotByte(slot, 0)] = 4;
      this.led[P.slotByte(slot, 1)] = (2 << 4) | 7;
    }
    this.rgb = new Uint8Array(P.WIRE.rgb.size); // 512, the first 420 bytes laid out like the dongle's table
    this.rgb.set(P.defaultRgb());
    this.colors = new Uint8Array(P.WIRE.colors.size); // 378 = 126 x 3, planar
    this.reply = new Uint8Array(BODY); // what a GET returns now
    this.sets = []; // every SET_FEATURE body received
    this.writes = []; // { block, size } for every write command
    this.gets = 0;
  }

  _block(name) {
    return { led: this.led, rgb: this.rgb, colors: this.colors }[name];
  }

  set(body) {
    this.sets.push(Uint8Array.from(body));
    if (this.silent) return;
    const cmd = body[0];
    const size = body[5] | (body[6] << 8);
    const byRead = { [P.WIRE.led.read]: 'led', [P.WIRE.rgb.read]: 'rgb', [P.WIRE.colors.read]: 'colors', [P.WIRE.matrix.read]: 'matrix' }[cmd];
    const byWrite = { [P.WIRE.led.write]: 'led', [P.WIRE.rgb.write]: 'rgb', [P.WIRE.colors.write]: 'colors', [P.WIRE.matrix.write]: 'matrix' }[cmd];
    if (cmd & 0x80) {
      if (!byRead || !this.serves.has(byRead)) return; // not supported: the last answer stays in place
      const layer = body[1];
      const data = byRead === 'matrix' ? this.layers[layer] : this._block(byRead);
      if (!data) return;
      const r = new Uint8Array(BODY);
      r[0] = cmd;
      r[1] = byRead === 'matrix' ? layer : 0; // the header echoes the layer
      r[3] = 0x01;
      r[5] = data.length & 0xff;
      r[6] = data.length >> 8;
      r.set(data, 7);
      this.reply = r;
      return;
    }
    if (!byWrite) return;
    this.writes.push({ block: byWrite, size, cmd, layer: byWrite === 'matrix' ? body[1] : undefined });
    const data = body.slice(7, 7 + size);
    if (byWrite === 'matrix') {
      if (!this.dropMatrixWrites && this.layers[body[1]]) this.layers[body[1]] = data;
      return;
    }
    if (byWrite === 'led') {
      if (data[P.OFF.APPLY] === 1) return; // a config that still carries the apply flag is ignored, as on the dongle
      data[P.OFF.APPLY] = 1;
      this.led = data;
    } else if (byWrite === 'rgb') this.rgb = data;
    else this.colors = data;
  }

  get() {
    this.gets++;
    if (this.getFails > 0) {
      this.getFails--;
      throw new DOMException('Failed to receive the feature report.', 'NetworkError');
    }
    return Uint8Array.from(this.reply);
  }
}

class FakeCableDevice extends FakeHidDevice {
  constructor(spec, backend) {
    super(
      {
        ...spec,
        collections: spec.collections || [
          {
            usagePage: 0xff13,
            usage: 0x01,
            inputReports: [],
            outputReports: [],
            featureReports: [{ reportId: P.FEATURE_ID, items: [{ reportSize: 8, reportCount: BODY }] }],
          },
        ],
      },
      backend,
    );
    this.outputAttempts = 0;
  }

  async sendReport() {
    // What the real cable interface does with the dongle's 20-byte packets: it has no such report, so the write fails.
    this.outputAttempts++;
    if (!this.opened) throw new DOMException('The device must be opened first.', 'InvalidStateError');
    throw new DOMException('Failed to write the output report.', 'NetworkError');
  }

  async sendFeatureReport(id, data) {
    if (!this.opened) throw new DOMException('The device must be opened first.', 'InvalidStateError');
    if (id !== P.FEATURE_ID) throw new DOMException('Unknown report id.', 'NetworkError');
    if (data.byteLength !== BODY) throw new DOMException(`The feature report must be ${BODY} bytes.`, 'NetworkError');
    this.backend.set(new Uint8Array(data.buffer ? data.buffer : data, data.byteOffset || 0, data.byteLength));
  }

  async receiveFeatureReport(id) {
    if (!this.opened) throw new DOMException('The device must be opened first.', 'InvalidStateError');
    if (id !== P.FEATURE_ID) throw new DOMException('Unknown report id.', 'NetworkError');
    return new DataView(this.backend.get().buffer);
  }
}

module.exports = { CableKeyboard, FakeCableDevice, BODY };
