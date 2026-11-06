/*
 * Keyboard session: finds the keyboard, reads its settings into an editable copy,
 * tracks what changed, writes it back (and reads it again to prove it stuck),
 * and polls the battery. Knows nothing about the DOM.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./protocol.js'), require('./transport.js'));
  else root.AulaEngine = factory(root.AulaProtocol, root.AulaTransport);
})(typeof self !== 'undefined' ? self : globalThis, function (P, T) {
  'use strict';

  const { Emitter, Transport, FeatureTransport, CommError, sleep, hex, withTimeout } = T;

  const BLOCKS = {
    led: { get: P.CMD.GET_LED, set: P.CMD.SET_LED },
    rgb: { get: P.CMD.GET_RGBTAB, set: P.CMD.SET_RGBTAB },
    colors: { get: P.CMD.GET_COLORS, set: P.CMD.SET_COLORS },
  };
  const ORDER = ['led', 'rgb', 'colors'];
  const KEY = { backup: 'aula.backup.first', history: 'aula.battery.history', keep: 'aula.keep.settings', keepOn: 'aula.keep.optin', brightMax: 'aula.bright.max', lowLight: 'aula.lowlight.saved' };
  // The low-battery light: the Breathing effect, first palette colour set to red, at half of the keyboard's brightness levels.
  const LOW_LIGHT = { mode: 2, colour: [255, 0, 0], brightness: 0.5, speed: 2 };
  const WAKE_HINT = 'Waking the keyboard. Press any key on it if it stays asleep.';
  const wakeDetail = (n, of) => `Waking the keyboard (attempt ${n} of ${of}). Press any key on it if it stays asleep.`;
  const LOG_LIMIT = 400;
  const HISTORY_LIMIT = 2000;

  const clone = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.slice()]));

  /** `fresh` with every byte the user changed (cur differs from last-read) laid over it. */
  function mergeEdits(fresh, last, cur) {
    const out = fresh.slice();
    if (!last || last.length !== cur.length) return cur.slice();
    for (let i = 0; i < cur.length; i++) if (cur[i] !== last[i]) out[i] = cur[i];
    return out;
  }

  /**
   * The offsets a write means to change: where `out` (what is sent) differs from `pre` (what the keyboard held just
   * before). `skip` is an offset that is never compared (the apply flag, which the firmware sets itself). When `pre` is
   * unusable every offset counts, so the check is never weaker than "the whole block".
   */
  function changedOffsets(pre, out, skip = -1) {
    const idx = [];
    const all = !pre || pre.length !== out.length;
    for (let i = 0; i < out.length; i++) if (i !== skip && (all || pre[i] !== out[i])) idx.push(i);
    return idx;
  }

  /** Does `got` hold, at every offset in `idx`, what `out` has? A block of another length never does. */
  function holdsChanges(got, out, idx) {
    if (!got || got.length !== out.length) return false;
    for (const i of idx) if (got[i] !== out[i]) return false;
    return true;
  }

  /**
   * Over the 2.4G dongle GET_ONLINE says whether the keyboard is awake and linked. Over the USB-C cable the
   * keyboard is always attached and that query only describes the wireless link, so it answers 0 even while the
   * keyboard is working normally. Trusting it there made a perfectly good cable connection look "asleep".
   */
  const usesOnlineFlag = (mode) => mode === 'dongle' || mode === 'demo';

  /** The blocks of `src` that were really read from the keyboard on this link (`readable[k]` is true), as a new object. */
  function readableOnly(src, readable) {
    const out = {};
    for (const k of ORDER) if (src[k] && readable[k]) out[k] = src[k];
    return out;
  }

  function memoryStorage() {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => void m.set(k, String(v)),
      removeItem: (k) => void m.delete(k),
    };
  }

  function defaultStorage() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.getItem('aula.probe');
        return localStorage;
      }
    } catch (_) {
      /* storage can be unavailable; fall through */
    }
    return memoryStorage();
  }

  class Session extends Emitter {
    /**
     * @param opts.discover  async () => [{ io, meta: { mode, label, supported? } }]
     * @param opts.storage   localStorage-like (defaults to localStorage or memory)
     * @param opts.pollMs    battery poll interval while running on the battery
     * @param opts.chargePollMs  battery poll interval while the keyboard is charging (the level is moving, so ask more often)
     */
    constructor(opts = {}) {
      super();
      this.storage = opts.storage || defaultStorage();
      this.discover = opts.discover || null;
      this.pollMs = opts.pollMs ?? 15000;
      this.chargePollMs = opts.chargePollMs ?? 5000;
      this.transportTimeout = opts.transportTimeout ?? 1000;
      this.ioTimeoutMs = opts.ioTimeoutMs ?? 4000; // longest the app waits for Windows to open, close or write to a HID device
      this.connectRounds = opts.connectRounds ?? 3; // how many times a connect closes, reopens and asks again before it reports an error
      this.retryGapMs = opts.retryGapMs ?? 350; // pause before a retry round (grows with each round)
      this.tickMs = opts.tickMs ?? 2000; // health-check interval while a link is up
      this.syncMs = opts.syncMs ?? 8000; // how often the lighting block is re-read to notice changes made on the keyboard itself
      // After a write the block is read back to check it stuck. A keyboard (the 2.4G dongle especially) can take a moment to
      // show a new config, so a read that still shows the old one is asked again after each of these pauses (ms) before the
      // write is called a failure. A read that already matches ends the wait at once.
      this.verifyDelays = opts.verifyDelays ?? [0, 150, 250, 400, 600, 800];

      this.brightMax = this._loadBrightMax(); // how many brightness levels this keyboard has; starts at 4 and grows when it reports more

      this.productName = ''; // USB product name of the connected interface; a hint at the model
      this.status = 'idle'; // idle | searching | connecting | reading | ready | asleep | unsupported | error
      this.statusDetail = '';
      this.mode = null; // dongle | wired | demo | unknown
      this.iface = null;
      this.candidates = [];

      this.transport = null;
      this.io = null;
      this.cur = null;
      this.dev0 = null;
      // Which blocks were really read from the keyboard on this link. The USB-C cable may not hand over the palette or the
      // per-key colours; those are then stand-ins (never written unless the user edits them, never remembered, never verified).
      this.readable = { led: true, rgb: true, colors: true };
      this.link = null; // 'feature' for the USB-C cable's feature reports, 'output' for the 20-byte reports, 'demo'

      this.battery = { percent: null, at: 0, source: null };
      this._rose = 0; // when a reading last went up against the one before it (0 = it has not, or it has gone down since)
      this.cablePlugged = false; // the keyboard's USB-C cable is plugged in (its interface is on the bus), whatever link is in use
      this._lastCableLook = 0; // when the device list was last checked for the cable by the watchdog
      this._lastStatusHex = ''; // the last raw GET_STATUS bytes, kept in the log so a charging flag can be found
      this._fullArmed = true; // the "fully charged" event fires once per charge, and re-arms when the level falls back
      this.history = this._loadHistory();
      this._lowLight = this._loadLowLight(); // { saved, at } while the red low-battery light is on the keyboard; saved = the lighting to put back
      this._lowBusy = false;
      this.logLines = [];

      this.ifaceId = null;
      this._fails = 0;
      this._batFails = 0;
      this._connecting = false;
      this._connectRun = null; // promise of the connect that is running, so a user's click can join it instead of being dropped
      this._quietRun = true; // true while the running connect should not touch the status (background looks)
      this._checking = false;
      this._closing = Promise.resolve(); // resolves when the last link has really released its HID device
      this._errTicks = 0;
      this.giveUpMs = opts.giveUpMs ?? 15000; // how long the app keeps showing "connecting" before it shows an error
      this._tryingSince = 0; // when this stretch of trying to reach the keyboard began (0 = not trying)
      this._graceTimer = null;
      this._errGap = 1; // ticks to wait between quiet restarts while the link is up but silent (grows, resets on any sign of life)
      this._probes = new Set(); // transports being probed right now, so poke() can reach them
      this._lastCross = 0;
      this._lastRescan = 0;
      this._rescanGap = 8000; // how long to wait between looks at what is plugged in while the keyboard is asleep (grows while nothing changes)
      this._recheck = false; // a wake event arrived while a check was already running
      this._again = false; // a USB change arrived while a connect was running
      this._watchTimer = null;
      this._watchKick = null;
      this._flagLink = true; // true when GET_ONLINE is the awake/asleep signal on the current link
      this._applying = false;
      this._timer = null;
      this._wakeTimer = null;
      this._lastSync = 0;
      this._syncHits = [];
      this._syncOff = false;
      this._restoring = false;
    }

    // ------------------------------------------------------------ status

    _setStatus(status, detail = '') {
      if (status === 'ready') {
        this._rescanGap = 8000;
        this._tryingSince = 0;
      }
      if (status === 'idle' || status === 'asleep') this._tryingSince = 0;
      this.status = status;
      this.statusDetail = detail;
      clearTimeout(this._graceTimer);
      this._graceTimer = null;
      // While the app is still within its first stretch of trying, an error is not shown (see `settling`); say so
      // again the moment that time is up, so the screen can switch to the error.
      if (status === 'error' && this.settling) {
        const left = this._tryingSince + this.giveUpMs - Date.now();
        this._graceTimer = setTimeout(() => {
          this._graceTimer = null;
          if (this.status === 'error') this.emit('status', { status: 'error', detail: this.statusDetail });
        }, Math.max(0, left) + 20);
        if (this._graceTimer.unref) this._graceTimer.unref();
      }
      this.emit('status', { status, detail });
    }

    /**
     * True while the status is 'error' but the app has not been trying for long yet (`giveUpMs`) and is still retrying
     * in the background. The screen shows "connecting" for that time and only then the error. A failure that has
     * nothing to do with connecting (a refresh that failed on a working link) has no trying stretch and shows at once.
     */
    get settling() {
      return this.status === 'error' && this._tryingSince > 0 && Date.now() - this._tryingSince < this.giveUpMs;
    }

    /** Starts the clock again: something changed (a device was plugged in, the PC woke up), so give it a fresh chance. */
    restartGrace() {
      if (this.ready) return;
      this._tryingSince = Date.now();
      if (this.status === 'error') this._setStatus('error', this.statusDetail);
    }

    get connected() {
      return !!this.transport;
    }

    /** True while the keyboard is talking over the USB-C cable (which has no battery report). */
    get onCable() {
      return !!this.transport && this.mode === 'wired';
    }

    /**
     * True while the keyboard is charging. On the cable that follows from the link alone: it charges from the cable whether
     * or not the cable can say how full it is. On any other link it follows from the readings: the level went up within the
     * last 15 minutes and has not gone down since (a keyboard on the dongle that is charging through its cable).
     */
    get charging() {
      if (this.onCable) return true;
      if (!this.transport) return false;
      if (this.mode === 'demo') return false;
      // Wireless link (2.4G dongle) with the cable plugged in: the keyboard is charging right now. This is the live signal;
      // the rising level below is only the fallback for when the cable's interface is not on the bus.
      if (this.cablePlugged) return true;
      return this._rose > 0 && Date.now() - this._rose < 15 * 60 * 1000;
    }

    /**
     * Notes whether the keyboard's USB-C cable is on the bus, from a device list that was just read (nothing is opened or
     * sent). The cable shows up as its own USB interface the moment it is plugged in, even while the keyboard is
     * working through the 2.4G dongle, so this is what makes the charging bolt appear at once instead of after the
     * battery level has been seen to rise. Tells the screen when it changes.
     */
    _noteCable(list) {
      const plugged = (list || []).some((c) => c.meta && c.meta.mode === 'wired' && c.meta.supported !== false);
      if (plugged === this.cablePlugged) return false;
      this.cablePlugged = plugged;
      this._note(plugged ? 'USB-C cable plugged in: the keyboard is charging' : 'USB-C cable unplugged');
      this.emit('change');
      this.emit('battery', this.battery);
      return true;
    }

    /** Checks the device list for the cable, at most every 4 s. Used by the watchdog as a safety net for a missed plug event. */
    async _lookForCable() {
      if (!this.discover || this.onCable || this.mode === 'demo') return;
      if (Date.now() - this._lastCableLook < 4000) return;
      this._lastCableLook = Date.now();
      const list = await this.discover().catch(() => null);
      if (list) this._noteCable(list);
    }

    /** True while a connect pass is running (also the quiet ones the watchdog starts). */
    get connecting() {
      return this._connecting;
    }

    get ready() {
      return this.status === 'ready' && !!this.cur;
    }

    /** The blocks the keyboard did not hand over on this link (see `readable`). Empty on the dongle and on the demo keyboard. */
    get unread() {
      return ORDER.filter((k) => !this.readable[k]);
    }

    _log(dir, p) {
      const line = { t: Date.now(), dir, hex: hex(p) };
      this.logLines.push(line);
      if (this.logLines.length > LOG_LIMIT) this.logLines.splice(0, this.logLines.length - LOG_LIMIT);
      this.emit('log', line);
    }

    /** A human-readable line in the packet log (not a packet). */
    _note(text) {
      const line = { t: Date.now(), dir: 'note', hex: text };
      this.logLines.push(line);
      if (this.logLines.length > LOG_LIMIT) this.logLines.splice(0, this.logLines.length - LOG_LIMIT);
      this.emit('log', line);
    }

    exportLog() {
      return this.logLines.map((l) => `${new Date(l.t).toISOString()} ${l.dir} ${l.hex}`).join('\n');
    }

    // -------------------------------------------------------- connecting

    /**
     * Looks for the keyboard and attaches to the best interface that speaks the protocol: one that hands over the
     * settings wins, and only when none does is an interface that merely answered kept (a sleeping keyboard behind
     * the dongle, or a link that is up but silent) so wake events and retries can bring it up.
     */
    connectAuto(opts = {}) {
      if (this._connecting) {
        // Background looks never pile up. A click from the user is different: a connect pass on a silent keyboard
        // takes 15 to 20 seconds, and answering "Try again" with an instant, invisible `false` made the button look
        // broken (it took ten or more clicks to get one through). The click joins the pass that is running and makes
        // it visible.
        if (opts.quiet) return Promise.resolve(false);
        if (this._quietRun) {
          this._quietRun = false;
          if (!this.ready) this._setStatus('connecting', WAKE_HINT);
        }
        return this._connectRun;
      }
      this._connectRun = this._connectAuto(opts);
      return this._connectRun;
    }

    async _connectAuto(opts = {}) {
      this._connecting = true;
      if (!this.ready && !this._tryingSince) this._tryingSince = Date.now();
      // A quiet retry (background watchdog) must not make the UI flicker through "searching".
      this._quietRun = !!opts.quiet && (!this.connected || this.status !== 'ready');
      const rounds = Math.max(1, opts.rounds ?? this.connectRounds);
      const held = [];
      try {
        if (this._quietRun) this.emit('busy', true);
        else this._setStatus('searching');
        // Let go of the current link completely before anything is opened. The new link can be on the very same
        // HID device, and closing the old one afterwards would shut the device under the new one.
        this._detach();
        await this._closing;
        // The first contact with an idle wireless keyboard is the unreliable one: the handle can be deaf until it is
        // closed and opened again, or the radio is still waking up. That is what pressing "Try again" a few times
        // cured, so it is done here, quietly, and an error is only reported when every round has failed.
        for (let round = 1; round <= rounds; round++) {
          const detail = round > 1 ? wakeDetail(round, rounds) : '';
          const out = await this._connectRound(held, { last: round === rounds, detail });
          if (out.done) return out.ok;
          this._note(`connect round ${round} of ${rounds} did not get settings: closing everything and trying again`);
          if (!this._quietRun) this._setStatus('connecting', wakeDetail(round + 1, rounds));
          await sleep(this.retryGapMs * round);
          this._detach();
          await this._closing;
        }
        return false;
      } finally {
        await Promise.all(held.splice(0).map((x) => this._release(x))).catch(() => {});
        this._connecting = false;
        this._connectRun = null;
        this._quietRun = true;
        this._probes.clear();
        this.emit('busy', false);
        // Something was plugged in or out while this ran, so what it saw may already be out of date. Even a link that
        // came up "ready" can be on an interface that has just gone, so check it rather than trust it.
        if (this._again) {
          this._again = false;
          setTimeout(() => this.deviceListChanged().catch(() => {}), 0);
        }
      }
    }

    /**
     * One pass over every interface. Resolves { done: true, ok } when the outcome is final, or { done: false } when
     * nothing usable came of it yet and the caller should close everything and try the whole pass again.
     */
    async _connectRound(held, { last, detail = '' }) {
      const list = this.discover ? await this.discover() : [];
      this.candidates = list.map((c) => c.meta);
      this._noteCable(list);
      if (!list.length) {
        this._setStatus('idle');
        return { done: true, ok: false };
      }
      const usable = list.filter((c) => c.meta.supported !== false);
      if (!usable.length) {
        this._setStatus('unsupported', list.map((c) => c.meta.label).join(', '));
        return { done: true, ok: false };
      }
      for (const c of usable) {
        if (!this._quietRun) this._setStatus('connecting', detail);
        const h = await this._tryOpen(c);
        if (!h) continue;
        if (h.probe.served) {
          await Promise.all(held.splice(0).map((x) => this._release(x)));
          return this._finishRound(h, last);
        }
        held.push(h);
      }
      if (held.length) {
        const [first, ...rest] = held.splice(0);
        await Promise.all(rest.map((x) => this._release(x)));
        // Awake according to the dongle but not handing over settings: the keyboard is not ready yet. Reporting that
        // as an error is what made the first attempts fail, so look again from a clean handle instead.
        if (first.probe.online && !last) {
          await this._release(first);
          return { done: false };
        }
        return this._finishRound(first, last);
      }
      if (!last && !usable.every((c) => c.openError)) return { done: false };
      // Every interface refused to open: another program has them, which is a different problem from silence.
      this.error = usable.every((c) => c.openError)
        ? 'The system would not let the app open the keyboard. Another program, such as the official AULA driver, is probably using it. On Linux, also check that the udev rule from the README is installed (and replug the keyboard).'
        : usable.some((c) => c.meta.mode === 'wired')
        ? 'The keyboard did not answer over the USB-C cable. Unplug the cable, wait five seconds and plug it in again, and close any other AULA software. If it still fails, use Settings, Connection help, Save compatibility report: the cable uses its own protocol and the report shows what it said.'
        : 'The keyboard did not answer on any interface.';
      this._setStatus('error', this.error);
      return { done: true, ok: false };
    }

    /** Commits an interface. When reading its settings fails and rounds remain, the link is dropped so the caller can retry. */
    async _finishRound(h, last) {
      const ok = await this._commit(h, { final: last });
      if (ok === 'retry') {
        this._detach();
        await this._closing;
        return { done: false };
      }
      return { done: true, ok };
    }

    /**
     * Something was plugged in or unplugged. Drops a link whose interface is gone, and whenever the keyboard is not
     * up and running looks again straight away: a cable that was just plugged in can now beat a sleeping dongle, and
     * a dongle that came back is found without waiting for the next background look.
     */
    async deviceListChanged() {
      if (this._connecting) {
        this._again = true;
        return false;
      }
      if (this.connected && this.ifaceId && this.discover) {
        const list = await this.discover().catch(() => []);
        // The cable can be plugged in or out while the keyboard keeps talking through the dongle: that is what decides
        // whether the charging bolt shows, so it is read here every time, not only when the link has to change.
        this._noteCable(list);
        if (!list.some((c) => c.meta.id === this.ifaceId)) this.disconnect('Keyboard disconnected.');
      }
      if (this.connected && this.status !== 'asleep' && this.status !== 'error') return false;
      if (this._applying) return false;
      this.restartGrace();
      return this.connectAuto({ quiet: true });
    }

    /**
     * The computer woke from sleep or the screen was unlocked. USB devices can come back with a dead handle and no
     * plug event, and waiting for three failed health checks leaves the app dead for the better part of a minute.
     * Asks the link a question; any answer means the handle works (awake or asleep is checkOnline's business), and
     * silence means starting over from a clean open.
     */
    async revive() {
      if (this._connecting || this._applying) return false;
      if (this.transport && this.status !== 'error') {
        const t = this.transport;
        try {
          await this._isOnline(t);
          if (this.transport === t) {
            this._fails = 0;
            await this.checkOnline();
            return true;
          }
        } catch (_) {
          /* a dead handle: fall through and start over */
        }
        if (this.transport !== t) return this.connected; // replaced while asking
        this._note('woke up and the link did not answer: closing it and starting over');
        // Starting over is a stretch of trying: a failed first read is not shown as an error at once.
        this._tryingSince = Date.now();
      }
      return this.connectAuto({ quiet: true });
    }

    /** Attaches to one candidate if it answers the protocol. Resolves true when attached. */
    async attach(candidate) {
      this._detach();
      await this._closing;
      this._setStatus('connecting');
      const h = await this._tryOpen(candidate);
      return h ? this._commit(h) : false;
    }

    /** Opens a candidate and asks what it is. Resolves { c, t, probe } when it speaks the protocol, else closes it and resolves null. */
    async _tryOpen(c) {
      const { io, meta } = c;
      let t = null;
      try {
        if (io.open) await withTimeout(Promise.resolve(io.open()), this.ioTimeoutMs, 'The system did not answer when the app opened the keyboard.');
        const Link = io.sendFeature ? FeatureTransport : Transport;
        t = new Link(io, { timeout: this.transportTimeout, sendTimeout: this.ioTimeoutMs, log: (d, p) => this._log(d, p) });
        this._probes.add(t);
        // The dongle announcing that the keyboard is online while it is being probed: ask again now.
        t.on('event', (e) => {
          if (e.kind === 2) t.poke();
        });
        this._probeWhy = '';
        const probe = await this._probe(t, meta.mode);
        const how = `${meta.mode || 'unknown'}${t.kind === 'feature' ? ', feature report' : ''}`;
        this._note(`${meta.id || meta.label || 'interface'} (${how}): ${probe.ok ? `answers, online=${probe.online}, settings=${probe.served ? 'served' : 'not served'}` : `no answer${this._probeWhy ? ` (${this._probeWhy})` : ''}`}`);
        if (probe.ok) return { c, t, probe };
      } catch (err) {
        const why = err && err.message ? err.message : String(err);
        if (!t) c.openError = why; // never got as far as talking: the device itself refused to open
        this._note(`${meta.id || meta.label || 'interface'}: could not be opened (${why})`);
      }
      if (t) t.close();
      await this._closeIo(io);
      return null;
    }

    /** Closes a HID device without ever waiting longer than ioTimeoutMs (close() can hang on Windows). Never throws. */
    _closeIo(io) {
      if (!io || !io.close) return Promise.resolve();
      return withTimeout(Promise.resolve().then(() => io.close()), this.ioTimeoutMs, 'close timed out').catch(() => {});
    }

    async _release(h) {
      h.t.close();
      await this._closeIo(h.c.io);
    }

    /** Makes an opened, probed interface the session's link and reads the settings from it. */
    async _commit(h, { final = true } = {}) {
      const { c, t, probe } = h;
      const { io, meta } = c;
      this._detach();
      await this._closing;
      this.transport = t;
      this.io = io;
      this.mode = meta.mode || 'unknown';
      this.iface = meta.label || 'Keyboard';
      this.ifaceId = meta.id || null;
      this.productName = meta.name || '';
      this.link = t.kind || 'output';
      this._flagLink = probe.flag;
      this._fails = 0;
      this._batFails = 0;
      this._errTicks = 0;
      this._errGap = 1;
      t.on('event', (e) => this._onEvent(e));
      this._startPolling();
      if (!probe.online) {
        this._setStatus('asleep');
        return true;
      }
      // Unsaved edits survive a change of interface (a cable plugged in while the dongle was asleep, say).
      if (this.cur && this.dev0 && this.dirtyKeys().length) {
        this._setStatus('ready');
        return true;
      }
      try {
        // Until the last round a failed read is not shown as an error: the caller reopens the device and asks again.
        await this.refresh({ restore: true, patient: true, quietError: !final });
      } catch (_) {
        if (!final) return 'retry';
        /* refresh() already set the error status; keep the link so polling can retry */
      }
      return true;
    }

    /**
     * How to keep asking a link that may be asleep: many short tries across the same window instead of two long ones.
     * A reply that comes late is still taken (the transport keeps its queue between tries), so nothing is lost, but a
     * request dropped right after the device was opened is repeated after 0.4 s, not after 2 s, and a keyboard that
     * wakes up meets a request that is at most 0.5 s old.
     */
    _burst(windowFactor = 3) {
      const timeout = Math.max(30, Math.round(this.transportTimeout * 0.4));
      return { timeout, tries: Math.max(2, Math.round((this.transportTimeout * windowFactor) / (timeout + 100))) };
    }

    /**
     * The keyboard has just been touched (a key pressed, the window used, the PC woke up, the dongle reported it is
     * online): stop waiting and look right now, wherever the connection currently is.
     */
    poke() {
      if (this.ready || this.status === 'unsupported') return;
      this._errGap = 1;
      this._errTicks = 0;
      for (const t of this._probes) t.poke();
      if (this.transport) this.transport.poke();
      if (this._connecting) return;
      if (this.transport && this.status === 'asleep' && !this._checking) this.checkOnline().catch(() => {});
      else if (this.transport && this.status === 'error') this.connectAuto({ quiet: true }).catch(() => {});
      else if (!this.transport) this.nudge();
    }

    /** Reads the lighting block. Resolves it when valid, otherwise null (never throws). */
    async _ledBlock(t, tries = 2, timeout) {
      try {
        const led = await t.readBlock(P.CMD.GET_LED, 0, tries, timeout);
        if (!P.isValidLed(led)) {
          this._probeWhy = 'the lighting block did not pass its integrity check';
          return null;
        }
        return led;
      } catch (err) {
        // Not shown on its own (a sleeping keyboard is silent by design), but it goes into the log line for the probe.
        this._probeWhy = err && err.message ? err.message : String(err);
        return null;
      }
    }

    /**
     * Decides whether an interface speaks the protocol and whether the keyboard behind it is awake.
     *  ok      the interface answered something
     *  online  the keyboard is awake
     *  served  the interface really hands over the lighting block (the only proof that settings can be read)
     *  flag    whether GET_ONLINE is the awake/asleep signal on this link (dongle) or not (cable)
     * The 2.4G dongle answers GET_ONLINE by itself, so an answer there proves little: the flag can read 0 for a keyboard
     * that is awake (it lags, or the dongle was power cycled), and it can read 1 on an interface that never serves
     * settings. Both are settled by asking for the lighting block.
     */
    async _probe(t, mode) {
      const wait = this._burst();
      let ledTried = false;
      if (!usesOnlineFlag(mode)) {
        ledTried = true;
        const patient = t.kind === 'feature'; // a request the cable has not seen before can take a moment to be answered
        if (await this._ledBlock(t, patient ? wait.tries : 2, patient ? wait.timeout : undefined)) return { ok: true, online: true, served: true, flag: false };
        if (mode === 'wired') return { ok: false, online: false, served: false, flag: false };
      }
      let flag = null;
      try {
        // The dongle answers this one by itself, so a short timeout is right: a request lost right after the device
        // was opened is sent again after 0.3 s, not after a full second.
        const d = await t.readBlock(P.CMD.GET_ONLINE, 0, 4, Math.max(30, Math.round(this.transportTimeout * 0.3)));
        flag = d[0] === 1;
      } catch (_) {
        /* not answering GET_ONLINE; try the config block instead */
      }
      if (flag === true) {
        const served = !!(await this._ledBlock(t, wait.tries, wait.timeout));
        return { ok: true, online: true, served, flag: true };
      }
      if (flag === false) {
        // Reads as asleep. A keyboard that is really awake still serves its settings, so ask before believing it.
        const brief = this._burst(2);
        if (!ledTried && (await this._ledBlock(t, brief.tries, brief.timeout))) return { ok: true, online: true, served: true, flag: true };
        return { ok: true, online: false, served: false, flag: true };
      }
      if (!ledTried && (await this._ledBlock(t, wait.tries, wait.timeout))) return { ok: true, online: true, served: true, flag: false };
      return { ok: false, online: false, served: false, flag: true };
    }

    /** Drops the link at once. The HID device is closed in the background; `_closing` resolves when it has been. */
    _detach() {
      this._stopPolling();
      if (this._wakeTimer) clearTimeout(this._wakeTimer);
      this._wakeTimer = null;
      const io = this.io;
      if (this.transport) this.transport.close();
      this.transport = null;
      this.io = null;
      if (io && io.close) {
        const closing = this._closeIo(io);
        this._closing = Promise.all([this._closing, closing]).then(() => undefined);
      }
    }

    disconnect(detail = '') {
      this._rose = 0;
      this._detach();
      this.cur = null;
      this.dev0 = null;
      this.mode = null;
      this.link = null;
      this.readable = { led: true, rgb: true, colors: true };
      this.iface = null;
      this.ifaceId = null;
      this.productName = '';
      this._setStatus('idle', detail);
      this.emit('change');
    }

    /** Called when a health check fails. Three in a row means the link is gone. */
    _noteFail() {
      this._fails++;
      if (this._fails >= 3) {
        this.disconnect('The keyboard stopped responding.');
        this.emit('lost');
      }
    }

    _onEvent(e) {
      if (e.kind !== 2) return;
      if (this._wakeTimer) clearTimeout(this._wakeTimer);
      this._wakeTimer = setTimeout(() => this.checkOnline(), 250);
    }

    /**
     * Is the keyboard awake? Uses GET_ONLINE on the dongle and a settings read on the cable. When the dongle says
     * "asleep" a settings read double-checks it, because the flag can lag behind a keyboard that is awake. While the
     * keyboard really is asleep that check is silent and costs a timeout, so it is only repeated every few seconds.
     */
    async _isOnline(t = this.transport) {
      if (this._flagLink) {
        const d = await t.readBlock(P.CMD.GET_ONLINE, 0, 2);
        if (d[0] === 1) return true;
        const gap = this.status === 'asleep' ? 8000 : 0;
        if (Date.now() - this._lastCross < gap) return false;
        this._lastCross = Date.now();
        return !!(await this._ledBlock(t, 1));
      }
      return P.isValidLed(await t.readBlock(P.CMD.GET_LED, 0, 2));
    }

    async checkOnline() {
      if (!this.transport || this._applying) return;
      if (this._checking) {
        this._recheck = true; // e.g. the keyboard woke while an "is it asleep?" check was still waiting for silence
        return;
      }
      this._checking = true;
      const t = this.transport;
      try {
        const online = await this._isOnline(t);
        // The link may have been replaced while this was waiting. What an old link answered says nothing about the new one.
        if (this.transport !== t) return;
        this._fails = 0;
        if (online && this.status !== 'ready' && this.status !== 'reading') {
          if (this.cur && this.dirtyKeys().length) this._setStatus('ready');
          else {
            // It woke up: from here on this is a stretch of trying, so a failed read is not shown as an error at once.
            if (!this._tryingSince) this._tryingSince = Date.now();
            await this.refresh({ restore: true });
          }
        } else if (!online && this.status === 'ready') {
          this._setStatus('asleep');
        }
      } catch (_) {
        if (this.transport === t) this._noteFail(); // a failure on a link that has since been replaced is not the new link's
      } finally {
        this._checking = false;
        if (this._recheck) {
          this._recheck = false;
          if (this.transport) setTimeout(() => this.checkOnline(), 50);
        }
      }
    }

    // ----------------------------------------------------------- reading

    /**
     * Reads every block from the keyboard. With `restore: true` (used when connecting and when the keyboard wakes up,
     * never for the manual Refresh button) it then writes the remembered settings back if the keyboard no longer has them.
     */
    async refresh(opts = {}) {
      const t = this.transport;
      if (!t) throw new CommError('not connected');
      this._setStatus('reading');
      const wait = opts.patient ? this._burst() : { tries: 3, timeout: undefined };
      try {
        const got = {};
        const readable = { led: true, rgb: true, colors: true };
        for (const k of ORDER) {
          // The cable may not hand over the palette or the per-key colours. The lighting block is what the app cannot do
          // without; for the others a stand-in is used, and the screen says so.
          const optional = t.optionalBlocks && k !== 'led';
          if (optional && t.unreadable && t.unreadable.has(k)) {
            readable[k] = false;
            continue;
          }
          try {
            got[k] = await t.readBlock(BLOCKS[k].get, 0, optional ? 2 : wait.tries, optional ? undefined : wait.timeout);
          } catch (err) {
            if (!optional) throw err;
            readable[k] = false;
            (t.unreadable = t.unreadable || new Set()).add(k);
            this._note(`the keyboard did not hand over its ${k === 'rgb' ? 'palette' : 'per-key colours'} over the USB-C cable (${err.message}); carrying on without it`);
          }
        }
        if (!P.isValidLed(got.led)) throw new CommError('The lighting block did not pass its integrity check.');
        if (readable.rgb && (!got.rgb || !got.rgb.length)) readable.rgb = false;
        if (!readable.rgb) got.rgb = P.defaultRgb();
        if (readable.colors && (!got.colors.length || got.colors.length % 3)) throw new CommError('The per-key colour block has an unexpected size.');
        if (!readable.colors) got.colors = P.defaultColors();
        this.readable = readable;
        this.dev0 = clone(got);
        this.cur = clone(got);
        this._learnBrightness(got.led);
        this._backupOnce();
        this._lastSync = Date.now();
        this._setStatus('ready');
        this.emit('change');
      } catch (err) {
        this.error = err.message;
        if (!opts.quietError) this._setStatus('error', err.message);
        throw err;
      }
      if (opts.restore) await this._restoreKept().catch(() => {});
      await this.pollBattery().catch(() => {});
    }

    // ------------------------------------------------------ brightness range

    _loadBrightMax() {
      let n = NaN;
      try {
        n = Number(this.storage.getItem(KEY.brightMax));
      } catch (_) {
        /* unreadable: use the default */
      }
      return Number.isInteger(n) ? Math.min(P.BRIGHT_CAP, Math.max(P.LEVEL_MAX, n)) : P.LEVEL_MAX;
    }

    /** Sets how many brightness levels the app offers (4..BRIGHT_CAP) and remembers it. */
    setBrightMax(n) {
      const v = Math.min(P.BRIGHT_CAP, Math.max(P.LEVEL_MAX, Math.round(Number(n) || P.LEVEL_MAX)));
      if (v === this.brightMax) return v;
      this.brightMax = v;
      try {
        this.storage.setItem(KEY.brightMax, String(v));
      } catch (_) {
        /* the choice just is not remembered */
      }
      this.emit('change');
      return v;
    }

    /** A keyboard that reports a brightness above what the app offers has more levels: offer them, and keep them. */
    _learnBrightness(led) {
      const e = P.effectOf(P.getMode(led));
      if (e && e.slot >= 0 && P.getBrightness(led, e) > this.brightMax) this.setBrightMax(P.getBrightness(led, e));
    }

    // ------------------------------------------------- remembered settings

    /**
     * The app keeps its own copy of the last settings that were written and verified, on this computer. Some keyboards and
     * dongles come back from a restart, a power cycle or sleep with factory lighting; the copy lets the app put things back.
     * Not used with the demo keyboard, so playing with it can never overwrite what belongs to the real one.
     */
    get keepEnabled() {
      try {
        return this.storage.getItem(KEY.keepOn) === '1'; // off unless the person switched it on
      } catch (_) {
        return false;
      }
    }

    /** True while remembered settings are being written back (the editable copy temporarily differs from the keyboard). */
    get restoring() {
      return this._restoring;
    }

    get keepActive() {
      return this.keepEnabled && this.mode !== 'demo';
    }

    setKeep(on) {
      try {
        this.storage.setItem(KEY.keepOn, on ? '1' : '0');
      } catch (_) {
        /* ignore */
      }
      this.emit('keep');
    }

    keepSnapshot() {
      try {
        const raw = this.storage.getItem(KEY.keep);
        if (!raw) return null;
        const o = JSON.parse(raw);
        if (!o || !Array.isArray(o.led) || !Array.isArray(o.rgb) || !Array.isArray(o.colors)) return null;
        const snap = { at: Number(o.at) || 0, led: Uint8Array.from(o.led), rgb: Uint8Array.from(o.rgb), colors: Uint8Array.from(o.colors) };
        return P.isValidLed(snap.led) ? snap : null;
      } catch (_) {
        return null;
      }
    }

    /** Stores the given blocks as the remembered settings. Blocks left out keep their remembered value. */
    _saveKeep(blocks) {
      if (!this.keepActive) return;
      const prev = this.keepSnapshot();
      const next = {
        at: Date.now(),
        led: Array.from(blocks.led || (prev && prev.led) || []),
        rgb: Array.from(blocks.rgb || (prev && prev.rgb) || []),
        colors: Array.from(blocks.colors || (prev && prev.colors) || []),
      };
      if (!next.led.length || !next.rgb.length || !next.colors.length) return;
      try {
        this.storage.setItem(KEY.keep, JSON.stringify(next));
      } catch (_) {
        /* storage full or unavailable: the keyboard keeps its own copy as before */
      }
      this.emit('keep');
    }

    /** Remembers what the keyboard has now (only what was really read from it on this link). */
    rememberNow() {
      if (this.dev0) this._saveKeep(readableOnly(this.dev0, this.readable));
    }

    forgetKeep() {
      try {
        this.storage.removeItem(KEY.keep);
      } catch (_) {
        /* ignore */
      }
      this.emit('keep');
    }

    /** True when the keyboard's current settings differ from the remembered ones (the apply flag is ignored). */
    keepDiffers() {
      const snap = this.keepSnapshot();
      if (!snap || !this.dev0) return false;
      const r = this.readable;
      if ((r.rgb && snap.rgb.length !== this.dev0.rgb.length) || (r.colors && snap.colors.length !== this.dev0.colors.length)) return false;
      return !P.sameLed(P.keepLedFor(snap.led, this.dev0.led), this.dev0.led) || (r.rgb && !P.same(snap.rgb, this.dev0.rgb)) || (r.colors && !P.same(snap.colors, this.dev0.colors));
    }

    /**
     * Writes the remembered settings to the keyboard when it does not have them. Returns
     * { restored, ok, reason }. It never runs over unsaved edits and tries once per call (no retry loop).
     */
    async _restoreKept(opts = {}) {
      if (!this.keepActive && !opts.force) return { restored: false, reason: 'off' };
      if (this._lowLight) return { restored: false, reason: 'low-battery light' }; // the low-battery light puts the lighting back itself
      if (!this.transport || !this.cur || this._applying || this._restoring) return { restored: false, reason: 'busy' };
      if (this.dirtyKeys().length) return { restored: false, reason: 'edits' };
      const snap = this.keepSnapshot();
      if (!snap) {
        // First run: remember what the keyboard has now, so later changes made on the keyboard are followed too.
        this._saveKeep(readableOnly(this.dev0, this.readable));
        return { restored: false, reason: 'first' };
      }
      if ((this.readable.rgb && snap.rgb.length !== this.dev0.rgb.length) || (this.readable.colors && snap.colors.length !== this.dev0.colors.length)) {
        return { restored: false, reason: 'layout' };
      }
      if (!this.keepDiffers()) return { restored: false, reason: 'same' };

      this._restoring = true;
      try {
        this._note('keyboard settings differ from the remembered ones: writing the remembered settings back');
        if (snap.led[P.OFF.KNOB] !== this.dev0.led[P.OFF.KNOB]) {
          this._note('the knob function is left as the keyboard has it (hold the knob on the keyboard to change it)');
        }
        // Only what was really read on this link is put back; a stand-in block stays as it is.
        this.cur = {
          led: P.keepLedFor(snap.led, this.dev0.led), // the knob function stays as the keyboard has it
          rgb: this.readable.rgb ? snap.rgb.slice() : this.dev0.rgb.slice(),
          colors: this.readable.colors ? snap.colors.slice() : this.dev0.colors.slice(),
        };
        this.emit('change');
        const r = await this.apply(null, { restore: true });
        this.emit('restored', r);
        return { restored: true, ok: r.ok && r.modeOk, reason: 'written' };
      } catch (err) {
        // The write failed part way. Show the keyboard's real state again and leave the remembered copy untouched.
        this.cur = clone(this.dev0);
        this.emit('change');
        this.emit('restored', { ok: false, error: err.message, written: [] });
        return { restored: true, ok: false, reason: 'error' };
      } finally {
        this._restoring = false;
      }
    }

    /** Restore on demand (the "Restore now" button), even when nothing seems to differ. */
    async restoreNow() {
      if (!this.ready) throw new CommError('not connected');
      if (this.mode === 'demo') return { restored: false, reason: 'demo' };
      if (this.dirtyKeys().length) return { restored: false, reason: 'edits' };
      const snap = this.keepSnapshot();
      if (!snap) return { restored: false, reason: 'none' };
      if (!this.keepDiffers()) return { restored: false, reason: 'same' };
      return this._restoreKept({ force: true });
    }

    // ------------------------------------------------- low-battery light

    /** True while the red low-battery light is on the keyboard. */
    get lowLight() {
      return !!this._lowLight;
    }

    _loadLowLight() {
      try {
        const raw = this.storage.getItem(KEY.lowLight);
        if (!raw) return null;
        const o = JSON.parse(raw);
        if (!o || !Array.isArray(o.led) || !Array.isArray(o.rgb) || !Array.isArray(o.colors)) return null;
        const saved = { led: Uint8Array.from(o.led), rgb: Uint8Array.from(o.rgb), colors: Uint8Array.from(o.colors) };
        return P.isValidLed(saved.led) ? { saved, at: Number(o.at) || 0 } : null;
      } catch (_) {
        return null;
      }
    }

    _clearLowLight() {
      this._lowLight = null;
      try {
        this.storage.removeItem(KEY.lowLight);
      } catch (_) {
        /* ignore */
      }
      this.emit('lowlight', false);
    }

    /** Writes the lighting that was on the keyboard before the red light back to it. */
    async _putBackLighting(saved) {
      this.cur = {
        led: P.keepLedFor(saved.led, this.dev0.led), // the knob function stays as the keyboard has it
        rgb: this.readable.rgb ? saved.rgb.slice() : this.dev0.rgb.slice(),
        colors: this.readable.colors ? saved.colors.slice() : this.dev0.colors.slice(),
      };
      this.emit('change');
      return this.apply(null, { restore: true, lowLight: true, exactLed: true });
    }

    /**
     * Turns the red low-battery light on or off.
     *
     * On: the lighting the keyboard has now is kept (in memory and on disk, so a restart of the app does not lose it), then
     * the Breathing effect is written in red at half of the keyboard's brightness levels. Off: the kept lighting is written
     * back. The red light is never remembered as the person's own settings, and if the person applies lighting of their own
     * while it is on, that ends it without anything being put back.
     *
     * Returns { state: 'on' | 'off', changed, reason? }. `reason` says why nothing was written: 'not-connected', 'busy', 'edits'
     * (unsent edits would be lost), 'no-palette' (the cable did not hand over the colour table, so red cannot be set without
     * overwriting it with a stand-in) or 'error' / 'write-failed'.
     */
    async setLowLight(on) {
      const state = () => (this._lowLight ? 'on' : 'off');
      const skip = (reason) => ({ state: state(), changed: false, reason });
      if (!!on === !!this._lowLight) return { state: state(), changed: false };
      if (!this.ready || !this.transport || !this.cur || !this.dev0) return skip('not-connected');
      if (this._applying || this._restoring || this._lowBusy) return skip('busy');
      if (this.dirtyKeys().length) return skip('edits');

      if (on) {
        if (!this.readable.rgb) return skip('no-palette');
        const eff = P.effectOf(LOW_LIGHT.mode);
        const saved = clone(this.dev0);
        this._lowBusy = true;
        try {
          // Kept on disk before anything is written: if the app closes while the light is red, the next start can put it back.
          try {
            this.storage.setItem(KEY.lowLight, JSON.stringify({ at: Date.now(), led: Array.from(saved.led), rgb: Array.from(saved.rgb), colors: Array.from(saved.colors) }));
          } catch (_) {
            /* storage full or unavailable: the light still works, it just cannot be put back after a restart */
          }
          const next = clone(this.dev0);
          P.setMode(next.led, eff.mode);
          P.setBrightness(next.led, eff, Math.max(1, Math.round(this.brightMax * LOW_LIGHT.brightness)));
          P.setSpeed(next.led, eff, LOW_LIGHT.speed);
          P.setColorIndex(next.led, eff, 0);
          P.setPaletteColor(next.rgb, eff, 0, LOW_LIGHT.colour);
          this.cur = next;
          this.emit('change');
          this._note('battery is low: writing the red breathing light');
          const r = await this.apply(null, { noKeep: true, lowLight: true });
          if (r.ok && r.modeOk) {
            this._lowLight = { saved, at: Date.now() };
            this.emit('lowlight', true);
            return { state: 'on', changed: true };
          }
          // The keyboard did not keep it: put the lighting back and say so.
          try {
            await this._putBackLighting(saved);
          } catch (_) {
            /* the keyboard may be gone; the read-back on the next connection shows what it holds */
          }
          this.cur = clone(this.dev0);
          this.emit('change');
          try {
            this.storage.removeItem(KEY.lowLight);
          } catch (_) {
            /* ignore */
          }
          return skip('write-failed');
        } catch (err) {
          this._note(`the red low-battery light could not be written: ${err.message}`);
          this.cur = this.dev0 ? clone(this.dev0) : this.cur;
          this.emit('change');
          return skip('error'); // the saved copy stays, so a later "off" still puts the lighting back
        } finally {
          this._lowBusy = false;
        }
      }

      const { saved } = this._lowLight;
      const r = this.readable;
      if (saved.rgb.length !== this.dev0.rgb.length || (r.colors && saved.colors.length !== this.dev0.colors.length)) {
        // Another keyboard than the one the lighting was kept from: there is nothing that can be put back on it.
        this._clearLowLight();
        return { state: 'off', changed: true, reason: 'layout' };
      }
      this._lowBusy = true;
      try {
        this._note('battery is no longer low: putting the lighting back');
        const back = await this._putBackLighting(saved);
        if (back.ok && back.modeOk) {
          this._clearLowLight();
          return { state: 'off', changed: true };
        }
        this.cur = clone(this.dev0);
        this.emit('change');
        return skip('write-failed');
      } catch (err) {
        this._note(`the lighting could not be put back after the low-battery light: ${err.message}`);
        this.cur = clone(this.dev0);
        this.emit('change');
        return skip('error');
      } finally {
        this._lowBusy = false;
      }
    }

    /**
     * Notices a change made on the keyboard itself (Fn shortcuts, the knob) while the app is connected and idle,
     * shows it, and remembers it, so a later reset puts back what you chose last rather than something older.
     * Only reads; it writes nothing to the keyboard.
     */
    async _syncFromKeyboard() {
      this._lastSync = Date.now();
      const t = this.transport;
      let led;
      try {
        led = await t.readBlock(P.CMD.GET_LED, 0, 2);
      } catch (_) {
        return this.checkOnline();
      }
      if (!this.cur || !this.dev0 || this._applying || this._restoring || this.dirtyKeys().length) return;
      if (!P.isValidLed(led) || P.sameLed(led, this.dev0.led)) return;

      const now = Date.now();
      this._syncHits = this._syncHits.filter((x) => now - x < 120000);
      this._syncHits.push(now);
      if (this._syncHits.length > 6) {
        // Some byte changes constantly on this unit. Stop following the keyboard instead of churning the screen.
        this._syncOff = true;
        this._note('the lighting block keeps changing by itself; no longer following changes made on the keyboard');
        return;
      }
      const changed = [];
      for (let i = 0; i < led.length && changed.length < 12; i++) {
        if (i !== P.OFF.APPLY && led[i] !== this.dev0.led[i]) {
          changed.push(`0x${i.toString(16).padStart(2, '0')}: ${this.dev0.led[i].toString(16).padStart(2, '0')} -> ${led[i].toString(16).padStart(2, '0')}`);
        }
      }
      this._note(`keyboard changed its own lighting settings (${changed.join(', ') || 'apply flag only'})`);
      this.dev0.led = led;
      this.cur.led = led.slice();
      this._learnBrightness(led);
      if (!this._lowLight) this._saveKeep({ led }); // while the red light is on, what the keyboard shows is not the person's choice
      this.emit('change');
    }

    // ----------------------------------------------------------- battery

    async pollBattery() {
      if (!this.transport) return null;
      if (this.transport.noBattery) return null; // the USB-C cable has no battery report; asking would only wait for silence
      let p = null;
      let d = null;
      try {
        d = await this.transport.readBlock(P.CMD.GET_STATUS, 0, 2);
        p = P.parseBattery(d);
      } catch (err) {
        this._batFails++;
        throw err;
      }
      this._batFails = 0;
      // Keep the raw status bytes in the connection log whenever they change, so that if the keyboard reports a charging
      // flag next to the percentage it can be found by plugging the cable in and out and reading the log.
      const hex = Array.from((d || []).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join(' ');
      if (hex !== this._lastStatusHex) {
        this._lastStatusHex = hex;
        this._note(`battery status bytes: ${hex}`);
      }
      if (p !== null) this.setBattery(p, this.mode === 'wired' ? 'usb' : this.mode === 'demo' ? 'demo' : 'dongle');
      return p;
    }

    setBattery(percent, source) {
      const prev = this.battery;
      const now = Date.now();
      // Only a reading from the same source, a little while ago, says which way the level is going.
      const comparable = prev.percent !== null && prev.source === source && now - prev.at < 20 * 60 * 1000;
      if (comparable && percent > prev.percent) this._rose = now;
      else if (comparable && percent < prev.percent) this._rose = 0;
      this.battery = { percent, at: now, source };
      this._record(percent, source);
      if (percent <= 90) this._fullArmed = true;
      this.emit('battery', this.battery);
      // Full: a reading of 100 that came after a lower one, so the keyboard got there by charging. A first reading of 100
      // (the app was just opened) says nothing about charging and is not announced.
      if (comparable && percent >= 100 && prev.percent < 100 && this._fullArmed) {
        this._fullArmed = false;
        this.emit('full', this.battery);
      }
    }

    _loadHistory() {
      try {
        const a = JSON.parse(this.storage.getItem(KEY.history) || '[]');
        return Array.isArray(a) ? a.filter((x) => x && Number.isFinite(x.t) && Number.isFinite(x.p)) : [];
      } catch (_) {
        return [];
      }
    }

    _record(p, source) {
      const last = this.history[this.history.length - 1];
      const now = Date.now();
      const c = this.charging ? 1 : 0; // lets the Battery tab colour charging hours and tell charging from using
      if (last && last.p === p && !!last.c === !!c && now - last.t < 10 * 60 * 1000) return;
      this.history.push({ t: now, p, s: source, c });
      if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);
      try {
        this.storage.setItem(KEY.history, JSON.stringify(this.history));
      } catch (_) {
        /* storage full or unavailable: history just won't persist */
      }
    }

    clearHistory() {
      this.history = [];
      try {
        this.storage.removeItem(KEY.history);
      } catch (_) {
        /* ignore */
      }
    }

    // ---------------------------------------------------------- watching

    /**
     * Keeps looking for the keyboard whenever there is no working link, without flicker, and backs off while nothing
     * turns up (3 s, then slower, up to 15 s). `nudge()` runs a look straight away and resets the back-off: the app calls
     * it when the window is shown or focused and when anything is plugged or unplugged.
     */
    watch(opts = {}) {
      this.unwatch();
      const base = opts.intervalMs ?? 3000;
      const max = opts.maxMs ?? 15000;
      let misses = 0;
      let kicked = false;
      let stopped = false;
      const schedule = (ms) => {
        if (stopped) return;
        clearTimeout(this._watchTimer);
        this._watchTimer = setTimeout(loop, ms);
        if (this._watchTimer.unref) this._watchTimer.unref();
      };
      const loop = async () => {
        if (stopped) return;
        const asked = kicked;
        kicked = false;
        const searching = !this.connected && !this._connecting && ['idle', 'error', 'unsupported'].includes(this.status);
        if (searching) {
          const ok = await this.connectAuto({ quiet: true, rounds: 1 }).catch(() => false);
          misses = ok ? 0 : misses + 1;
        } else {
          misses = 0;
          // The window was shown or something was plugged in while a link is up but not working: look again now
          // instead of waiting for the next 4 second health check.
          if (asked && this.transport && !this._connecting && !this._checking && !this._applying) {
            if (this.status === 'error') await this.connectAuto({ quiet: true }).catch(() => false);
            else if (this.status === 'asleep') await this.checkOnline().catch(() => {});
          }
        }
        schedule(Math.min(max, base * 1.6 ** misses));
      };
      this._watchKick = () => {
        misses = 0;
        kicked = true;
        schedule(0);
      };
      this._unwatch = () => {
        stopped = true;
        clearTimeout(this._watchTimer);
        this._watchTimer = null;
        this._watchKick = null;
      };
      schedule(opts.firstMs ?? base);
    }

    unwatch() {
      if (this._unwatch) this._unwatch();
      this._unwatch = null;
    }

    nudge() {
      if (this._watchKick) this._watchKick();
    }

    _startPolling() {
      this._stopPolling();
      this._timer = setInterval(() => this._tick(), this.tickMs);
      if (this._timer.unref) this._timer.unref();
    }

    _stopPolling() {
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
    }

    async _tick() {
      if (!this.transport || this._applying || this._connecting) return;
      if (this.status === 'error') {
        // The link is up but will not hand over settings. A second look at the same handle rarely helps, so every
        // other round closes it and starts over, which is what unplugging and replugging would do.
        if (this._checking) return;
        this._errTicks++;
        if (this._errTicks >= this._errGap) {
          this._errTicks = 0;
          this._errGap = Math.min(this._errGap * 2, 8);
          this._note('link is up but silent: closing it and starting over');
          return void (await this.connectAuto({ quiet: true }).catch(() => false));
        }
        return this.checkOnline();
      }
      if (this.status === 'asleep') {
        if (this._checking) return;
        await this.checkOnline();
        // While asleep, check whether something else has come up that can serve settings (a cable plugged in while the
        // keyboard was switched over). Listing devices is cheap; only another interface is worth closing the link for.
        if (this.status === 'asleep' && this.transport && this.discover && Date.now() - this._lastRescan >= this._rescanGap) {
          this._lastRescan = Date.now();
          const list = await this.discover().catch(() => []);
          this._noteCable(list);
          if (list.some((c) => c.meta.supported !== false && c.meta.id !== this.ifaceId)) {
            this._rescanGap = Math.min(this._rescanGap * 2, 120000);
            await this.connectAuto({ quiet: true }).catch(() => false);
          }
        }
        return;
      }
      if (this.status !== 'ready') return;
      await this._lookForCable(); // a plug event that was missed must not leave the charging bolt out
      if (this.status !== 'ready') return;
      if (this.mode !== 'demo' && !this._syncOff && Date.now() - this._lastSync >= this.syncMs && !this.dirtyKeys().length) {
        await this._syncFromKeyboard();
        if (this.status !== 'ready') return;
      }
      if (this.transport.noBattery) {
        // No battery to ask about on the cable, so a read of the lighting block is what shows the link is still alive.
        if (Date.now() - this._lastSync >= this.syncMs) {
          this._lastSync = Date.now();
          await this.checkOnline();
        }
        return;
      }
      // The level moves while the keyboard charges, so it is read more often then. A keyboard that never answers the
      // battery query (some wired modes) is asked rarely instead.
      const base = this.charging ? Math.min(this.chargePollMs, this.pollMs) : this.pollMs;
      const every = this._batFails >= 3 ? this.pollMs * 10 : base;
      if (Date.now() - this.battery.at < every) return;
      try {
        await this.pollBattery();
      } catch (_) {
        await this.checkOnline();
      }
    }

    // ----------------------------------------------------------- editing

    effect() {
      if (!this.cur) return null;
      const mode = P.getMode(this.cur.led);
      return P.effectOf(mode) || { mode, name: `Mode ${mode}`, slot: -1, speed: false, color: false, multi: false, unknown: true };
    }

    _edit(fn) {
      if (!this.cur) return false;
      fn(this.cur);
      this.emit('change');
      return true;
    }

    setEffect(mode) {
      const e = P.effectOf(mode);
      if (!e) return false;
      return this._edit((c) => {
        P.setMode(c.led, mode);
        // Colourful-only effects must run multicolour and Static cannot, so fix the slot now and the
        // preview, the Colour card and what gets written all agree.
        P.settleColor(c.led, e);
      });
    }

    setBrightness(v) {
      return this._edit((c) => P.setBrightness(c.led, this.effect(), Math.min(v, this.brightMax)));
    }

    setSpeed(v) {
      return this._edit((c) => P.setSpeed(c.led, this.effect(), v));
    }

    setColorIndex(i) {
      return this._edit((c) => P.setColorIndex(c.led, this.effect(), i));
    }

    setPaletteColor(j, rgb) {
      const e = this.effect();
      if (!e || e.slot < 0) return false;
      // Editing one colour writes the whole table back. Without the keyboard's own table that would overwrite every other
      // colour with a stand-in, so it is not offered.
      if (!this.readable.rgb) return false;
      return this._edit((c) => P.setPaletteColor(c.rgb, e, j, rgb));
    }

    setSleepValue(v) {
      return this._edit((c) => P.setSleepValue(c.led, v));
    }

    /** Paints the given LED indices; switching to per-key mode happens on apply. */
    paintKeys(leds, rgb) {
      return this._edit((c) => {
        for (const l of leds) P.setKeyColor(c.colors, l, rgb);
      });
    }

    /** fn(led) -> [r,g,b] for each of the given LED indices. */
    paintKeysWith(leds, fn) {
      return this._edit((c) => {
        for (const l of leds) P.setKeyColor(c.colors, l, fn(l));
      });
    }

    dirtyKeys() {
      if (!this.cur || !this.dev0) return [];
      return ORDER.filter((k) => !P.same(this.cur[k], this.dev0[k]));
    }

    get dirty() {
      return this.dirtyKeys().length > 0;
    }

    revert() {
      if (!this.dev0) return;
      this.cur = clone(this.dev0);
      this.emit('change');
    }

    // ------------------------------------------------------------ writing

    /**
     * Writes every changed block in the order the OEM driver uses (config, palette, per-key colours),
     * commits, then reads each block back. `ok: false` means the keyboard answered but did not keep what
     * we sent. `modeOk` says whether the effect the keyboard now reports is the one we asked for.
     */
    async apply(onProgress, opts = {}) {
      if (!this.transport || !this.cur) throw new CommError('not connected');
      if (this._applying) throw new CommError('already applying');
      this._applying = true;
      try {
        // Painting keys means "use per-key mode". A restore writes back exactly what was remembered, mode included.
        if (!opts.restore && this.dirtyKeys().includes('colors') && P.getMode(this.cur.led) !== P.MODE_CUSTOM) {
          P.setMode(this.cur.led, P.MODE_CUSTOM);
        }
        const dirty = this.dirtyKeys();
        if (!dirty.length) return { ok: true, written: [], modeOk: true, committed: false };

        // The OEM driver sends the palette with every config change, even for effects that ignore it. That is done over the
        // dongle only: over the USB-C cable the palette is its own command, and a block that is not being changed is not
        // sent (least written, least that can go wrong on a link no real keyboard has confirmed yet). Never a stand-in.
        const withLed = this.transport.kind !== 'feature' && this.readable.rgb;
        const keys = ORDER.filter((k) => dirty.includes(k) || (k === 'rgb' && dirty.includes('led') && withLed));
        if (keys.includes('led') && !P.isValidLed(this.cur.led)) {
          throw new CommError('Refusing to write a lighting block that fails its integrity check.');
        }

        const t = this.transport;

        // Write only what was edited. Each block is read fresh from the keyboard and just the bytes that differ from
        // what this session last read are replaced. Bytes the app does not know about (the knob function, Fn-key
        // changes made on the keyboard since the last read) therefore are not overwritten by an out-of-date copy.
        const base = {};
        const pre = {}; // what the keyboard held for each block just before this write
        for (const k of keys) {
          let fresh = null;
          try {
            if (this.readable[k]) fresh = await t.readBlock(BLOCKS[k].get);
          } catch (_) {
            fresh = null; // could not re-read: fall back to writing our copy as it is
          }
          const usable = fresh && fresh.length === this.cur[k].length && (k !== 'led' || P.isValidLed(fresh));
          base[k] = usable ? mergeEdits(fresh, this.dev0[k], this.cur[k]) : this.cur[k].slice();
          pre[k] = usable ? fresh : this.dev0[k];
        }

        const out = { led: this.cur.led, rgb: this.cur.rgb, colors: this.cur.colors };
        for (const k of keys) out[k] = base[k];
        if (keys.includes('led')) {
          // exactLed: the block is written as it is (apart from the apply flag). The low-battery light uses it to put the person's
          // own lighting back byte for byte, including a colour-mode byte the red light had to change.
          const colour = !opts.exactLed && (!!opts.restore || dirty.includes('rgb') || dirty.includes('colors') || P.editsColour(this.dev0.led, this.cur.led));
          out.led = P.prepareLedForWrite(out.led, P.effectOf(P.getMode(out.led)) || this.effect(), { colour });
        }

        // Only the bytes this write changes have to come back as sent. The firmware rewrites some bytes of its own (a counter,
        // a flag, the knob), and that is not a write that failed.
        const intended = {};
        for (const k of keys) intended[k] = changedOffsets(pre[k], out[k], k === 'led' ? P.OFF.APPLY : -1);

        const totalPackets = keys.reduce((n, k) => n + Math.ceil(out[k].length / P.CHUNK), 0);
        let done = 0;
        for (const k of keys) {
          try {
            await t.writeBlock(BLOCKS[k].set, out[k], 0, () => {
              done++;
              if (onProgress) onProgress(done / totalPackets);
            });
          } catch (err) {
            // The keyboard can take the block and the acknowledgement still go missing. If it now holds exactly what was
            // sent, the write worked and there is nothing to report.
            if (!(await this._landed(t, k, out[k], err))) throw err;
            this._note(`${k} block: no acknowledgement, but the keyboard holds what was sent`);
            if (onProgress) onProgress(Math.min(1, ++done / totalPackets));
          }
          await sleep(40);
        }

        let committed = true;
        try {
          await t.commit();
        } catch (_) {
          committed = false; // some units may not echo or need the commit; the read-back below decides
        }
        await sleep(60);

        let allOk = true;
        const back = {};
        const unverified = []; // sent, but the keyboard could not be asked what it now holds (cable only)
        for (const k of keys) {
          if (this.readable[k]) {
            try {
              back[k] = await this._readBack(t, k, out[k], intended[k]);
            } catch (err) {
              if (!(t.optionalBlocks && k !== 'led')) throw err;
            }
          }
          if (!back[k]) {
            unverified.push(k);
            this.dev0[k] = out[k].slice();
            continue;
          }
          if (!holdsChanges(back[k], out[k], intended[k])) allOk = false;
          this.dev0[k] = back[k];
        }
        const modeOk = !back.led || back.led[P.OFF.MODE] === out.led[P.OFF.MODE];
        this.cur = clone(this.dev0);
        // Remember what the keyboard really accepted, so it can be put back after a reset.
        if (allOk && modeOk && !opts.noKeep) this._saveKeep(readableOnly(this.dev0, Object.fromEntries(ORDER.map((k) => [k, this.readable[k] && !unverified.includes(k)]))));
        this.emit('change');
        // The person applied lighting of their own while the red light was on: that is their choice now, so nothing is put back.
        if (this._lowLight && !opts.lowLight) this._clearLowLight();
        const result = { ok: allOk, written: keys, modeOk, committed, mode: P.getMode(this.dev0.led), unverified };
        this.emit('applied', result);
        return result;
      } finally {
        this._applying = false;
      }
    }

    /**
     * Reads a block back after a write until it shows what was sent. The keyboard can take a moment to apply a config after
     * the commit, and an answer read too early still describes the old settings: reading once and calling that a failure
     * showed an error for changes that went through a moment later. The last answer is returned whether it matches or not;
     * the caller decides. If nothing could be read at all the error is thrown.
     */
    async _readBack(t, k, out, idx) {
      let last = null;
      const started = Date.now();
      for (const pause of this.verifyDelays) {
        if (pause > 0) await sleep(pause);
        try {
          last = await t.readBlock(BLOCKS[k].get);
        } catch (err) {
          if (!last) throw err; // never read: the caller decides what that means
          break; // an earlier answer exists; a link that stopped answering is not made to wait through every pause
        }
        if (holdsChanges(last, out, idx)) {
          if (Date.now() - started > 400) this._note(`${k} block: the keyboard showed the change after ${Date.now() - started} ms`);
          break;
        }
      }
      return last;
    }

    /**
     * After a write that was not acknowledged: does the keyboard hold exactly what was sent anyway? Only a missing
     * acknowledgement is looked at; any other failure (the link is gone) stays an error.
     */
    async _landed(t, k, out, err) {
      if (!(err instanceof CommError) || !/not acknowledged/.test(err.message || '')) return false;
      if (!this.readable[k]) return false;
      try {
        await sleep(250);
        const got = await t.readBlock(BLOCKS[k].get, 0, 1);
        if (k === 'led' ? !P.sameLed(got, out) : !P.same(got, out)) return false;
        return true;
      } catch (_) {
        return false;
      }
    }

    // ----------------------------------------------------------- backups

    exportBackup() {
      if (!this.dev0) return null;
      return {
        app: 'aula-control',
        version: 1,
        at: new Date().toISOString(),
        mode: this.mode,
        led: Array.from(this.dev0.led),
        rgb: Array.from(this.dev0.rgb),
        colors: Array.from(this.dev0.colors),
        ...(this.unread.length ? { unread: this.unread } : {}),
      };
    }

    _backupOnce() {
      try {
        if (this.storage.getItem(KEY.backup)) return;
        if (this.unread.length) return; // stand-ins are not the keyboard's settings; a later full read makes the first backup
        this.storage.setItem(KEY.backup, JSON.stringify(this.exportBackup()));
      } catch (_) {
        /* backup is best-effort */
      }
    }

    firstBackup() {
      try {
        const raw = this.storage.getItem(KEY.backup);
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    }

    /** Loads a backup into the editable copy (nothing is written until apply). */
    importBackup(obj) {
      if (!this.cur) return { ok: false, error: 'Connect the keyboard first.' };
      if (!obj || obj.app !== 'aula-control' || !Array.isArray(obj.led) || !Array.isArray(obj.rgb) || !Array.isArray(obj.colors)) {
        return { ok: false, error: 'This file is not an Aula Control backup.' };
      }
      // A backup made over the cable can hold stand-ins for blocks the keyboard did not hand over; those are not taken from
      // it. Neither is a palette when this link could not read the keyboard's own (writing it would replace colours the app
      // has never seen). Per-key colours are taken: loading them is the user asking for exactly that.
      const skipped = (k) => (Array.isArray(obj.unread) && obj.unread.includes(k)) || (k === 'rgb' && !this.readable.rgb);
      const led = Uint8Array.from(obj.led);
      const rgb = skipped('rgb') ? this.cur.rgb.slice() : Uint8Array.from(obj.rgb);
      const colors = skipped('colors') ? this.cur.colors.slice() : Uint8Array.from(obj.colors);
      if (!P.isValidLed(led)) return { ok: false, error: 'The lighting data in this backup is damaged.' };
      if (rgb.length !== this.cur.rgb.length || colors.length !== this.cur.colors.length) {
        return { ok: false, error: 'This backup was made for a different keyboard layout.' };
      }
      this.cur = { led, rgb, colors };
      this._learnBrightness(led);
      this.emit('change');
      return { ok: true };
    }
  }

  return { Session, BLOCKS, ORDER, memoryStorage, LOW_LIGHT };
});
