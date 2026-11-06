/*
 * A simulated F75 that speaks the same 20-byte protocol. Used for Demo mode in
 * the app and as the test double for the whole transport/session stack.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./protocol.js'), require('./keys.js'), require('./layout.js'));
  else root.AulaMock = factory(root.AulaProtocol, root.AulaKeys, root.AulaLayout);
})(typeof self !== 'undefined' ? self : globalThis, function (P, K, L) {
  'use strict';

  const parseSub = (p) => p[4] >> 4; // layer of a key-matrix request

  const DEFAULT_PALETTE = P.DEFAULT_PALETTE;

  class MockKeyboard {
    constructor(opts = {}) {
      this.battery = opts.battery ?? 78;
      this.online = opts.online ?? true;
      this.ledCount = opts.ledCount ?? 96;
      this.latency = opts.latency ?? 0;
      this.dropWrites = opts.dropWrites ?? false; // simulate a keyboard that ignores writes
      this.requireSave = opts.requireSave ?? false; // writes only go live after the commit packet
      this.cable = opts.cable ?? false; // USB-C: always awake, but GET_ONLINE (the wireless link flag) reads 0
      this.duplicateReplies = opts.duplicateReplies ?? false; // every reply arrives twice, as seen on a real cable
      this.matrixSupported = opts.matrix ?? true; // false: a keyboard that never answers for its key layers
      this.saves = 0;
      this.onReport = null;
      this.sent = [];

      this.led = new Uint8Array(P.LED_SIZE);
      this.led[0x7e] = 0x5a;
      this.led[0x7f] = 0xa5;
      P.setMode(this.led, 3);
      this.led[P.OFF.SLEEP] = 10;
      for (let slot = 0; slot < 19; slot++) {
        this.led[P.slotByte(slot, 0)] = 4;
        this.led[P.slotByte(slot, 1)] = (2 << 4) | 7;
      }

      this.rgb = new Uint8Array(21 * 20);
      for (let slot = 0; slot < 19; slot++) {
        DEFAULT_PALETTE.forEach((c, j) => this.rgb.set(c, P.palOffset(slot, j)));
      }

      this.colors = new Uint8Array(this.ledCount * 3);

      // The key layers: normal and Fn as a keyboard might ship, and two empty ones.
      const keys = opts.layoutKeys || L.MODELS[0].keys;
      // opts.matrixBytes: a keyboard whose layers are shorter than the usual 512 bytes (some models send less).
      const layerBytes = opts.matrixBytes ?? K.LAYER_SIZE;
      this.matrix = [K.defaultLayer(0, keys), K.defaultLayer(1, keys), new Uint8Array(K.LAYER_SIZE), new Uint8Array(K.LAYER_SIZE)].map((b) => b.slice(0, layerBytes));
      this._pending = new Map(); // cmd -> Map(idx -> data)
      this._staged = {}; // blocks received but not yet committed (requireSave)
    }

    _emit(p) {
      const fire = () => this.onReport && this.onReport(p);
      const copies = this.duplicateReplies ? 2 : 1;
      for (let i = 0; i < copies; i++) {
        if (this.latency) setTimeout(fire, this.latency);
        else Promise.resolve().then(fire);
      }
    }

    _reply(cmd, total, idx, data, sub = 0) {
      this._emit(P.buildPacket(cmd, total, idx, (sub << 4) | data.length, data));
    }

    _sendBlock(cmd, bytes, sub = 0) {
      const chunks = P.splitChunks(bytes);
      chunks.forEach((c, i) => this._reply(cmd, chunks.length, i, c, sub));
    }

    /** Pushes the spontaneous online/asleep event the real keyboard sends. */
    pushOnlineEvent(online) {
      this.online = online;
      const p = new Uint8Array(P.PACKET_LEN);
      p[0] = P.REPORT_ID;
      p[1] = P.CMD.EVENT;
      p[5] = 2;
      p[6] = online ? 1 : 0;
      p[19] = P.checksum(p);
      this._emit(p);
    }

    /** Takes a finished block. A config that still carries the apply flag is ignored, as on the real firmware. */
    _applyBlock(target, bytes) {
      if (target.startsWith('matrix')) {
        this.matrix[Number(target.slice(6))] = bytes;
        return;
      }
      if (target === 'led') {
        if (bytes[P.OFF.APPLY] === 1) return;
        bytes = bytes.slice();
        bytes[P.OFF.APPLY] = 1; // the firmware marks a config as applied
      }
      this[target] = bytes;
    }

    async send(p) {
      this.sent.push(Uint8Array.from(p));
      if (p[19] !== P.checksum(p)) return; // bad checksum: ignore, like the firmware
      const cmd = p[1];
      const C = P.CMD;

      if (cmd === C.GET_ONLINE) return this._sendBlock(cmd, Uint8Array.of(this.online && !this.cable ? 1 : 0));
      if (!this.online && !this.cable) return; // asleep: stays silent (a cable keyboard is never asleep)
      if (cmd === C.SAVE) {
        // Commit: the firmware echoes the packet and makes staged writes live.
        this.saves++;
        for (const [name, bytes] of Object.entries(this._staged)) this._applyBlock(name, bytes);
        this._staged = {};
        return this._emit(Uint8Array.from(p));
      }
      if (cmd === C.GET_STATUS) return this._sendBlock(cmd, Uint8Array.of(this.battery));
      if (cmd === C.GET_LED) return this._sendBlock(cmd, this.led);
      if (cmd === C.GET_RGBTAB) return this._sendBlock(cmd, this.rgb);
      if (cmd === C.GET_COLORS) return this._sendBlock(cmd, this.colors);
      if ((cmd === C.GET_MATRIX || cmd === C.SET_MATRIX) && !this.matrixSupported) return;
      if (cmd === C.GET_MATRIX) {
        const layer = parseSub(p);
        return this.matrix[layer] ? this._sendBlock(cmd, this.matrix[layer], layer) : undefined;
      }

      const target = { [C.SET_LED]: 'led', [C.SET_RGBTAB]: 'rgb', [C.SET_COLORS]: 'colors', [C.SET_MATRIX]: 'matrix' }[cmd];
      if (target) {
        const f = P.parseFragment(p);
        const name = target === 'matrix' ? `matrix${f.sub}` : target;
        if (target === 'matrix' && !this.matrix[f.sub]) return; // a layer the keyboard does not have: silence
        const pend = `${cmd}:${f.sub}`;
        if (!this._pending.has(pend) || f.idx === 0) this._pending.set(pend, new Map());
        this._pending.get(pend).set(f.idx, f.data);
        this._emit(Uint8Array.from(p)); // the firmware echoes every fragment as its ack
        // A block is taken only once every fragment of it has arrived (a resent last fragment on its own completes nothing).
        if (f.idx + 1 === f.total && !this.dropWrites && this._pending.get(pend).size === f.total) {
          const bytes = P.joinParts(this._pending.get(pend), f.total);
          this._pending.delete(pend);
          if (this.requireSave) this._staged[name] = bytes;
          else this._applyBlock(name, bytes);
        }
      }
    }
  }

  return { MockKeyboard, DEFAULT_PALETTE };
});
