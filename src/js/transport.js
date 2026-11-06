/*
 * Packet transport on top of any "io" object:
 *   io.send(Uint8Array(20))  -> Promise
 *   io.onReport = (bytes) => void      (assigned by Transport)
 *
 * Handles fragment reassembly, acknowledgements, retries and serialises
 * requests so a battery poll can never interleave with a write.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./protocol.js'));
  else root.AulaTransport = factory(root.AulaProtocol);
})(typeof self !== 'undefined' ? self : globalThis, function (P) {
  'use strict';

  class Emitter {
    constructor() {
      this._h = new Map();
    }
    on(name, fn) {
      if (!this._h.has(name)) this._h.set(name, new Set());
      this._h.get(name).add(fn);
      return () => this.off(name, fn);
    }
    off(name, fn) {
      const s = this._h.get(name);
      if (s) s.delete(fn);
    }
    emit(name, payload) {
      const s = this._h.get(name);
      if (!s) return;
      for (const fn of [...s]) {
        try {
          fn(payload);
        } catch (err) {
          // A broken listener must not take down the HID loop.
          if (typeof console !== 'undefined') console.error(err);
        }
      }
    }
  }

  class CommError extends Error {
    constructor(message = 'comm') {
      super(message);
      this.name = 'CommError';
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Rejects with a CommError if `promise` has not settled in `ms`. WebHID calls can hang for good on Windows. */
  function withTimeout(promise, ms, message) {
    let tm;
    const timer = new Promise((_, reject) => {
      tm = setTimeout(() => reject(new CommError(message)), ms);
    });
    return Promise.race([promise, timer]).finally(() => clearTimeout(tm));
  }
  const hex = (p) => Array.from(p, (b) => b.toString(16).padStart(2, '0')).join(' ');

  class Transport extends Emitter {
    /**
     * @param io  object with send() and an onReport slot
     * @param opts { timeout, log(direction, bytes) }
     */
    constructor(io, opts = {}) {
      super();
      this.io = io;
      this.timeout = opts.timeout ?? 1000;
      this.sendTimeout = opts.sendTimeout ?? 4000; // a sendReport that never returns must not freeze the app
      this._sendDead = false;
      this.logFn = opts.log || null;
      this.queue = [];
      this.waiter = null;
      this._poked = false;
      this.lock = Promise.resolve();
      this.closed = false;
      io.onReport = (raw) => this._onReport(raw);
    }

    close() {
      this.closed = true;
      this.io.onReport = null;
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w();
      }
    }

    _log(dir, p) {
      if (this.logFn) this.logFn(dir, p);
    }

    _onReport(raw) {
      const r = P.normalizeInput(raw);
      if (!r) return;
      this._log('rx', r);
      if (r[1] === P.CMD.EVENT) {
        // Spontaneous notification from the keyboard (r[5] === 2 is the online/asleep event).
        this.emit('event', { kind: r[5], value: r[6], packet: r });
        return;
      }
      if ((r[1] & 0x7f) === (P.CMD.REALTIME & 0x7f)) return;
      this.queue.push(r);
      if (this.waiter) {
        const w = this.waiter;
        this.waiter = null;
        w();
      }
    }

    /**
     * Ends the wait for an answer right now, so the next request goes out at once. Used the moment the keyboard is
     * known to have just woken up (a key was pressed, the dongle sent its online event), instead of sitting out the rest
     * of a timeout that was only meant for a sleeping keyboard.
     */
    poke() {
      if (!this.waiter) return false;
      this._poked = true;
      const w = this.waiter;
      this.waiter = null;
      w();
      return true;
    }

    /** Runs fn after every earlier request has finished. */
    exclusive(fn) {
      const run = this.lock.then(fn);
      this.lock = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    }

    async _send(p) {
      if (this._sendDead) throw new CommError('The keyboard stopped accepting requests.');
      this._log('tx', p);
      try {
        await withTimeout(this.io.send(p), this.sendTimeout, 'Windows did not accept a request to the keyboard.');
      } catch (err) {
        // After one send that never came back the handle is not worth asking again: fail fast so a retry can start clean.
        if (err instanceof CommError) this._sendDead = true;
        throw err;
      }
    }

    async _recv(cmd, timeout = this.timeout) {
      const end = Date.now() + timeout;
      this._poked = false;
      for (;;) {
        const i = this.queue.findIndex((r) => (r[1] & 0x7f) === cmd);
        if (i >= 0) return this.queue.splice(i, 1)[0];
        const left = end - Date.now();
        if (left <= 0 || this.closed) return null;
        await new Promise((res) => {
          const tm = setTimeout(() => {
            this.waiter = null;
            res();
          }, left);
          this.waiter = () => {
            clearTimeout(tm);
            res();
          };
        });
        if (this._poked) return null; // poke(): give up this wait now, the caller asks again
      }
    }

    async _readAll(cmd, sub = 0, tries = 3, timeout = this.timeout) {
      this.queue = [];
      let pokes = 0;
      for (let attempt = 1; attempt <= tries; attempt++) {
        // The queue is only cleared before the first request. A slow keyboard can answer attempt 1 while attempt 2 is
        // going out, and throwing that reply away made a link that was merely slow look dead.
        await this._send(P.buildPacket(cmd, 1, 0, sub << 4));
        const parts = new Map();
        let poked = false;
        for (;;) {
          const r = await this._recv(cmd, timeout);
          if (!r) {
            poked = this._poked;
            this._poked = false;
            break;
          }
          const f = P.parseFragment(r);
          if (f.error) break;
          parts.set(f.idx, f.data);
          if (f.idx + 1 >= f.total) {
            if (parts.size === f.total) return P.joinParts(parts, f.total);
            break;
          }
        }
        // poke(): the wait was cut short because the keyboard was just touched. The request goes out again at once and
        // does not use up a try (capped, so a stream of pokes cannot keep this going forever).
        if (poked && pokes++ < 50) {
          attempt--;
          continue;
        }
        if (attempt < tries) await sleep(100);
      }
      throw new CommError(`no answer to command 0x${cmd.toString(16)}`);
    }

    async _writeCmd(cmd, data, sub = 0, onPacket = null, tries = 5) {
      const chunks = P.splitChunks(data);
      const total = chunks.length;
      this.queue = [];
      for (let idx = 0; idx < total; idx++) {
        const chunk = chunks[idx];
        const pkt = P.buildPacket(cmd, total, idx, (sub << 4) | chunk.length, chunk);
        let ok = false;
        for (let attempt = 1; attempt <= tries && !ok; attempt++) {
          this.queue = []; // acknowledgements left over from the previous fragment must not count for this one
          await this._send(pkt);
          // Some links (the USB-C cable has been seen doing it) answer every packet twice. Skip an
          // acknowledgement for another fragment instead of treating it as a failed write and resending.
          const end = Date.now() + this.timeout;
          let r;
          do {
            r = await this._recv(cmd, Math.max(0, end - Date.now()));
          } while (r && !(r[2] & 0x80) && r[3] !== idx);
          ok = !!r && !(r[2] & 0x80) && r[3] === idx;
          if (!ok && attempt < tries) await sleep(100);
        }
        if (!ok) throw new CommError(`write of fragment ${idx + 1}/${total} was not acknowledged`);
        if (onPacket) onPacket(idx + 1, total);
      }
    }

    /**
     * Sends the commit packet that follows a config write. The keyboard echoes it, but its echo shares
     * an id with the keyboard's own notifications, so it surfaces as an event and is not waited for.
     */
    commit(settleMs = 120) {
      return this.exclusive(async () => {
        await this._send(P.buildSave());
        await sleep(settleMs);
      });
    }

    /** `timeout` (ms per attempt) overrides the default; the first contact with an idle wireless link uses a longer one. */
    readBlock(cmd, sub = 0, tries = 3, timeout) {
      return this.exclusive(() => this._readAll(cmd, sub, tries, timeout));
    }

    writeBlock(cmd, data, sub = 0, onPacket = null) {
      return this.exclusive(() => this._writeCmd(cmd, data, sub, onPacket));
    }
  }

  // The dongle's block commands, and which cable block each stands for.
  const WIRE_READ = { [P.CMD.GET_LED]: 'led', [P.CMD.GET_RGBTAB]: 'rgb', [P.CMD.GET_COLORS]: 'colors', [P.CMD.GET_MATRIX]: 'matrix' };
  const WIRE_WRITE = { [P.CMD.SET_LED]: 'led', [P.CMD.SET_RGBTAB]: 'rgb', [P.CMD.SET_COLORS]: 'colors', [P.CMD.SET_MATRIX]: 'matrix' };
  const POLL_MS = 12; // how often a read answer is looked for after the request went out
  const LOG_BYTES = 24; // a cable report is 520 bytes; the log keeps the header and the first bytes of data

  /**
   * The cable's counterpart of Transport (see "USB-C cable" in protocol.js). It is not a stream of 20-byte packets but a
   * register file behind one 520-byte feature report, so there is nothing to reassemble: a read is a request followed by
   * polling for the answer, a write is a single report.
   *
   * It answers the questions the engine already asks (readBlock, writeBlock, commit, poke, on) for the three blocks the
   * cable has, and refuses the rest at once and by name (battery, "is the keyboard awake"): the cable has no such report.
   * `io` needs sendFeature(Uint8Array(520)) and getFeature() -> Uint8Array.
   */
  class FeatureTransport extends Emitter {
    constructor(io, opts = {}) {
      super();
      this.io = io;
      this.kind = 'feature';
      this.timeout = opts.timeout ?? 1000;
      this.sendTimeout = opts.sendTimeout ?? 4000;
      this.logFn = opts.log || null;
      this.noBattery = true; // no battery or online report exists on the cable
      this.optionalBlocks = true; // the palette and per-key blocks may not be readable; the lighting block is what matters
      this.closed = false;
      this._sendDead = false;
      this.lock = Promise.resolve();
    }

    close() {
      this.closed = true;
    }

    poke() {
      return false; // the cable never pushes anything, so there is no wait to cut short
    }

    exclusive(fn) {
      const run = this.lock.then(fn);
      this.lock = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    }

    _log(dir, p) {
      if (this.logFn) this.logFn(dir, p.subarray ? p.subarray(0, LOG_BYTES) : p);
    }

    async _send(p) {
      if (this._sendDead) throw new CommError('The keyboard stopped accepting requests.');
      this._log('tx', p);
      try {
        await withTimeout(this.io.sendFeature(p), this.sendTimeout, 'Windows did not accept a request to the keyboard.');
      } catch (err) {
        if (err instanceof CommError) this._sendDead = true;
        throw err;
      }
    }

    async _get() {
      try {
        const raw = await withTimeout(this.io.getFeature(), this.sendTimeout, 'Windows did not return an answer from the keyboard.');
        const b = raw instanceof Uint8Array ? raw : new Uint8Array(raw.buffer ? raw.buffer : raw, raw.byteOffset || 0, raw.byteLength);
        this._log('rx', b);
        return b;
      } catch (err) {
        if (err instanceof CommError) this._sendDead = true;
        throw err;
      }
    }

    /** Is what came back a real answer for this block? An empty or stale reply must not pass for one. */
    _usable(name, f) {
      if (!f) return null;
      if (name === 'led') {
        const led = f.data.slice(0, P.LED_SIZE);
        return P.isValidLed(led) ? led : null;
      }
      if (!(f.size > 0 && f.size <= f.data.length)) return null;
      // One layer as the keyboard holds it: its header says how many bytes follow, and that many arrived. Not every
      // keyboard sends the full 512; key assignment decides whether what came is enough for its layout.
      if (name === 'matrix') return f.data.length >= P.WIRE.matrix.min ? f.data.slice(0, P.WIRE.matrix.size) : null;
      if (name === 'colors' && (f.data.length < 3 * 64 || f.data.length % 3)) return null;
      if (name === 'rgb' && f.data.length < 21 * 20) return null;
      return f.data;
    }

    /** `cmd` is the dongle's command number for the block; `sub` is the layer for the key matrix and unused otherwise. */
    readBlock(cmd, sub = 0, tries = 3, timeout) {
      return this.exclusive(() => this._read(cmd, tries, timeout ?? this.timeout, sub));
    }

    async _read(cmd, tries, timeout, sub = 0) {
      const name = WIRE_READ[cmd];
      if (!name) throw new CommError(`command 0x${cmd.toString(16)} is not available over the USB-C cable`);
      const w = P.WIRE[name];
      let why = '';
      for (let attempt = 1; attempt <= tries && !this.closed; attempt++) {
        await this._send(P.buildFeature(w.read, w.size, null, name === 'matrix' ? sub : 0));
        if (name === 'matrix') await sleep(20); // the vendor driver waits this long before it asks for a layer's answer
        const end = Date.now() + timeout;
        for (let first = true; first || Date.now() < end; first = false) {
          if (!first) await sleep(POLL_MS);
          if (this.closed) break;
          let raw;
          try {
            raw = await this._get();
          } catch (err) {
            // The keyboard can refuse a GET for a moment right after a request; keep asking until the time is up.
            if (this._sendDead) throw err;
            why = err && err.message ? err.message : String(err);
            continue;
          }
          const got = this._usable(name, P.parseFeature(raw, w.read));
          if (got) return got;
        }
        if (attempt < tries) await sleep(60);
      }
      throw new CommError(`no answer to command 0x${cmd.toString(16)}${why ? ` (${why})` : ''}`);
    }

    /** One report carries the whole block. It is not acknowledged; the engine reads the block back to check it stuck. */
    writeBlock(cmd, data, sub = 0, onPacket = null) {
      return this.exclusive(async () => {
        const name = WIRE_WRITE[cmd];
        if (!name) throw new CommError(`command 0x${cmd.toString(16)} is not available over the USB-C cable`);
        if (this.closed) throw new CommError('The link was closed.');
        // The palette goes out at the size the keyboard's own block has, padded with zeros if the copy here is shorter.
        if (name === 'matrix' && (data.length < P.WIRE.matrix.min || data.length > P.WIRE.matrix.size || data.length % 4)) {
          throw new CommError('A key layer is whole keys of four bytes, at most 512 bytes.');
        }
        const size = name === 'rgb' ? Math.max(data.length, P.WIRE.rgb.size) : data.length;
        const body = new Uint8Array(size);
        body.set(data);
        await this._send(P.buildFeature(P.WIRE[name].write, size, body, name === 'matrix' ? sub : 0));
        const parts = Math.max(1, Math.ceil(data.length / P.CHUNK));
        if (onPacket) for (let i = 1; i <= parts; i++) onPacket(i, parts);
      });
    }

    /** The cable needs no separate commit: a write is live when it lands. Waits the same settle time the dongle gets. */
    commit(settleMs = 120) {
      return this.exclusive(() => sleep(settleMs));
    }
  }

  return { Emitter, Transport, FeatureTransport, CommError, sleep, hex, withTimeout };
});
