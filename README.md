<div align="center">

<img src="docs/banner.png" width="800" alt="Aula Control">

**An unofficial Windows app for AULA F75 and F87 keyboards.**<br>
Battery and charging, lighting effects, per-key RGB, and a live preview of the board.

[![Version](https://img.shields.io/badge/version-1.3.2-blue)](../../releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078d4)](#download)
[![Electron](https://img.shields.io/badge/built%20with-Electron-47848f)](https://www.electronjs.org/)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue)](#license)

[**Download**](../../releases) · [Features](#features) · [Design](#design) · [Supported keyboards](#supported-keyboards) · [Battery and charging](#battery-and-charging) · [Troubleshooting](#troubleshooting)

![Aula Control, Lighting tab](docs/screenshots/lighting.png)

</div>

> **Not affiliated with AULA.** The keyboard protocol comes from public reverse engineering of the 2.4G dongle. Because
> hardware testing is limited, the app reads every setting back after writing it and tells you if the keyboard did not
> keep it.

## Download

1. Open the [**Releases**](../../releases) page and download **Aula-Control-Setup.exe**.
2. Run it. It installs in one step (no admin needed), adds a desktop shortcut and a Start menu entry, and opens the app.

That is all. To remove it, use *Settings, Apps, Installed apps, Uninstall*. Your settings are kept if you reinstall.

Prefer not to install? **Aula-Control-Portable.exe** is a single file that runs on its own.

Windows SmartScreen may warn that the app is from an unknown publisher, because it is not code-signed. Choose
*More info, Run anyway*. This only happens the first time.

Want to look around first? Turn on **Settings, Demo keyboard** to try every control without a keyboard.

## Features

- **Battery**: level, charging indicator, low-battery alert, fully charged alert and a history graph.
- **15 lighting effects** plus Per-key and Off, with brightness, speed, colours and a sleep timer.
- **Per-key RGB** with Select and Brush tools, presets and a colour picker.
- **Live preview** of the keyboard and every effect, including keys lighting up as you type.
- **Verified writes**: after Apply, the app reads everything back and shows what the keyboard really kept.
- **Restore after a reset**: keeps a copy of your settings and puts them back if the keyboard returns from sleep or a
  restart with factory lighting.
- **Connects by itself**, wakes a sleeping keyboard, and recovers after sleep, screen lock or unplugging.
- Start with Windows, run in the tray, and a connection log for bug reports.
- **Dark and light themes**: switch with the sun / moon button in the header, or choose Dark, Light or System (follows
  Windows) under **Settings, Appearance**. The choice is remembered.

## Design

The window is frameless with large rounded corners. Minimize, maximize and close float above every screen as one rounded
glass pill in the top-right corner, instead of the square Windows caption buttons.

![Floating window controls in each state, and in the colours the keyboard can show](docs/screenshots/window-controls.png)

- **One pill, three equal cells**: 132 × 36 px with thin light icons.
- **Hover** lights the button under the pointer and **Close** turns red. While maximized, the middle button becomes the
  restore icon and the window squares its corners.
- **Close** follows your tray setting. With *Keep running in the tray when closed* on, it hides the window instead of quitting.
- **It matches the rest of the UI.** The glass is neutral and picks up the keyboard's current colour for its rim and glow,
  the same way the tabs do, so it changes with your lighting. There is no blur, so it costs the GPU nothing.

## Supported keyboards

| Model | Status |
| --- | --- |
| **AULA F75** | Supported. The model this app was built for. |
| **AULA F87 / F87 Pro** | Supported (same protocol as the F75). Not yet tried on a physical F87. |
| F99, F108 Pro, S-series, F75 Max and other AULA models | **Not supported yet.** Many use a different protocol, so the app leaves them alone. |

The F75 and F87 report the same USB ids, so if the app cannot tell which you have, choose under
**Settings, Keyboard model**. A wrong pick only puts the preview and per-key painting on the wrong keys.

## Battery and charging

| Connection | Lighting and per-key | Battery percentage | Charging bolt |
| --- | --- | --- | --- |
| **2.4G dongle** (recommended) | Yes | Yes, read every 5 s while charging and every 15 s otherwise | Yes, at once when the USB-C cable is plugged in |
| **USB-C cable** | Experimental | No, the cable has no battery report | Yes, whenever the cable is connected |
| **Bluetooth** | No, Windows does not allow it | If Windows reports it | No |

- **Live charging.** Using the keyboard on the 2.4G dongle and then plugging in the USB-C cable starts the charging bolt
  and animation straight away, the same as on the cable alone, and stops when you unplug. The percentage keeps coming
  from the dongle, so you see the level rise.
- **Fully charged alert**: a notification when the battery reaches 100% while charging. Once per charge; switch it off in
  the **Battery** tab.
- **Low battery alert**: once per drop, at a level you choose (10% to 50%, or never).

> The live charging bolt relies on the keyboard showing its USB-C connection to Windows while its mode switch is on 2.4G.
> If yours does not, the bolt appears once the app sees the level rising.
> The USB-C cable lighting control was built from public protocol notes and has not been tested on a real keyboard, so it
> is marked experimental.

## Using the app

- **Refresh** (top right, **F5** or **Ctrl+R**) re-reads the keyboard. **Ctrl+S** applies your changes.
- **Theme**: the sun / moon button next to Refresh flips between dark and light. In a narrow window it is hidden; the same
  choice is under **Settings, Appearance**. The keyboard preview stays dark in both themes, because RGB light only reads
  on dark keycaps.
- **Minimize, maximize and close** are the glass pill in the top-right corner (see [Design](#design)).
- **Start** opens a list of connected devices (plus the demo keyboard); pick one to open it.
- Changes you have not applied show an **Unsaved changes** bar, and a green dot marks the effect the keyboard is running.
- The first time it connects, the app saves your original settings. **Settings, Backup, Load original** brings them back.

## Troubleshooting

- **Close the official AULA driver.** Only one program can use the keyboard's control interface at a time.
- Open **Settings, Connection help** to see what the app can find. **Save log** and **Save compatibility report** write
  text files you can attach to a bug report. They contain no personal data and send the keyboard nothing.
- **USB-C cable not connecting?** Set the keyboard's mode switch to cable, unplug the cable, wait five seconds, plug it in
  again, and close any other AULA software.
- **Only Bluetooth?** Windows gives apps just the battery level over Bluetooth. For lighting use the 2.4G dongle or the
  cable.
- **No percentage while charging over the cable** is expected. Use the 2.4G dongle with the cable plugged in to see it.
- The keyboard's own reset (see its manual) always restores factory lighting.

## Screenshots

| Per-key | Battery |
| --- | --- |
| ![Per-key tab](docs/screenshots/per-key.png) | ![Battery tab](docs/screenshots/battery.png) |

| Charging on the 2.4G dongle | Charging on the USB-C cable |
| --- | --- |
| ![Charging on the dongle](docs/screenshots/charging.png) | ![Charging on the cable](docs/screenshots/charging-cable.png) |

Captured from the real interface running against simulated keyboards. The window-controls image is rendered from the app's own stylesheet.

## What's new

### 1.3.2

- **Transmission animation.** While settings go to the keyboard, the Apply bar shows a link: computer, packets, keyboard, with
  the real progress as a fill and the steps *Preparing*, *Transmitting* and *Verifying*. On the keyboard preview a scan line
  sweeps across, signal rings leave the board and streaks fly in, and the status bar shows *Sending 42%*. When it ends, the bar
  turns green with a tick (or amber / red if the keyboard did not keep everything), then leaves. Refresh and *Read battery now*
  play the same animation in reverse (*Reading*). An automatic restore after a reset does too.
- **Button animations.** Every button has a click ripple in the keyboard's colour (also for Enter and Space), and presses in
  and springs back. Buttons that wait for the keyboard (*Read battery now*, *Restore now*, *Connect*, *Search again*) show a
  spinner and a moving sheen, then a tick or a shake. Switches flash a ring, effect tiles send out a ring when picked, the chosen
  segment label pops, the theme button turns the sun into the moon, and the window buttons, Back, Start and the brand icon each
  react on hover. The Apply button gives a soft ring while there is something to apply. Hovers stay neutral: no rainbow ring.
- **Transitions.** Tabs slide in from the side of the tab you picked and their cards rise in one after another, the header drops
  in when you leave the start screen, device cards cascade in once, and the message on the preview, the Apply bar and toasts
  fade or spring instead of popping.
- **Fixed: the connection label in the header was cut off** ("Demo key...") at the default window size, and at the minimum
  size a long battery label ("No reading") pushed the status dot over the tab bar. The header now drops the label, then the
  wide battery text, then the theme button, as space runs out. The label shows in full on wide windows.
- **Fixed: the keyboard drawing showed through the "No keyboard found" message**, most visibly in the light theme. It now fades
  back while a message is up, and the scrim is more solid.
- **Fixed: swatches and buttons scrolling under the Apply bar showed through it.** The bar is now nearly solid.
- **Fixed: the multicolour swatch wrapped onto a line of its own** in the Colour card at the minimum window width.
- All new motion is in `src/css/motion.css` and `src/js/motion.js`. It uses only transform, opacity and shadows (no blur), loops
  only while something is happening, and is switched off entirely by the system's reduced-motion setting.

### 1.3.1

- **The battery percentage now updates live.** On the 2.4G dongle the level was read only once a minute, so it looked frozen,
  also with the USB-C cable plugged in to charge. It is now read every 5 seconds while charging and every 15 seconds
  otherwise, and the header, the Battery tab and the tray tooltip follow each new reading.
- **Bigger battery icon in the header**, so the level and the charging bolt are easier to see.
- Over the USB-C cable alone there is still no percentage: the cable has no battery report. Keep the keyboard on the 2.4G
  dongle (cable plugged in to charge) to watch the level rise.

### 1.3.0

- **A more detailed Lighting tab.** Under the Effect heading there is now a one-line description of the selected effect and
  chips for how it treats colour, whether its speed can be changed, and its firmware mode number. Every effect card also
  shows a small label (Single colour, Multicolour, Reacts to typing, and so on) and a tooltip with the same description.
- **Level meters and icons.** Brightness and Speed have a small meter that fills to the current level, and the Brightness,
  Speed, Colour and sleep rows have icons.
- **Status bar under the keyboard.** It shows the keyboard model and connection on the left, and the running effect, its
  colour, speed and brightness on the right. It follows the Per-key tab too, and drops the least important chips when the
  window is narrow.
- Light, top-edge shading on the panels, softer swatches and clearer keyboard focus rings. The new styles are in
  `src/css/detail.css`, add no animation or blur, and Lite mode still applies.

### 1.2.3

- **Rainbow in the preview now matches the keyboard.** The keyboard shows one colour at a time and steps through them (red,
  green, blue, and so on). The preview used to show a smooth moving gradient. It now holds each colour and changes to the
  next, on every key together, and the speed setting sets how long each colour is held.
- **Breathing in the preview now matches too.** Each breath fades up from dark and back down to dark, and in multicolour the
  next colour starts at the dark point. Before, the preview never went fully dark and its hue drifted slowly while it breathed.

### 1.2.2

- **Smoother click ripple and hover glide on the keyboard preview.** The ring that spreads from a click, the spotlight and the
  lean toward the pointer now update on every screen refresh instead of at a fixed 30 fps, and a click shows its ring on the
  very next frame. The lighting effects themselves still run at 30 fps, so idle cost is unchanged.
- **Cheaper frames.** The key legends are measured once instead of on every frame, and their size under the pointer snaps to
  1/8 px so the browser can reuse its text. A preview frame now costs roughly a third of what it did.

### 1.2.1

- **Fixed: the window buttons did nothing on the start screen and the device list.** Minimize, maximize and close now work on
  every screen. The start and device screens had a drag strip across the whole top edge that sat over the buttons, so
  Windows treated them as title bar and swallowed the clicks. The strip now stops before the buttons.

### 1.2.0

- **Live charging when you plug in while wireless.** On the 2.4G dongle, plugging in the USB-C cable now shows the
  charging bolt and animation at once, and unplugging stops them. Before, the app waited until it saw the level rise.
- The connection log notes when the cable is plugged in or unplugged.
- **Floating window buttons.** Minimize, maximize and close are now a rounded glass pill in the top-right corner instead of
  square buttons in the title bar: three equal cells, thin light icons, a soft hover and a red close. The glass takes its
  colour from the keyboard like the rest of the UI, and its size is set by CSS variables (see [Design](#design)).
- Refreshed screenshots that show the new window controls.

## Credits

Protocol details come from these community projects: [TrueIG/AULA-F75-configurator](https://github.com/TrueIG/AULA-F75-configurator),
[JavaProgswing/aula-f75](https://github.com/JavaProgswing/aula-f75),
[marcoslor/Aula-F87-Controller](https://github.com/marcoslor/Aula-F87-Controller) and
[RustamSheoran/aula-f75](https://github.com/RustamSheoran/aula-f75).

## License

GPL-3.0. See the [LICENSE](LICENSE) file. Aula Control is an independent project and is not affiliated with or endorsed by AULA.
