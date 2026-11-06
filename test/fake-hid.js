'use strict';

/*
 * A stand-in for navigator.hid with the behaviours that matter for finding the keyboard:
 *  - one HIDDevice object per interface, shared by everything that asks for it (like the real getDevices())
 *  - open() on an open device resolves, close() takes a moment and open() during that moment is refused
 *  - sendReport() on a closed device throws
 *  - a device can be "stale": it swallows every request until it has been closed and opened again,
 *    which is what a replug does
 *
 * Each device is backed by an object with send(packet20) and onReport (a MockKeyboard, or SilentBackend).
 */

const P = require('../src/js/protocol.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class SilentBackend {
  constructor() {
    this.onReport = null;
  }
  async send() {}
}

class FakeHidDevice {
  constructor(spec, backend) {
    this.vendorId = spec.vendorId;
    this.productId = spec.productId;
    this.productName = spec.productName || 'Fake keyboard';
    this.collections = spec.collections || [{ usagePage: 0xff02, usage: 0x02 }];
    this.backend = backend;
    this.opened = false;
    this.stale = !!spec.stale; // swallow requests until reopened
    this.closeMs = spec.closeMs ?? 20;
    this.opens = 0;
    this.closes = 0;
    this._closing = false;
    this._listeners = new Set();
    backend.onReport = (p) => {
      if (!this.opened || this.stale) return;
      const data = new DataView(Uint8Array.from(p.slice(1)).buffer);
      for (const fn of [...this._listeners]) fn({ type: 'inputreport', reportId: p[0], data });
    };
  }

  addEventListener(type, fn) {
    if (type === 'inputreport') this._listeners.add(fn);
  }
  removeEventListener(type, fn) {
    if (type === 'inputreport') this._listeners.delete(fn);
  }

  async open() {
    if (this._closing) throw new DOMException('An operation that changes the device state is in progress.', 'InvalidStateError');
    if (this.opened) return;
    this.opened = true;
    this.opens++;
    if (this.opens > 1) this.stale = false; // the second open is a clean one
  }

  async close() {
    if (!this.opened) return;
    this._closing = true;
    await wait(this.closeMs);
    this.opened = false;
    this._closing = false;
    this.closes++;
  }

  async sendReport(id, data) {
    if (!this.opened) throw new DOMException('The device must be opened first.', 'InvalidStateError');
    if (this.stale) return;
    const p = new Uint8Array(P.PACKET_LEN);
    p[0] = id;
    p.set(data, 1);
    await this.backend.send(p);
  }
}

class FakeHid {
  constructor() {
    this.devices = [];
    this._l = new Map();
  }
  add(spec, backend) {
    // A backend that speaks feature reports (see fake-cable.js) gets the device that has no 20-byte output report.
    const Device = backend.feature ? require('./fake-cable.js').FakeCableDevice : FakeHidDevice;
    const d = new Device(spec, backend);
    this.devices.push(d);
    this._emit('connect', { device: d });
    return d;
  }
  remove(d) {
    this.devices = this.devices.filter((x) => x !== d);
    this._emit('disconnect', { device: d });
  }
  async getDevices() {
    return [...this.devices];
  }
  async requestDevice() {
    return [];
  }
  addEventListener(t, fn) {
    if (!this._l.has(t)) this._l.set(t, new Set());
    this._l.get(t).add(fn);
  }
  removeEventListener(t, fn) {
    if (this._l.has(t)) this._l.get(t).delete(fn);
  }
  _emit(t, e) {
    for (const fn of [...(this._l.get(t) || [])]) fn(e);
  }
}

/** Installs a FakeHid as navigator.hid for the duration of a test and returns [hid, restore]. */
function installFakeHid() {
  const hid = new FakeHid();
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { hid }, configurable: true, writable: true });
  const restore = () => {
    if (prev) Object.defineProperty(globalThis, 'navigator', prev);
    else delete globalThis.navigator;
  };
  return [hid, restore];
}

const DONGLE = { vendorId: 0x3554, productId: 0xfa09, productName: 'AULA 2.4G dongle' };
const CABLE = { vendorId: 0x258a, productId: 0x010c, productName: 'AULA F75' };

module.exports = { FakeHid, FakeHidDevice, SilentBackend, installFakeHid, DONGLE, CABLE, wait };
