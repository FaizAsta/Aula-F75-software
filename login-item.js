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
