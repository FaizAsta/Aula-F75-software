<!--
  KEEP THE SCREENSHOTS UP TO DATE (note for anyone who edits this project, people and AI assistants alike).

  Whenever the UI changes in any way (layout, colours, text, icons, a tab, setting, dialog or screen added, moved,
  renamed or removed), the screenshots in docs/screenshots must be updated in the same change, and the gallery in
  the "Screenshots" section below must match them:

    1. Existing screen changed: run   npm run screenshots   and commit the new pictures.
    2. New screen or state: add a scene for it in scripts/screenshots.js, run the script, and add the new
       picture to the "Screenshots" section below.
    3. Screen removed: delete its scene and its picture, and remove it from the "Screenshots" section.

  One-time setup:  npm install --no-save playwright sharp   then   npx playwright install chromium
  (sharp is optional; it makes the pictures about 4x smaller). `npm run screenshots -- --list` shows the scene
  names, and `npm run screenshots -- lighting battery` redraws only those. The pictures show the real UI with a
  simulated keyboard, so no hardware is needed. `npm test` checks that every picture in the folder is used here
  and every picture used here exists.
-->

<!--
  BUMPING THE VERSION (note for anyone who edits this project, people and AI assistants alike).

  When the version is bumped, change only the version number: in package.json ("version") and in the Version
  badge below (the X.Y.Z in badge/version-X.Y.Z-blue). The only other edit is the new header at the top of
  RELEASE_NOTES.md (see the note at the top of that file). Change nothing else: no README text, no screenshots,
  no tests. `npm test` checks that the two numbers agree.
-->

<div align="center">

<img src="docs/banner.png" width="800" alt="Aula Control">

**An unofficial Windows and Linux app for AULA F75 keyboards.**<br>
Battery, lighting effects, per-key RGB and a live preview.

[![Version](https://img.shields.io/badge/version-1.5.3--beta.1-blue)](../../releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011%20%7C%20Linux-0078d4)](#download)
[![Discord](https://img.shields.io/badge/Discord-join%20the%20server-5865F2?logo=discord&logoColor=white)](https://discord.gg/BdeQygyRwN)

[**Download**](../../releases) · [Features](#features) · [Screenshots](#screenshots) · [Troubleshooting](#troubleshooting) · [Discord](https://discord.gg/BdeQygyRwN)

![Aula Control, Lighting tab](docs/screenshots/lighting-glass.png)

</div>

## New: Liquid glass UI (experimental)

A second look for the app: panels, buttons, sliders and switches become glass that blurs the picture behind them, a bit
like iOS or Telegram. **Classic** is still the default.

- **Choose it:** the first time you press **Start**, the app asks "Which UI do you want to use?" and shows both looks.
  Pick one and press **Continue**. You can change it any time in **Settings > Theme > UI**.
- **Two types of glass** (**Settings > Theme > Liquid glass > Glass type**): **Normal** (the default) is a soft blur with a
  thin light edge, like the bars in iOS and Telegram, and it is light on the computer. **Realistic** is thick glass that
  also bends the picture at its edge, with a colour fringe: it looks deeper but is heavier.
- **Four looks:** **Clear glass** (no blur), **Blur glass** (soft blur, the default), **Frosted glass** (heavy blur) and
  **Default** (soft blur, the strongest bend at the edge and no colour fringe; the bend shows with Realistic glass).
  Press **Customise** for the sliders: blur for Normal glass, plus edge width, refraction and colour fringe for Realistic
  glass. **Reset** goes back to Blur glass.
- **It moves like iOS glass:** buttons swell under the pointer and spring back, the tab pill and the sliding highlight
  of a segmented control stretch like a drop of liquid while they travel, slider thumbs slide freely under the pointer
  (even on sliders with only a few steps, like Brightness) and settle into their step when you let go, the tab bar folds
  to the open tab when you scroll down (point at it to open it again), and menus grow out of their button. Nothing to switch on. It follows your
  system's **reduce motion** setting and Classic is not affected.

> [!CAUTION]
> **Experimental:** it is **not stable**, and **Realistic** glass **can be laggy**, more so on older computers. It may glitch in places.
> It looks best with a background picture (Settings > Theme). If anything misbehaves, switch back to **Classic** in the
> same place. Nothing else is affected.

## Picture and video backgrounds

**Settings > Theme > Background** puts your own picture or a looping video (a live wallpaper) behind the app.

- **Choose picture:** PNG, JPEG or WebP. The app keeps a shrunk copy, so it still works if you move or delete the original.
- **Choose video:** MP4 or WebM (H.264, VP8, VP9 and AV1 normally play; some `.mov` files do not), or an animated GIF, up to 500 MB. The
  app copies it into its own data folder, plays it without sound in a loop, and stops it while the window is hidden in the tray
  or minimized, so it does not use the graphics card then. **Remove** deletes the copy.
- **Opacity** works for both, and **Preset backgrounds** below it lists the pictures built into the app.
- A big video uses more of the graphics card, and the Liquid glass style (which blurs what is behind it) is the heaviest with it.
  If the video stutters, try a lower resolution (1080p is plenty), a shorter file, or Classic.
- Video files you drop into `src/img/backgrounds` are not presets: only pictures are. Use **Choose video** for those.

## Read this first

I made this app for myself because AULA's official software is bad and its UI is terrible. I'm sharing it for anyone
who wants to try it. It's free, and you use it on your own.

I don't even know coding, so **use it at your own risk**, or leave if you have any issue. It was made with the help of
AI. If you have a personal problem with that, you're free to leave. I'm not earning anything from it, so I don't need to
worry about it. I just want to share.

**Tested only on the AULA F75.** Every other model (F75 Pro, F87, F75 Max, F75 HE) is untested, so I don't know if it works.
If you get an error, comment on the release.

Not affiliated with AULA.

## Download

Everything is on the [Releases](../../releases) page.

**Windows 10 / 11**

1. Download **Aula-Control-Setup.exe** and run it. No admin needed. (Or **Aula-Control-Portable.exe**, which needs no install.)
2. If Windows warns about an unknown publisher (the app isn't code-signed), choose **More info**, then **Run anyway**.

No keyboard? Try the demo: **Settings, Demo keyboard**, or click the Aula logo, choose **Demo keyboards**, then **Demo keyboard** (an F75), **Demo F75 Max** or **Demo F75 HE**.

To uninstall, use Windows Settings, Apps. That also deletes the app's data (your settings and what it remembers);
updating keeps it. The portable build has no uninstaller, so delete its data folder yourself.

**Linux (64-bit, new and untested)**

- **Ubuntu, Debian, Mint, Pop!_OS:** download **Aula-Control-amd64.deb**, double-click it and press Install (or run
  `sudo apt install ./Aula-Control-amd64.deb`). Then unplug and plug the keyboard once.
- **Any other distro:** download **Aula-Control-x86_64.AppImage**, right-click it, Properties, allow executing as a
  program, then double-click it. The AppImage cannot set up keyboard access itself, so also download
  **99-aula-control.rules** from the same release and run this, then unplug and plug the keyboard:

  ```
  sudo cp 99-aula-control.rules /etc/udev/rules.d/ && sudo udevadm control --reload-rules && sudo udevadm trigger
  ```

## Community

Join the [Discord server](https://discord.gg/BdeQygyRwN) to share ideas, ask for help or tell us about a problem. Ideas for new features are welcome.

In the app, press **Support** (on the start screen and in the top bar) for the Discord invite and the other links.

## Features

**By keyboard model**

| Feature | F75 | F75 Pro | F87 | F75 Max | F75 HE |
| :-- | :-: | :-: | :-: | :-: | :-: |
| Lighting effects (15; 20 on the F75 Max, 19 on the F75 HE) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Per-key RGB | ✅ | ✅ | ✅ | ✅ | ✅ |
| Live preview, a rendered picture of your model | ✅ | ✅ | ✅ | ✅ | ✅ |
| Battery level | ✅ | ✅ | ✅ | ✅ | ✅ |
| Key assignment (experimental) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Own Keyboard section, in place of the Keys tab | ❌ | ❌ | ❌ | ✅ | ✅ |
| Tested by the author | ✅ | ❌ | ❌ | ❌ | ❌ |

The **F75 HE** (the Hall-effect F75) is experimental. It does not speak the F75's protocol: it belongs to AULA's "HFD" family,
and this app follows that protocol as another project decoded it from AULA's own driver. Reading from a real F75 HE (who it is,
its lighting and its per-key colours, over USB-C and over the 2.4G dongle) has been checked. The effects are the ones AULA's own
web driver offers, with its names and mode numbers, and the lighting bytes the app writes for each are the ones that driver was
seen to write to a real F75 HE (a capture of it clicking every effect is in `test/fixtures`). That driver has no Off, so the app's
Off sends Static in black. The app's own writes have not been confirmed on a real F75 HE yet. The app asks the keyboard who it is before it writes anything, only ever sends the
lighting and per-key colour commands (never a reset, calibration or firmware command), and does not touch the Hall-effect
settings, so what you set in AULA's own driver stays as it is. The picture and the key layout of the F75 HE are provisional. If
a key lights the wrong cap, or anything else misbehaves, please say what you saw.

**By connection**

| Feature | 2.4G dongle | USB-C cable | Bluetooth |
| :-- | :-: | :-: | :-: |
| Lighting effects and per-key RGB | ✅ | ✅ | ❌ |
| Key assignment (experimental; F75, F75 Pro, F87) | ✅ | ✅ | ❌ |
| Battery level | ✅ | ❌ | ✅ |
| Charging indicator | ✅ | ✅ | ❌ |
| Low and fully charged alerts | ✅ | ❌ | ✅ |
| Red breathing light on the keyboard while the battery is low | ✅ | ❌ | ❌ |
| Battery history and estimate | ✅ | ❌ | ✅ |

**The app**

| Feature | Windows installer | Windows portable | Linux |
| :-- | :-: | :-: | :-: |
| Dark and light themes | ✅ | ✅ | ✅ |
| Tray icon | ✅ | ✅ | ✅ |
| Demo keyboard, to try it without a keyboard | ✅ | ✅ | ✅ |
| Start with Windows | ✅ | ✅ | ❌ |
| Tells you when a new version is out | ✅ | ✅ | ✅ |
| Downloads and installs updates itself | ✅ | ❌ | ❌ |
| Opens the release page for a new version | ❌ | ✅ | ✅ |
| Window listing what is new after an update (headers only) | ✅ | ✅ | ✅ |

## Screenshots

The top picture is the Lighting tab in the Liquid glass UI (Normal glass, dark theme), and the last one is the same tab with
Realistic glass: both are captures of the real app on a real AULA F75 over the 2.4G dongle. All the others are the real app
with a simulated keyboard (the Demo keyboard, or a simulated dongle). Click a picture to see it full size.

<table>
<tr>
<td align="center" valign="top" width="33%"><a href="docs/screenshots/start.png"><img src="docs/screenshots/start.png" alt="The start screen" width="260"></a><br><sub>Start screen</sub></td>
<td align="center" valign="top" width="33%"><a href="docs/screenshots/devices.png"><img src="docs/screenshots/devices.png" alt="The connected devices, shown one at a time with arrows" width="260"></a><br><sub>Connected devices</sub></td>
<td align="center" valign="top" width="33%"><a href="docs/screenshots/light-theme.png"><img src="docs/screenshots/light-theme.png" alt="The Lighting tab in the light theme" width="260"></a><br><sub>Light theme</sub></td>
</tr>
<tr>
<td align="center" valign="top" width="33%"><a href="docs/screenshots/sending.png"><img src="docs/screenshots/sending.png" alt="Sending settings to the keyboard, with the transfer animation" width="260"></a><br><sub>Apply: transfer animation</sub></td>
<td align="center" valign="top" width="33%"><a href="docs/screenshots/per-key.png"><img src="docs/screenshots/per-key.png" alt="The Per-key tab with every key painted" width="260"></a><br><sub>Per-key</sub></td>
<td align="center" valign="top" width="33%"><a href="docs/screenshots/keys.png"><img src="docs/screenshots/keys.png" alt="The Keys tab with Caps Lock changed to F13" width="260"></a><br><sub>Key assignment</sub></td>
</tr>
<tr>
<td align="center" valign="top" width="33%"><a href="docs/screenshots/charging.png"><img src="docs/screenshots/charging.png" alt="The Battery screen while charging over the cable on the 2.4G dongle" width="260"></a><br><sub>Charging, 2.4G dongle</sub></td>
<td align="center" valign="top" width="33%"><a href="docs/screenshots/settings.png"><img src="docs/screenshots/settings.png" alt="Settings, Keyboard page" width="260"></a><br><sub>Settings: Keyboard</sub></td>
<td align="center" valign="top" width="33%"><a href="docs/screenshots/settings-theme.png"><img src="docs/screenshots/settings-theme.png" alt="Settings, Theme page with the background pictures" width="260"></a><br><sub>Settings: Theme</sub></td>
</tr>
<tr>
<td align="center" valign="top" width="33%"><a href="docs/screenshots/connecting.png"><img src="docs/screenshots/connecting.png" alt="Reading your keyboard, waking it up" width="260"></a><br><sub>Reading the keyboard</sub></td>
<td align="center" valign="top" width="33%"><a href="docs/screenshots/asleep.png"><img src="docs/screenshots/asleep.png" alt="Keyboard is asleep" width="260"></a><br><sub>Keyboard asleep</sub></td>
<td align="center" valign="top" width="33%"><a href="docs/screenshots/he.png"><img src="docs/screenshots/he.png" alt="The Lighting tab of an F75 HE on its 2.4G dongle" width="260"></a><br><sub>F75 HE (experimental): Lighting</sub></td>
</tr>
<tr>
<td align="center" valign="top" width="33%"><a href="docs/screenshots/he-perkey.png"><img src="docs/screenshots/he-perkey.png" alt="The Per-key tab of an F75 HE with every key painted" width="260"></a><br><sub>F75 HE: Per-key</sub></td>
<td align="center" valign="top" width="33%"><a href="docs/screenshots/he-keyboard.png"><img src="docs/screenshots/he-keyboard.png" alt="The Keyboard page of an F75 HE: what the keyboard reports about itself" width="260"></a><br><sub>F75 HE: Keyboard</sub></td>
<td align="center" valign="top" width="33%"><a href="docs/screenshots/demo-keyboards.png"><img src="docs/screenshots/demo-keyboards.png" alt="The demo keyboards, shown one at a time with arrows, opened from the Demo keyboards button" width="260"></a><br><sub>Demo keyboards</sub></td>
</tr>
<tr>
<td align="center" valign="top" width="33%"><a href="docs/screenshots/lighting-glass-realistic.png"><img src="docs/screenshots/lighting-glass-realistic.png" alt="The Lighting tab in the Liquid glass UI with Realistic glass, dark theme" width="260"></a><br><sub>Liquid glass: Realistic (experimental)</sub></td>
</tr>
</table>

## Troubleshooting

- Close the official AULA driver. Only one program can use the keyboard at a time.
- Lighting works over the 2.4G dongle (best) or USB-C cable. Bluetooth only gives the battery level.
- The red low-battery light is written by the app, so it only works while Aula Control is running. Hidden in the tray is fine; if you quit the app, nothing watches the battery. Turn on **Start with Windows** in Settings, App to keep it running. Hover the tray icon to see what the app uses right now (CPU and memory, measured by Electron).
- **F75 HE (experimental) not working, or showing an error?** Open `tools/he-probe.html` in Chrome or Edge. It only reads from the keyboard (it cannot write, reset or flash anything) and saves a report of what your keyboard answers. Send that file along with your comment so support can be fixed against a real F75 HE.
- Still stuck? Open **Settings, Connection help** and save a log.

---

*Made with the help of AI.*
