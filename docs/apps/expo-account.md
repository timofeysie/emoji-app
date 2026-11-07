# Expo account for LandGrab mobile builds

An Expo account is required to create a standalone LandGrab build with
[EAS Build](https://docs.expo.dev/build/setup/) and install it on a test
device. The Expo SDK and this repository stay free; the account is what
unlocks Expo's cloud build service.

The full device-install process is in
[web-app-deployments.md](web-app-deployments.md). This page covers only
the account: what to create, which plan to use, how to sign in, and what
the account owns after `eas init`.

## When you need an account

| Task | Expo account |
| --- | --- |
| Run the game in Expo Go over Metro | Not required |
| Local Android build with Android Studio | Not required |
| Cloud EAS preview APK or iOS build | Required |
| View builds at [expo.dev](https://expo.dev) | Required |
| Store the Android keystore for later APK updates | Required |

For a test-device install from this Windows machine, use a Free Expo
account and EAS. The machine does not have an Android SDK.

## Create the account

1. Open [expo.dev/signup](https://expo.dev/signup).
2. Register with email and password, or sign in with GitHub or Google.
3. Confirm the email if Expo asks.
4. Optional but recommended: turn on two-factor authentication under
  **User settings**. Personal-account credentials must not be shared.

Signing up creates a **Personal** account. That is enough for LandGrab
test builds. Create an **Organization** later if several people need
access to the same project, shared credentials, or a shared EAS
subscription. See [Account types](https://docs.expo.dev/accounts/account-types/).

Do not put a password or access token in this repository.

## Plan required for a test APK

EAS Build is available on the Free plan. Paid plans only add more
concurrency, shorter queues, and larger quotas.

The Free plan currently includes:

- Up to 15 Android and 15 iOS cloud builds per month
- One concurrent build
- 45-minute build timeout
- Low-priority queue (peak waits can exceed 90 minutes)
- Up to 25 projects

Confirm current limits at [expo.dev/pricing](https://expo.dev/pricing).
If the monthly Android quota is used up, wait for the next month or
build locally as described in
[web-app-deployments.md](web-app-deployments.md).

A paid Apple Developer Program membership is **not** an Expo plan. It is
a separate Apple account and is only required for device iOS builds
outside the simulator. A Google Play Developer account is only required
to upload to the Play Store, not to sideload an APK.

## Sign in on this machine

Install the EAS CLI and authenticate:

```powershell
npm install -g eas-cli
eas login
eas whoami
```

`eas login` accepts the Expo username or email and password. `eas whoami`
prints the signed-in account. `npx eas-cli@latest` can replace a global
install if you prefer not to install globally.

To switch accounts:

```powershell
eas logout
eas login
```

Session credentials stay on the machine, not in the repo.

## Link LandGrab to the account

The mobile app is not linked yet. `apps/land-grab-mobile/app.json` has a
`slug` of `land-grab` but no `owner` or `extra.eas.projectId`.

From `apps/land-grab-mobile` only. Do not run `eas init` or `eas build`
from the repository root. That links and builds `@timofeysie/emoji-app`
instead of LandGrab, then fails in Prebuild because the root workspace
does not install `expo`.

```powershell
cd apps/land-grab-mobile
eas init
```

The CLI asks which account should own the project, creates
`@<username>/land-grab` on Expo, and writes into `app.json`:

- `expo.owner` — account username or organization slug
- `expo.extra.eas.projectId` — UUID Expo uses for builds

Commit those fields. Later `eas build` commands fail with
`EAS project not configured` if `projectId` is missing.

Builds then appear at [expo.dev](https://expo.dev) under that account,
in the **LandGrab** project **Builds** tab.

To build under an organization instead of the personal account, create
the organization in the dashboard, set `expo.owner` to the organization
slug, and run `eas init` again while signed in as a member of that
organization.

## What the account stores

After the first Android preview build, the Expo account holds:

- The EAS project (`slug` `land-grab`, Android package
`com.emojiapp.landgrab`)
- The generated Android keystore, reused so later APKs install over the
same app
- Build history, logs, and download links

If a different Expo account generates a new keystore, Android will
refuse to install the new APK over the old one until LandGrab is
uninstalled.

## Organization roles (optional)

Invite collaborators from **Organization settings > Members**. Roles
from Expo's access model:

| Role | Can do for LandGrab |
| --- | --- |
| Owner | Any action, including delete |
| Admin | Settings, paid services, tokens, permissions |
| Developer | Create projects, start builds, manage credentials |
| Viewer | View the project only |

A Personal account cannot grant those roles. Convert it to an
organization or create a new organization first.

## Tokens for CI (optional)

Do not use `eas login` in CI. Create a token from the dashboard
**Access tokens** page and set it only in the CI secret store:

```powershell
$env:EXPO_TOKEN = "<token>"
eas whoami
```

`EXPO_TOKEN` takes precedence over a local `eas login` session. Treat
the token like a password. Revoke it from the dashboard if it leaks.
The project must already have `extra.eas.projectId` before token-based
commands such as `eas build` will run.

## Check the signed-in account

```powershell
eas whoami
eas project:info
```

`eas whoami` must match the `owner` written in `app.json`. If it does
not, log out and log in to the account that owns `@<owner>/land-grab`.
