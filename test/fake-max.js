'use strict';

/*
 * Fake F75 Max devices for the tests: a USB-C command interface that behaves like the documented firmware (every
 * command acknowledged, data packets echoed) and a 2.4G raw interface that answers the battery query. They record
 * everything written to them.
 */

const assert = require('node:assert/strict');

class FakeCable {
  constructor(opts = {}) {
    this.vendorId = 0x0c45;
    this.productId = 0x800a;
    this.productName = opts.name ?? 'AULA F75Max';
    this.collections = [{ usagePage: 0xff13, usage: 0x01 }];
    this.opened = false;
    this.opts = opts;
    this.sent = []; // every report written, in order
    this.expecting = 0; // data packets still to come after a header
    this.reply = new Uint8Array(64);
    this.getFails = opts.getFails ?? 0; // the first reads that fail, as a keyboard that is still busy does
    this.ackAt = 0; // ackDelayMs: when the acknowledgement of the last command becomes visible
    this.echoAt = 0; // echoDelayMs: when the echo of the last data packet becomes visible
    this.echoPending = null;
  }

  async open() {
    this.opened = true;
  }

  async close() {
    this.opened = false;
  }

  async sendFeatureReport(id, data) {
    assert.equal(id, 0, 'report id 0');
    const b = Uint8Array.from(data);
    assert.equal(b.length, 64, 'a feature report is 64 bytes');
    this.sent.push(b);
    if (this.expecting > 0) {
      this.expecting--;
      const echo = b.slice(); // data packets are echoed
      if (this.opts.badEcho) echo[10] ^= 0xff;
      if (this.opts.echoDelayMs) {
        this.echoPending = echo; // until then a read still shows the packet before
        this.echoAt = Date.now() + this.opts.echoDelayMs;
      } else this.reply = echo;
      return;
    }
    const reply = b.slice();
    this.ackLater = false;
    this.ackAt = 0;
    if (b[0] === 0x04 && b[1] !== this.opts.rejectOp && !this.opts.rejectAll) {
      const late = this.opts.ackDelayMs && (this.opts.ackDelayOp === undefined || this.opts.ackDelayOp === b[1]);
      if (late) this.ackAt = Date.now() + this.opts.ackDelayMs; // a keyboard that is busy: the acknowledgement comes later
      else if (this.opts.slowAck) this.ackLater = true; // read at once it is only an echo; the acknowledgement shows on the next read
      else reply[3] = 0x01;
    }
    if ([0x13, 0x17, 0x23, 0x72].includes(b[1])) this.expecting = b[8];
    this.reply = reply;
  }

  async receiveFeatureReport(id) {
    assert.equal(id, 0);
    if (this.getFails > 0) {
      this.getFails--;
      throw new Error('Failed to receive the feature report.');
    }
    if (this.echoPending && Date.now() >= this.echoAt) {
      this.reply = this.echoPending;
      this.echoPending = null;
    }
    if (this.ackAt && Date.now() >= this.ackAt) {
      this.reply[3] = 0x01;
      this.ackAt = 0;
    }
    const out = this.reply.slice();
    if (this.ackLater) {
      this.reply[3] = 0x01;
      this.ackLater = false;
    }
    return new DataView(out.buffer);
  }

  /** The command ops sent, with data packets folded into the op they follow. */
  ops() {
    const out = [];
    let data = 0;
    for (const b of this.sent) {
      if (data > 0) {
        data--;
        out.push('data');
        continue;
      }
      out.push(b[1].toString(16).padStart(2, '0'));
      if ([0x13, 0x17, 0x23].includes(b[1])) data = b[8];
    }
    return out;
  }
}

class FakeDongle {
  constructor(opts = {}) {
    this.vendorId = 0x05ac;
    this.productId = 0x024f;
    this.productName = opts.name ?? 'F75Max Dongle';
    this.collections = [{ usagePage: 0xff60, usage: 0x61 }];
    this.opened = false;
    this.percent = opts.percent ?? 77;
    this.answers = opts.answers !== false;
    this.sent = [];
    this._l = new Set();
  }

  async open() {
    this.opened = true;
  }

  async close() {
    this.opened = false;
  }

  addEventListener(ev, fn) {
    if (ev === 'inputreport') this._l.add(fn);
  }

  removeEventListener(ev, fn) {
    this._l.delete(fn);
  }

  async sendReport(id, data) {
    assert.equal(id, 0);
    const b = Uint8Array.from(data);
    assert.equal(b.length, 32, 'an output report is 32 bytes');
    this.sent.push(b);
    if (b[0] === 0x20 && this.answers) {
      const r = new Uint8Array(32);
      r.set([0x20, 0x01, 0x00, this.percent]);
      setTimeout(() => this._l.forEach((fn) => fn({ reportId: 0, data: new DataView(r.buffer) })), 1);
    }
  }
}


/** A fake navigator.hid over a list of devices. */
function fakeHid(list) {
  return { getDevices: async () => list.slice(), addEventListener() {}, removeEventListener() {} };
}

module.exports = { FakeCable, FakeDongle, fakeHid };
