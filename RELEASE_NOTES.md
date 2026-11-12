<!--
  RELEASE NOTES (note for anyone who edits this project, people and AI assistants alike).

  When the version is bumped, add only the header of the new version at the top: "## What's new in X.Y.Z".
  Do not write a description under it (no bullets, no text). The author fills that in. Leave the older
  sections as they are.

  The app shows the bold title at the start of each bullet in a small window after an update (only that title, never the
  description). So start every bullet with a bold title, as the older sections do.
-->

## What's new in 1.5.0

## What's new in 1.4.8

## What's new in 1.4.7

## What's new in 1.4.6

- **No false error when the change went through:** after Apply the app read the keyboard back once, a fraction of a second later. A keyboard that was a little slow to apply (the 2.4G dongle and the USB-C cable both can be) still showed its old settings at that moment, so the app said "did not keep every change" or "is running another effect" while the light was changing on the real keyboard. The app now asks again for up to about two seconds and stops as soon as the keyboard shows the change. A keyboard that really ignores a write is still reported.
- **Only what you changed is checked:** the read-back now compares the bytes you changed, not the whole lighting block. A byte the keyboard's own firmware rewrites by itself no longer counts as a failed write.
- **A lost "received" reply is not an error:** if the keyboard took the settings but its acknowledgement never reached the app, the app used to stop with "Could not write to the keyboard". It now reads the keyboard back, and when the keyboard holds exactly what was sent the write counts as done. Any other failure, such as the link going away, is still an error.
- **Key assignment, same fix:** the Keys tab had the same early read-back. A slow keyboard no longer shows "did not keep every change" for a key that was changed, and a layer whose acknowledgement was lost is checked the same way as above.
- **F75 Max over USB-C:** the app waited only about 0.14 seconds for the keyboard to confirm each step. It now waits up to 1.5 seconds and goes on as soon as the keyboard answers, asks again when a read fails for a moment right after a command, and waits for a late echo of a per-key packet. If only the very last step (apply) is not confirmed, the app says "Sent to the keyboard" with a note instead of an error. A refusal at any earlier step is still an error and nothing after it is sent.
- **All models:** these fixes apply to the F75, F75 Pro, F87 and F75 Max, on the dongle and on the cable, and to the lighting, per-key colour, settings and key assignment writes.
- **Demo keyboard:** the simulated keyboard no longer fails when a block arrives in pieces and only the last piece is sent again.
- **Known limits:** these changes were checked against simulated keyboards that are slow, lose acknowledgements or rewrite a byte. The F75 Max is still untested on a real keyboard. If an error still shows although the keyboard changed, save the log in Settings and send it with the exact message.
- **Tests:** 26 new tests cover a slow keyboard on every model and link, a byte rewritten by the firmware, a lost acknowledgement, a keyboard that really ignores a write, and the F75 Max waiting, retrying and unconfirmed-apply cases. 496 tests pass.

## What's new in 1.4.5

## What's new in 1.4.4

- **The knob stays where you set it:** the app used to write an old remembered copy of the lighting settings back to the keyboard, and that copy included what the knob does (lighting or volume). If you switched the knob to volume while the app was closed, for example during an update, the next connection put it back on lighting and you had to hold the knob again. The app no longer writes the knob setting at all. It is left exactly as the keyboard has it, and a difference in the knob alone makes the app write nothing.
- **Connecting changes nothing on the keyboard:** "Restore settings after a reset" (Settings > Keyboard) is now **off by default**. Connecting, waking the keyboard, updating the app and reinstalling it write nothing to the keyboard. The switch uses a new setting, so a copy or a switch position left behind by an older version is ignored and the app starts with it off. You can still switch it on, and **Restore now** still works. When it is on, it still never writes the knob setting. The settings text says this.
- **Only what you change is written:** pressing Apply sends the keyboard's own current settings with just your edit in them. Changing brightness, speed or the sleep time now changes only that byte. Before, every Apply also forced the colour mode byte to 1 and tidied the colour choice of the running effect, which could alter the colours of a keyboard that was using its own colour mode. Those two are now set only when you change the effect, the colour choice, a palette colour or per-key colours. The keyboard's own "applied" flag is the one thing that is always cleared, because the keyboard ignores a write that still carries it.
- **Still follows the keyboard:** changes made on the keyboard itself (Fn shortcuts, the knob) are still noticed and shown while the app is open, now even with the restore switch off. This only reads from the keyboard and never writes to it.
- **Painting keys:** painting one key changes only that key. Every other key and setting stays as it was; the keyboard switches to Per-key so your colours show.
- **A keyboard picture that looks like the real board:** the F75 is now pictured in the colours of the real keyboard (navy keys, black modifiers, yellow Esc, Enter, arrows and space bar, orange legends, silver knob, a white light bar by Esc) and the pictures are drawn from a steeper angle with taller, tapered, matte keycaps, so the sides of the caps show as they do in a photo. The case plate is now one dark surface with no sunken wells round each key. The lighting is a soft glow in the gaps and at the foot of each cap, not a bright outline and a bar under every key. Digits and punctuation show the symbol above the key, as printed. The F75 Pro and F87 pictures are drawn the same way in their own colours, and the F75 Pro knob is bigger. Run `npm run screenshots` to refresh the README pictures.
- **Known limits:** over the USB-C cable some units cannot report their per-key colours, so keys you do not paint go dark when you apply (the Per-key tab says so, and palette editing is switched off there). The F75 Max cannot be read back at all, so Apply there sends the whole section (Lighting, Keys or Settings) from the values the app remembers.
- **Tests:** six new tests cover the knob after a reconnect, a knob-only difference, connecting after a reinstall with an older remembered copy, changing one setting, a colour edit still setting the colour mode, and painting one key. The tests for the restore feature now switch it on first. 439 tests pass.
