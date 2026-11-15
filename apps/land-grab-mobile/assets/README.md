# LandGrab mobile assets

**These are placeholders.** They are the stock Expo/Android graphics (the green Android
robot launcher icon and the grey grid splash logo) taken from the Expo SDK 57 template
(`node_modules/expo/template.tgz`), resized to the sizes the build expects. To brand the
app, replace each file with new artwork at the **same size and file name**. No config
change is needed.

| File | Size | Used by (`app.json`) | Notes |
| --- | --- | --- | --- |
| `icon.png` | 1024×1024 | `expo.icon` | Fallback launcher icon (older Android) and the future iOS icon. The final version should be full-square and opaque (iOS rejects transparency); this placeholder keeps the stock transparent corners. |
| `adaptive-icon.png` | 1024×1024, transparent | `android.adaptiveIcon.foregroundImage` | Keep artwork inside the central circle of ~676 px diameter (66%), because launchers crop the edges into circles, squircles, etc. |
| `adaptive-icon-monochrome.png` | 1024×1024, transparent | `android.adaptiveIcon.monochromeImage` | Android 13+ themed icons. Only the alpha (shape) is used, not the colours. |
| (colour) `#26A599` | — | `android.adaptiveIcon.backgroundColor` | Stock teal. Change to `#020617` (or a background image) with the real icon. |
| `splash-icon.png` | 1024×1024, transparent | Not wired yet | Needs the `expo-splash-screen` config plugin: `npx expo install expo-splash-screen`, then `["expo-splash-screen", { "image": "./assets/splash-icon.png", "imageWidth": 200, "backgroundColor": "#020617" }]` in `plugins`. |

The 192 px stock launcher icon was scaled up to 1024 px, so the placeholders look soft
when enlarged. That's expected; it won't matter once they're replaced.

Store listing graphics (512×512 Play icon, 1024×500 feature graphic, screenshots) are a
separate set. See [`docs/landgrab/assets/playstore.md`](../../../docs/landgrab/assets/playstore.md).
