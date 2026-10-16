<div align="center">

<img src="assets/icon.png" width="96" alt="Aula Control icon">

# Aula Control

**An unofficial Windows app for AULA F75 and F87 keyboards.**<br>
Battery and charging, lighting effects, per-key RGB, and a live preview of the board.

[![Version](https://img.shields.io/badge/version-1.2.0-blue)](../../releases)
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

To restyle it, set these variables in `:root` of [`src/css/app.css`](src/css/app.css) (the window-buttons block shows the defaults):

| Variable | Default | What it does |
| --- | --- | --- |
| `--win-tint` | the keyboard colour | Set `r g b` in `:root` (for example `22 134 106`) for one fixed colour instead |
| `--win-w` | `42px` | Width of one button (the pill is three of them) |
| `--win-h` | `36px` | Height of the pill |
| `--win-pad` | `3px` | Gap between the rim and the buttons |
| `--win-edge` | `12px` | Distance from the window's top and right edges |

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
| **2.4G dongle** (recommended) | Yes | Yes, read about once a minute | Yes, at once when the USB-C cable is plugged in |
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
