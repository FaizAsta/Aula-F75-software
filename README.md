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

<div align="center">

<img src="docs/banner.png" width="800" alt="Aula Control">

**An unofficial Windows app for AULA F75 keyboards.**<br>
Battery, lighting effects, per-key RGB and a live preview.

[![Version](https://img.shields.io/badge/version-1.4.2-blue)](../../releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078d4)](#download)

[**Download**](../../releases) · [Features](#features) · [Troubleshooting](#troubleshooting)

![Aula Control, Lighting tab](docs/screenshots/lighting.png)

</div>

## Read this first

I made this app for myself because AULA's official software is bad and its UI is terrible. I'm sharing it for anyone
who wants to try it. It's free, and you use it on your own.

I don't even know coding, so **use it at your own risk**, or leave if you have any issue. It was made with the help of
AI. If you have a personal problem with that, you're free to leave. I'm not earning anything from it, so I don't need to
worry about it. I just want to share.

**Tested only on the AULA F75.** Every other model (F75 Pro, F87, F75 Max) is untested, so I don't know if it works.
If you get an error, comment on the release.

Not affiliated with AULA.

## Download

Get **Aula-Control-Setup.exe** from [Releases](../../releases) and run it. No admin needed.
A portable **Aula-Control-Portable.exe** is there too.

Windows may warn about an unknown publisher because the app isn't code-signed: choose *More info, Run anyway*.
No keyboard? Try **Settings, Demo keyboard**.

## Features

- Battery level, charging indicator and low / fully charged alerts
- 15 lighting effects and per-key RGB
- Live preview of the keyboard as a rendered picture, a different one for each model (F75, F75 Pro, F87, F75 Max)
- Key assignment (experimental)
- Dark and light themes, tray icon, start with Windows

## Screenshots

All of these are the real app with a simulated keyboard (the Demo keyboard, or a simulated dongle, cable or F75 Max).
Click a picture to see it full size.

### Start and devices

<table>
<tr>
<td align="center" width="50%"><a href="docs/screenshots/start.png"><img src="docs/screenshots/start.png" alt="The start screen" width="430"></a><br><sub>Start screen</sub></td>
<td align="center" width="50%"><a href="docs/screenshots/devices.png"><img src="docs/screenshots/devices.png" alt="The list of connected devices" width="430"></a><br><sub>Connected devices: dongle, USB-C cable and the demo keyboard</sub></td>
</tr>
</table>

### Lighting and per-key

<table>
<tr>
<td align="center" width="50%"><a href="docs/screenshots/lighting.png"><img src="docs/screenshots/lighting.png" alt="The Lighting tab" width="430"></a><br><sub>Lighting: 15 effects, brightness, speed and colour</sub></td>
<td align="center" width="50%"><a href="docs/screenshots/sending.png"><img src="docs/screenshots/sending.png" alt="Sending settings to the keyboard, with the transfer animation" width="430"></a><br><sub>Apply: the transfer animation while settings are sent</sub></td>
</tr>
<tr>
<td align="center" width="50%"><a href="docs/screenshots/per-key.png"><img src="docs/screenshots/per-key.png" alt="The Per-key tab with every key painted" width="430"></a><br><sub>Per-key: paint single keys or use a preset</sub></td>
<td align="center" width="50%"><a href="docs/screenshots/light-theme.png"><img src="docs/screenshots/light-theme.png" alt="The Lighting tab in the light theme" width="430"></a><br><sub>The light theme</sub></td>
</tr>
</table>

### Keys (experimental)

<table>
<tr>
<td align="center" width="50%"><a href="docs/screenshots/keys.png"><img src="docs/screenshots/keys.png" alt="The Keys tab with Caps Lock changed to F13" width="430"></a><br><sub>Key assignment, here Caps Lock changed to F13 (nothing is sent until you press Apply)</sub></td>
<td width="50%"></td>
</tr>
</table>

### Battery

<table>
<tr>
<td align="center" width="50%"><a href="docs/screenshots/battery.png"><img src="docs/screenshots/battery.png" alt="The Battery screen with the activity chart" width="430"></a><br><sub>Battery level, estimate and activity history</sub></td>
<td align="center" width="50%"><a href="docs/screenshots/charging.png"><img src="docs/screenshots/charging.png" alt="The Battery screen while charging over the cable on the 2.4G dongle" width="430"></a><br><sub>Charging, with the level read over the 2.4G dongle</sub></td>
</tr>
<tr>
<td align="center" width="50%"><a href="docs/screenshots/charging-cable.png"><img src="docs/screenshots/charging-cable.png" alt="The Battery screen on the USB-C cable, which reports no level" width="430"></a><br><sub>Charging over the USB-C cable alone (the cable reports no level)</sub></td>
<td width="50%"></td>
</tr>
</table>

### Settings

<table>
<tr>
<td align="center" width="50%"><a href="docs/screenshots/settings.png"><img src="docs/screenshots/settings.png" alt="Settings, Keyboard page" width="430"></a><br><sub>Settings, Keyboard: connection, model, tools</sub></td>
<td align="center" width="50%"><a href="docs/screenshots/settings-app.png"><img src="docs/screenshots/settings-app.png" alt="Settings, App page" width="430"></a><br><sub>Settings, App: tray, start with Windows, updates</sub></td>
</tr>
<tr>
<td align="center" width="50%"><a href="docs/screenshots/settings-theme.png"><img src="docs/screenshots/settings-theme.png" alt="Settings, Theme page with the background pictures" width="430"></a><br><sub>Settings, Theme: dark or light, background picture and opacity, preset backgrounds</sub></td>
<td align="center" width="50%"><a href="docs/screenshots/settings-debug.png"><img src="docs/screenshots/settings-debug.png" alt="Settings, Debugging page" width="430"></a><br><sub>Settings, Debugging: connection log and compatibility report</sub></td>
</tr>
</table>

### When the keyboard is not ready

<table>
<tr>
<td align="center" width="50%"><a href="docs/screenshots/connecting.png"><img src="docs/screenshots/connecting.png" alt="Reading your keyboard, waking it up" width="430"></a><br><sub>Reading the keyboard (waking it up)</sub></td>
<td align="center" width="50%"><a href="docs/screenshots/asleep.png"><img src="docs/screenshots/asleep.png" alt="Keyboard is asleep" width="430"></a><br><sub>The keyboard is asleep: press any key</sub></td>
</tr>
</table>

### Updates and window buttons

<table>
<tr>
<td align="center" width="50%"><a href="docs/screenshots/update.png"><img src="docs/screenshots/update.png" alt="The Software Update window" width="430"></a><br><sub>Software update, with the release notes</sub></td>
<td align="center" width="50%"><a href="docs/screenshots/window-controls.png"><img src="docs/screenshots/window-controls.png" alt="The flat window buttons in each state" width="430"></a><br><sub>The window buttons: idle, hover, close hover and maximized</sub></td>
</tr>
</table>

### F75 Max (experimental)

<table>
<tr>
<td align="center" width="50%"><a href="docs/screenshots/max.png"><img src="docs/screenshots/max.png" alt="The F75 Max Lighting screen" width="430"></a><br><sub>F75 Max, Lighting: 20 effects</sub></td>
<td align="center" width="50%"><a href="docs/screenshots/max-perkey.png"><img src="docs/screenshots/max-perkey.png" alt="The F75 Max Per-key screen" width="430"></a><br><sub>F75 Max, Per-key colours</sub></td>
</tr>
</table>

## Troubleshooting

- Close the official AULA driver. Only one program can use the keyboard at a time.
- Lighting works over the 2.4G dongle (best) or USB-C cable. Bluetooth only gives the battery level.
- Still stuck? Open **Settings, Connection help** and save a log.

---

*Made with the help of AI.*
