'use strict';

// The exact command Windows should run when you sign in.
//
// - Installed app: just the app's own .exe.
// - Portable build: process.execPath is a temporary copy that is deleted on exit, so use the real .exe
//   that electron-builder exposes as PORTABLE_EXECUTABLE_FILE.
// - Running from source (npm start): the program is electron.exe, which also needs the app folder as its
//   first argument, otherwise Windows would open Electron's empty default window instead of Aula Control.
//
// Windows does not quote individual arguments for us, so a folder with spaces in its name has to be quoted here.
// "--hidden" is always passed; whether the window then stays hidden is decided by the "Start hidden" setting.
function loginItemOptions({ isPackaged, appPath, execPath, portableFile }) {
  const args = [];
  if (!isPackaged) args.push(`"${appPath}"`);
  args.push('--hidden');
  return { path: portableFile || execPath, args };
}

module.exports = { loginItemOptions };

// ---- Linux ---------------------------------------------------------------------------------------------------------
// Linux has no login-item API in Electron, so "Start at login" is an XDG autostart entry in ~/.config/autostart.

const LINUX_AUTOSTART_NAME = 'aula-control.desktop';

// One argument of a .desktop Exec line: quoted when it needs it (spaces, quotes and the like), with the characters the
// Desktop Entry spec reserves inside quotes escaped.
function desktopExecArg(s) {
  const str = String(s).replace(/%/g, '%%');
  if (!/[\s"'`$\\<>~|&;*?#()]/.test(str)) return str;
  return `"${str.replace(/(["`$\\])/g, '\\$1')}"`;
}

// The AppImage runs from a temporary mount, so its real file (APPIMAGE) is what should start at login.
function linuxAutostartEntry({ path: exe, args }) {
  const exec = [desktopExecArg(exe), ...args.map((a) => (/^".*"$/.test(a) ? desktopExecArg(a.slice(1, -1)) : desktopExecArg(a)))].join(' ');
  return ['[Desktop Entry]', 'Type=Application', 'Name=Aula Control', 'Comment=Battery and lighting for AULA keyboards', `Exec=${exec}`, 'Icon=aula-control', 'Terminal=false', 'X-GNOME-Autostart-enabled=true', ''].join('\n');
}

module.exports.LINUX_AUTOSTART_NAME = LINUX_AUTOSTART_NAME;
module.exports.linuxAutostartEntry = linuxAutostartEntry;
