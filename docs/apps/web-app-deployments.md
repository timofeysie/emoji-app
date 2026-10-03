# Web app deployments to a test device

This guide builds the current LandGrab web game into the Expo app and installs
it on a physical test device.

## How the pieces fit together

The mobile app does not load the web game from a server. The web game is
compiled into a single HTML string that ships inside the native app.

```text
apps/land-grab-web            React + Phaser game (Vite)
  └─ npm run build            vite-plugin-singlefile inlines JS, CSS, assets
       └─ dist/index.html
            └─ scripts/generate-mobile-html.mjs
                 └─ apps/land-grab-mobile/src/generated/landGrabHtml.ts
                      └─ src/App.tsx renders it in a react-native-webview
                           └─ index.ts registers App with Expo
```

Consequences:

- Every web change must be re-synchronised into `landGrabHtml.ts` before a
  mobile build, or the device runs stale game code.
- `landGrabHtml.ts` is generated and checked in. Do not edit it by hand.
- Offline practice needs no network. The optional
  `EXPO_PUBLIC_LAND_GRAB_SERVER_URL` value is only a bridge for the future
  online mode.

## Choose a deployment route

| Route | Result | Needs |
| --- | --- | --- |
| Expo Go | Runs over Metro, no install | Expo Go app, same network |
| EAS preview build | Installable Android APK | Free Expo account |
| EAS iOS ad hoc build | Installable iOS app | Paid Apple Developer account |
| Local Android build | APK built on this PC | Android Studio, JDK 17 |

For a standalone build that stays on the device, use the EAS preview build.
EAS builds in the cloud, so it works from Windows without Android Studio.

## 1. Prepare the code

Run these from the repository root in PowerShell.

```powershell
git pull
npm install
```

Optionally bump the version numbers so you can confirm the device is running
the new build:

- `apps/land-grab-web/package.json` `version` is shown on the game home
  screen.
- `apps/land-grab-mobile/app.json` `expo.version` is the native app version.

Validate the game, then rebuild and embed the web bundle:

```powershell
npm run test:land-grab
npm run test:land-grab-web
npm run typecheck:land-grab
npm run sync:land-grab-mobile
```

`sync:land-grab-mobile` runs `vite build` for the web app and then writes
`apps/land-grab-mobile/src/generated/landGrabHtml.ts`. It should print:

```text
Generated ...\apps\land-grab-mobile\src\generated\landGrabHtml.ts
```

Check that the JavaScript bundle still exports cleanly:

```powershell
npm run export:land-grab-mobile
```

Commit the regenerated HTML so the build and the git history match:

```powershell
git add apps/land-grab-mobile/src/generated/landGrabHtml.ts
git commit -m "sync land grab mobile bundle"
```

EAS uploads the repository respecting `.gitignore`, so anything ignored, such
as `.env.local`, is not included in the cloud build.

## 2. Quick check with Expo Go (optional)

Before spending a cloud build, you can run the embedded game on the device
through Expo Go:

```powershell
npm run dev:land-grab-mobile
```

Scan the QR code with an Expo Go version that supports Expo SDK 57. To clear
the Metro cache:

```powershell
npm exec --workspace @emoji-app/land-grab-mobile -- expo start --clear
```

This does not install an app. Stopping Metro stops the game.

## 3. One-time EAS setup

Create or sign in to the Expo account first. Account type, Free-plan
limits, and what `eas init` writes to `app.json` are in
[expo-account.md](expo-account.md).

Install the EAS CLI and sign in with your Expo account:

```powershell
npm install -g eas-cli
eas login
```

Link the mobile workspace to an Expo project. This adds
`extra.eas.projectId` (and possibly `owner`) to `app.json`, which should be
committed:

```powershell
cd apps/land-grab-mobile
eas init
```

Create `apps/land-grab-mobile/eas.json` with a `preview` profile that
produces an installable APK instead of a Play Store bundle:

```json
{
  "cli": {
    "version": ">= 16.0.0",
    "appVersionSource": "remote"
  },
  "build": {
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "autoIncrement": true
    }
  }
}
```

If the build needs a game server URL, add it to the profile rather than
`.env.local`, because ignored files are not uploaded:

```json
"preview": {
  "distribution": "internal",
  "env": {
    "EXPO_PUBLIC_LAND_GRAB_SERVER_URL": "https://game.example.com"
  },
  "android": {
    "buildType": "apk"
  }
}
```

Commit `eas.json` and the `app.json` changes.

## 4. Build for Android

Run this from `apps/land-grab-mobile`, not the repository root. The root
`package.json` is the emoji web API workspace and does not include Expo.
A root build uploads `@timofeysie/emoji-app` and fails in Prebuild with
`SDK < 41` because `expo` is not installed there.

```powershell
cd apps/land-grab-mobile
eas build --platform android --profile preview
```

On the first run, accept the prompt to generate an Android keystore. EAS
stores it and reuses it, which lets later builds install as updates over the
existing app.

EAS runs `npm install` at the monorepo root using the root
`package-lock.json`, bundles `index.ts`, and compiles the native app. When it
finishes, the CLI prints a build URL and a QR code. Builds are also listed at
[expo.dev](https://expo.dev) under the project's **Builds** tab.

## 5. Install on the Android test device

Android Studio is not required for the cloud build or a phone install.
The EAS CLI only needs Android Studio (or the standalone Android SDK
platform-tools) if you answer **yes** to installing on a local emulator.
That path uses `adb`. Without `ANDROID_HOME`, the CLI still downloads
the APK, then exits with `spawn adb ENOENT`. The cloud build itself
already succeeded.

On the phone, use the camera or Chrome, not Expo Go. Expo Go is only
for the Metro QR from `npm run dev:land-grab-mobile`.

1. Open the build URL from the CLI, or scan that QR code with the
   camera.
2. On the Expo build page, tap **Download** rather than **Install** if
   **Install** hangs.
3. Open the `.apk` from the device **Downloads** folder.
4. Allow the browser or Files app to install unknown apps when Android
   asks. The system dialog is a second prompt; dismissing it leaves no
   icon.
5. Search the app drawer for **LandGrab**. There is no custom icon yet,
   so look for the name, not a branded graphic. Some launchers do not
   add a home-screen shortcut.
6. Confirm the version on the game home screen matches the web package
   version.

If **Install** on the Expo page times out, the APK is often already in
Downloads and the browser lacks "install unknown apps" permission.
Enable it under **Settings → Apps → Special app access → Install
unknown apps**, then open the downloaded file.

If an install fails with a signature conflict, uninstall the existing
LandGrab app first. This happens when the old install was signed with a
different keystore.

## iOS test devices

Installing an iOS build outside the App Store needs a paid Apple Developer
account. The bundle identifier `com.emojiapp.landgrab` is already set in
`app.json`.

```powershell
eas device:create
eas build --platform ios --profile preview
```

`eas device:create` produces a link for registering the iPhone's UDID. Register
the device before building, because ad hoc builds only install on devices in
the provisioning profile. Open the resulting build link on the iPhone to
install, and enable **Developer Mode** in iOS settings if prompted.

## Local Android build (alternative)

To build without EAS, install Android Studio (Android SDK and platform tools)
and JDK 17, set `ANDROID_HOME`, enable USB debugging on the device, and
connect it. Then, from `apps/land-grab-mobile`:

```powershell
npx expo run:android --variant release
```

This generates a native `android/` directory. Add `android/` to `.gitignore`
unless you intend to maintain native code by hand.

## Release checklist

1. `git pull` and `npm install`.
2. Bump versions if you want to identify the build.
3. Run the LandGrab tests and type checks.
4. `npm run sync:land-grab-mobile`.
5. `npm run export:land-grab-mobile`.
6. Commit the regenerated `landGrabHtml.ts`.
7. `eas build --platform android --profile preview` from
   `apps/land-grab-mobile`.
8. Install the APK from the build link and check the version on the home
   screen.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Device shows old game behaviour | `sync:land-grab-mobile` not run |
| "LandGrab could not load" | WebView error; tap **Reload** |
| Server URL missing in build | Set in `eas.json` `env`, not `.env.local` |
| APK will not install over old app | Different signing keystore |
| Expo Go refuses the project | Expo Go does not support SDK 57 |
| Prebuild fails, `SDK < 41` | `eas` was run from the repo root |
| Build URL is `projects/emoji-app` | Wrong project; use `projects/land-grab` |
| `spawn adb ENOENT` after download | Needs `adb`; use the phone instead |
| No LandGrab icon after scanning QR | Install unfinished, or check the drawer |
| Expo **Install** button times out | Open the `.apk` from Downloads |
