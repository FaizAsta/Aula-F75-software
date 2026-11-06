Preset backgrounds
==================

Put your pictures in this folder (PNG, JPEG or WebP). Each one shows up in the app
under Settings > Theme > Preset backgrounds, and none of them is chosen by default.

They are packed into the app when you build it (npm run dist / Build Windows App.bat),
so there is no list to edit: add the file, rebuild, done.

Tips
- Use a normal file name. The name is turned into the label: "dark-forest_01.webp"
  is shown as "Dark forest 01". Pictures are sorted by name.
- Around 1920 px on the long side is plenty. The app shows it at 50% opacity.
- Keep each picture under about 3 MB so the built app stays small.
- Other file types (this README, SVG, ...) are ignored.
