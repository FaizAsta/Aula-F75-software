/*
 * Key assignment on a connected keyboard: reads the key layers, changes keys, writes a layer back and checks it stuck.
 *
 * It works on top of a transport (the dongle's Transport or the cable's FeatureTransport) and never touches anything but
 * the key matrix. The rules it keeps, because a wrong key table can leave a keyboard with keys that do nothing:
 *   - a layer is only written after it was read from the keyboard in the same step, and only the keys you changed differ;
 *   - the Fn key and any code this app does not recognise are never overwritten;
 *   - the normal layer must hold every key of the layout and look like it (Esc is Esc, or Fn sits where the layout says), or nothing is written;
 *   - a layer is written back at the length the keyboard sent it (usually 512 bytes, some keyboards send less), never padded;
 *   - two layers that read back identical are taken as "the keyboard did not tell them apart", and nothing is written;
 *   - after a write the layer is read again and compared; the result says what the keyboard really kept;
 *   - the layers as they were the first time this keyboard model was opened here are remembered, for Restore.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./protocol.js'), require('./keys.js'));
  else root.AulaKeyAssign = factory(root.AulaProtocol, root.AulaKeys);
})(typeof self !== 'undefined' ? self : globalThis, function (P, K) {
  'use strict';

  const STORE = 'aula.keys.original';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // After a write the layer is read back to check it stuck. A keyboard can take a moment to show it, so an answer that still
  // has the old keys is asked for again after each of these pauses (ms) before the change is called lost.
  const VERIFY_DELAYS = [0, 150, 250, 400, 600, 800];
  const hex = (b) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');
  const unhex = (s) => Uint8Array.from(s.match(/../g) || [], (h) => parseInt(h, 16));
  // A saved layer: whole keys (four bytes each), at most the usual 512 bytes. Short layers are saved at their own length.
  const validHex = (s) => typeof s === 'string' && /^(?:[0-9a-f]{8})+$/i.test(s) && s.length / 2 <= K.LAYER_SIZE;

  class KeyAssign {
    /**
     * @param o.transport  () => the live transport, or null
     * @param o.keys       () => the layout's keys ({ n, led, ... })
     * @param o.model      () => id of the layout in use ('f75', 'f75pro', 'f87'), used to file the original layers
     * @param o.storage    localStorage-like (getItem / setItem / removeItem), optional
     * @param o.onChange   () => void, called whenever `state` changes
     * @param o.verifyDelays  pauses (ms) between read-backs while a written layer does not yet show the change
     */
    constructor(o = {}) {
      this.o = o;
      this.state = this._idle();
    }

    _idle() {
      return { status: 'idle', error: '', layers: [null, null], original: [null, null], bound: null };
    }

    _set(patch) {
      this.state = { ...this.state, ...patch };
      if (this.o.onChange) this.o.onChange();
    }

    /** Forget everything read, for example after the link changed. */
    reset() {
      this.state = this._idle();
      if (this.o.onChange) this.o.onChange();
    }

    get ready() {
      return this.state.status === 'ready';
    }

    /** Is the link the layers were read over still the live one? */
    get current() {
      return this.state.bound !== null && this.state.bound === (this.o.transport ? this.o.transport() : null);
    }

    layerAvailable(layer) {
      return !!this.state.layers[layer];
    }

    /** What a key does now (decoded), on a layer. */
    codeOf(layer, led) {
      const b = this.state.layers[layer];
      return b ? K.decode(K.codeAt(b, led)) : null;
    }

    originalOf(layer, led) {
      const b = this.state.original[layer];
      return b ? K.decode(K.codeAt(b, led)) : null;
    }

    isFnKey(led) {
      const fn = this.o.keys().find((k) => k.n === 'Fn');
      return !!fn && fn.led === led;
    }

    // ------------------------------------------------------------ reading

    async _readLayer(t, layer, tries = 3) {
      const b = await t.readBlock(P.CMD.GET_MATRIX, layer, tries);
      const need = K.neededBytes(this.o.keys());
      if (!b || b.length < need) {
        throw new Error(`The keyboard sent ${b ? b.length : 0} bytes for a key layer, and this layout needs at least ${need}.`);
      }
      // Keep exactly what the keyboard sent (up to the usual 512): it is written back at the same length, so no byte is made up.
      return b.length > K.LAYER_SIZE ? b.slice(0, K.LAYER_SIZE) : b.slice();
    }

    _originalKey() {
      return `${STORE}.${this.o.model ? this.o.model() : 'f75'}`;
    }

    _loadOriginal() {
      try {
        const raw = this.o.storage && this.o.storage.getItem(this._originalKey());
        if (!raw) return [null, null];
        const j = JSON.parse(raw);
        return [0, 1].map((i) => (j.layers && validHex(j.layers[i]) ? unhex(j.layers[i]) : null));
      } catch (_) {
        return [null, null];
      }
    }

    _saveOriginal(layers) {
      try {
        if (!this.o.storage) return;
        this.o.storage.setItem(this._originalKey(), JSON.stringify({ at: Date.now(), layers: layers.map((b) => (b ? hex(b) : null)) }));
      } catch (_) {
        /* storage full or blocked: Restore just will not have an original */
      }
    }

    /** Reads the layers. Resolves with the state; `status` is 'ready' or 'error' (with `error` saying why). */
    async load() {
      const t = this.o.transport ? this.o.transport() : null;
      if (!t) {
        this._set({ ...this._idle(), status: 'error', error: 'No keyboard is connected.' });
        return this.state;
      }
      this._set({ status: 'loading', error: '', bound: t });
      try {
        const base = await this._readLayer(t, 0);
        if (!K.looksLikeBaseLayer(base, this.o.keys())) {
          this._set({
            status: 'error',
            error: `The keyboard\u2019s key table does not look like this layout\u2019s (Esc and Fn are not where they should be, or the ${base.length} bytes it sent do not read as keys), so key assignment stays off to protect it.`,
          });
          return this.state;
        }
        let fn = null;
        try {
          fn = await this._readLayer(t, 1, 2);
        } catch (_) {
          fn = null; // the Fn layer is optional: some links do not hand it over
        }
        if (fn && K.sameBytes(fn, base)) fn = null; // the keyboard did not tell the layers apart: never write to it
        let original = this._loadOriginal();
        if (!original[0]) {
          original = [base.slice(), fn ? fn.slice() : null];
          this._saveOriginal(original);
        } else if (!original[1] && fn) {
          original[1] = fn.slice();
          this._saveOriginal(original);
        }
        this._set({ status: 'ready', error: '', layers: [base, fn], original });
      } catch (err) {
        this._set({ status: 'error', error: err && err.message ? `Could not read the key layers: ${err.message}` : 'Could not read the key layers.' });
      }
      return this.state;
    }

    // ------------------------------------------------------------ writing

    /**
     * Writes `edits` (Map led -> 4 bytes) to a layer. Resolves { ok, kept, wrong, error }: `kept` and `wrong` are the leds
     * the keyboard does and does not report back as written.
     */
    async apply(layer, edits) {
      const fail = (error, extra = {}) => ({ ok: false, kept: [], wrong: [], error, ...extra });
      if (!this.ready || !this.current) return fail('The keyboard is not connected.');
      if (!this.layerAvailable(layer)) return fail('That layer is not available on this keyboard.');
      if (!edits || edits.size === 0) return { ok: true, kept: [], wrong: [], error: '' };
      const t = this.o.transport();
      this._set({ status: 'busy' });
      try {
        // Read first: what is written is the keyboard's own layer with only your keys changed.
        const fresh = await this._readLayer(t, layer);
        if (layer === 0 && !K.looksLikeBaseLayer(fresh, this.o.keys())) return this._back(fail('The keyboard\u2019s normal layer no longer looks right, so nothing was written.'));
        if (layer !== 0) {
          const base = await this._readLayer(t, 0);
          if (K.sameBytes(fresh, base)) return this._back(fail('The keyboard did not tell the layers apart, so nothing was written.'));
        }
        let next = fresh;
        for (const [led, code] of edits) {
          if (this.isFnKey(led)) return this._back(fail('The Fn key cannot be changed: it would lock the layer.'));
          if (K.decode(K.codeAt(fresh, led)).protected) return this._back(fail('That key is a special key of the keyboard and is left alone.'));
          next = K.withCode(next, led, code);
        }
        try {
          await t.writeBlock(P.CMD.SET_MATRIX, next, layer);
        } catch (err) {
          // The keyboard can take the layer and the acknowledgement still go missing. If it now holds exactly what was sent,
          // the write worked.
          if (!(await this._landed(t, layer, next, err))) throw err;
        }
        await t.commit();
        // Read it back: the layer on the keyboard now is the truth, whatever was sent. A keyboard that is slow to apply
        // shows the old keys at first, so it is asked again for a moment before the change is called lost.
        const back = await this._readBack(t, layer, edits);
        const kept = [];
        const wrong = [];
        for (const [led, code] of edits) (K.sameBytes(K.codeAt(back, led), code) ? kept : wrong).push(led);
        const layers = this.state.layers.slice();
        layers[layer] = back;
        this._set({ status: 'ready', layers });
        return {
          ok: wrong.length === 0,
          kept,
          wrong,
          error: wrong.length ? 'The keyboard did not keep every change. What it reports now is shown.' : '',
        };
      } catch (err) {
        return this._back(fail(err && err.message ? err.message : 'The write did not work.'));
      }
    }

    /** Reads a layer until every edited key shows its new code, or the pauses run out. Returns the last answer. */
    async _readBack(t, layer, edits) {
      const holds = (b) => [...edits].every(([led, code]) => K.sameBytes(K.codeAt(b, led), code));
      let last = null;
      for (const pause of this.o.verifyDelays || VERIFY_DELAYS) {
        if (pause > 0) await sleep(pause);
        try {
          last = await this._readLayer(t, layer);
        } catch (err) {
          if (!last) throw err;
          break;
        }
        if (holds(last)) break;
      }
      return last;
    }

    /** After a write that was not acknowledged: does the layer on the keyboard equal what was sent? */
    async _landed(t, layer, sent, err) {
      if (!err || !/not acknowledged/.test(err.message || '')) return false;
      try {
        await sleep(250);
        return K.sameBytes(await this._readLayer(t, layer, 1), sent);
      } catch (_) {
        return false;
      }
    }

    _back(result) {
      if (this.state.status === 'busy') this._set({ status: 'ready' });
      return result;
    }

    /** The edits that put a layer's keys back as they were when this keyboard was first opened here. */
    restoreEdits(layer, onlyLed = null) {
      const orig = this.state.original[layer];
      const cur = this.state.layers[layer];
      const edits = new Map();
      if (!orig || !cur) return edits;
      const leds = onlyLed === null ? K.changedKeys(orig, cur) : [onlyLed];
      for (const led of leds) {
        if (!K.hasKey(orig, led) || !K.hasKey(cur, led)) continue; // a key outside a short layer: nothing known to restore
        const want = K.codeAt(orig, led);
        if (!K.sameBytes(want, K.codeAt(cur, led))) edits.set(led, want);
      }
      return edits;
    }
  }

  return { KeyAssign };
});
