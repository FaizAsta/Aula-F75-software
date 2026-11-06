/*
 * WebHID glue: finds permitted AULA interfaces and wraps one as an "io" object
 * for Transport. The Electron main process pre-approves AULA devices, so no
 * browser picker is needed for the normal case.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./protocol.js'));
  else root.AulaWebHID = factory(root.AulaProtocol);
})(typeof self !== 'undefined' ? self : globalThis, function (P) {
  'use strict';

  const NAME_RE = /aula|f75|f87/i;
  const hasHid = () => typeof navigator !== 'undefined' && !!navigator.hid;
  const isVendor = (d) => (d.collections || []).some((c) => c.usagePage >= 0xff00);
  const hex4 = (n) => n.toString(16).padStart(4, '0');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isBusy = (err) => !!err && err.name === 'InvalidStateError';

  class WebHidIO {
    constructor(device) {
      this.device = device;
      this.onReport = null;
      this._handler = (e) => {
        if (e.reportId !== P.REPORT_ID) return;
        const r = new Uint8Array(P.PACKET_LEN);
        r[0] = P.REPORT_ID;
        r.set(new Uint8Array(e.data.buffer, e.data.byteOffset, Math.min(P.PACKET_LEN - 1, e.data.byteLength)), 1);
        if (this.onReport) this.onReport(r);
      };
    }

    /**
     * Always starts from a clean handle. A device that is still open from an earlier attempt (or that another
     * part of the page forgot to close) can sit there deaf, which only a close and open cures: the same thing a
     * replug does. A close that is still finishing makes open() fail with InvalidStateError, so wait and try again.
     */
    async open() {
      for (let i = 0; ; i++) {
        try {
          if (this.device.opened) await this.device.close();
          await this.device.open();
          break;
        } catch (err) {
          if (!isBusy(err) || i >= 5) throw err;
          await sleep(80);
        }
      }
      this.device.addEventListener('inputreport', this._handler);
      // Reports sent in the first instants after a Windows HID open can be dropped; give the handle a moment to settle.
      await sleep(40);
    }

    async send(packet) {
      await this.device.sendReport(P.REPORT_ID, packet.slice(1));
    }

    async close() {
      this.device.removeEventListener('inputreport', this._handler);
      for (let i = 0; this.device.opened; i++) {
        try {
          await this.device.close();
        } catch (err) {
          if (!isBusy(err) || i >= 5) throw err;
          await sleep(80);
        }
      }
    }
  }

  /**
   * Does the descriptor declare feature report `id`? true/false when it says, null when it says nothing (an older WebHID, or
   * a test double without report lists).
   */
  function declaresFeature(d, id) {
    const cols = d.collections || [];
    if (!cols.some((c) => Array.isArray(c.featureReports))) return null;
    return cols.some((c) => (c.featureReports || []).some((r) => r.reportId === id));
  }

  /** Payload size in bytes (the id not counted) the descriptor gives feature report `id`; the cable's 519 when it gives none. */
  function featureSize(d, id) {
    for (const c of d.collections || []) {
      for (const r of c.featureReports || []) {
        if (r.reportId !== id) continue;
        const bits = (r.items || []).reduce((n, i) => n + (i.reportSize || 0) * (i.reportCount || 0), 0);
        if (bits > 0) return Math.ceil(bits / 8);
      }
    }
    return P.FEATURE_LEN - 1;
  }

  /**
   * The USB-C cable's link: one 519-byte feature report (id 0x06) instead of 20-byte input and output reports. Opening and
   * closing are the same as for the dongle; what differs is that a request is sent as a feature report and its answer is
   * fetched with a GET, because nothing is ever pushed to the host on this interface.
   */
  class WebHidFeatureIO extends WebHidIO {
    constructor(device) {
      super(device);
      this.kind = 'feature';
      this.size = featureSize(device, P.FEATURE_ID);
    }

    /** `packet` is 520 bytes with the report id in front. Padded or trimmed to what the descriptor declares. */
    async sendFeature(packet) {
      let body = packet.subarray(1);
      if (body.length > this.size) {
        if (body.subarray(this.size).some((v) => v !== 0)) throw new Error(`The keyboard's feature report holds ${this.size} bytes, which is less than this request needs.`);
        body = body.subarray(0, this.size);
      } else if (body.length < this.size) {
        const padded = new Uint8Array(this.size);
        padded.set(body);
        body = padded;
      }
      await this.device.sendFeatureReport(P.FEATURE_ID, body);
    }

    async getFeature() {
      const v = await this.device.receiveFeatureReport(P.FEATURE_ID);
      return new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice();
    }
  }

  /**
   * Whether the descriptor the device published has the 20-byte output report this protocol is sent in. true/false
   * when the descriptor says, null when it says nothing (an older WebHID, or a test double): then nothing is ruled out.
   */
  function declaresReport(d) {
    const cols = d.collections || [];
    if (!cols.some((c) => Array.isArray(c.outputReports))) return null;
    return cols.some((c) => c.usagePage >= 0xff00 && (c.outputReports || []).some((r) => r.reportId === P.REPORT_ID));
  }

  function describe(d) {
    const known = P.deviceFor(d.vendorId, d.productId);
    // A device that is only recognised by its name has to show it takes our report before it is ever sent one.
    const declared = known ? null : declaresReport(d);
    // The F75 Max's ids are shared with other AULA models, so the product name decides what the device is.
    const model = known && known.family === 'max' ? P.maxModel(d.productName) : null;
    const other = model === 'other';
    return {
      vid: d.vendorId,
      pid: d.productId,
      id: `${hex4(d.vendorId)}:${hex4(d.productId)}`,
      name: d.productName || 'Unnamed HID device',
      known: known ? known.id : null,
      family: known ? known.family : 'f75',
      label: other ? `AULA keyboard (${hex4(d.vendorId)}:${hex4(d.productId)})` : known ? known.label : d.productName || 'Keyboard',
      mode: known ? known.link : 'unknown',
      confirm: model === 'unknown', // on the F75 Max's ids with a name that does not say which model: ask before writing
      feature: declaresFeature(d, P.FEATURE_ID),
      supported: known ? known.supported && !other : declared !== false,
      why: other ? 'another AULA model that shares these USB ids and speaks a different protocol' : !known && declared === false ? 'its descriptor has no 0x13 output report, so it speaks a different protocol' : '',
      vendor: isVendor(d),
      opened: !!d.opened,
      collections: (d.collections || []).map((c) => ({
        usagePage: '0x' + c.usagePage.toString(16).padStart(4, '0'),
        usage: '0x' + c.usage.toString(16).padStart(2, '0'),
        reports: reportSizes(c),
      })),
    };
  }

  /**
   * The report ids and sizes a collection declares, e.g. "in 0x13:19B  out 0x13:19B  feature 0x00:519B". Read from the
   * descriptor the device already published, so describing a device sends it nothing.
   */
  function reportSizes(c) {
    const one = (label, list) =>
      (list || []).map((r) => {
        const bits = (r.items || []).reduce((n, i) => n + (i.reportSize || 0) * (i.reportCount || 0), 0);
        return `${label} 0x${(r.reportId || 0).toString(16).padStart(2, '0')}:${Math.ceil(bits / 8)}B`;
      });
    return [...one('in', c.inputReports), ...one('out', c.outputReports), ...one('feature', c.featureReports)].join('  ');
  }

  /** Everything WebHID has been allowed to see, for the Diagnostics page. */
  async function listPermitted() {
    if (!hasHid()) return [];
    const devices = await navigator.hid.getDevices();
    return devices.map(describe);
  }

  /** Candidate interfaces in the order they should be tried. */
  async function discover() {
    if (!hasHid()) return [];
    const devices = await navigator.hid.getDevices();
    const out = [];
    for (const d of devices) {
      if (!isVendor(d)) continue;
      const known = P.deviceFor(d.vendorId, d.productId);
      if (known && known.family !== 'f75') continue; // another family (the F75 Max): max.js drives it, never this protocol
      if (!known && !NAME_RE.test(d.productName || '')) continue;
      const meta = describe(d);
      // The cable's vendor interface declares feature report 0x06 and no 0x13 reports: the dongle's 20-byte packets are
      // refused by it on the spot. Where the descriptor says nothing, the 20-byte protocol is used as before.
      const viaFeature = meta.mode === 'wired' && meta.feature === true;
      meta.link = viaFeature ? 'feature' : 'output';
      const rank = (d.collections || []).some((c) => c.usagePage === 0xff02) ? 0 : known ? 1 : 2;
      out.push({ io: viaFeature ? new WebHidFeatureIO(d) : new WebHidIO(d), meta, rank });
    }
    // The 2.4G dongle is the best tested path, so it goes first among equals. (A comparator that answers -1 for
    // "a is the dongle" whichever side it is on is not a valid ordering, and left the order to chance.)
    const pref = (c) => (c.meta.mode === 'dongle' ? 0 : 1);
    const viaFeature = (c) => (c.meta.link === 'feature' ? 0 : 1);
    out.sort((a, b) => a.rank - b.rank || pref(a) - pref(b) || viaFeature(a) - viaFeature(b));
    return out;
  }

  /** Opens the browser/Electron device chooser. Resolves with the number of devices granted. */
  async function requestAccess() {
    if (!hasHid()) throw new Error('WebHID is not available in this window.');
    const filters = P.DEVICES.map((d) => ({ vendorId: d.vid, productId: d.pid }));
    const granted = await navigator.hid.requestDevice({ filters });
    return granted.length;
  }

  function onDevicesChanged(cb) {
    if (!hasHid()) return () => {};
    navigator.hid.addEventListener('connect', cb);
    navigator.hid.addEventListener('disconnect', cb);
    return () => {
      navigator.hid.removeEventListener('connect', cb);
      navigator.hid.removeEventListener('disconnect', cb);
    };
  }

  return { WebHidIO, WebHidFeatureIO, discover, listPermitted, requestAccess, onDevicesChanged, hasHid, describe };
});
