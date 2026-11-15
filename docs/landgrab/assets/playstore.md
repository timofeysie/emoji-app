# LandGrab — Play Store assets

Everything that has to be made (images, text, hosted pages) before LandGrab can be
listed on Google Play. Deployment steps are in
[`../deployments/playstore.md`](../deployments/playstore.md); product decisions are in
[`../overall-plan.md`](../overall-plan.md).

iOS-specific assets are in [`appstore.md`](appstore.md).

Assets fall into four groups:

1. **App build assets**: inside the APK/AAB (launcher icon, splash screen).
2. **Store listing graphics**: uploaded to Play Console.
3. **Store listing text**: typed into Play Console, in English and Korean.
4. **Hosted pages and contact details**: public URLs that must stay up all the time.

Specs below are Google's and Expo's current published limits. Recheck the Play Console
upload screens when uploading, since they occasionally change.

## Visual identity (existing)

Taken from the current web client, so the store assets match the game:

| Role | Colour |
| --- | --- |
| Background (also `theme-color`) | `#020617` (slate-950) |
| Surface | `#0f172a`, `#1e293b` |
| Primary accent | `#38bdf8` (sky-400) |
| Button | `#0284c7` |
| Text | `#f8fafc`, muted `#94a3b8` |
| Highlights | `#facc15`, `#f97316` |

- [ ] Decide the icon concept. Suggestion: a stylised grid with two or three
  coloured territories and a player head leaving a trail. That reads as "LandGrab"
  at 48 px and doesn't depend on text.
- [ ] Decide whether a wordmark (the name "LandGrab" in a chosen typeface) is needed.
  It's only used on the feature graphic and maybe the splash screen.

## 1. App build assets

Location: `apps/land-grab-mobile/assets/`, referenced from `app.json`. The folder
currently holds **stock Expo/Android placeholders** at the final sizes (`icon.png`,
`adaptive-icon.png`, `adaptive-icon-monochrome.png`, `splash-icon.png`). Replace them
in place; see the folder's `README.md`.

| Asset | Spec | `app.json` key | Status |
| --- | --- | --- | --- |
| App icon | 1024×1024 PNG, square, no transparency, no rounded corners baked in | `expo.icon` | [ ] |
| Adaptive icon foreground | 1024×1024 PNG with transparency. Keep the artwork inside the central ~66% safe zone, because launchers crop it to circles, squircles, etc. | `android.adaptiveIcon.foregroundImage` | [ ] |
| Adaptive icon background | Solid `#020617`, or a 1024×1024 PNG | `android.adaptiveIcon.backgroundColor` / `backgroundImage` | [ ] |
| Monochrome icon | 1024×1024 PNG, a single-colour silhouette of the foreground, for Android 13+ themed icons | `android.adaptiveIcon.monochromeImage` | [ ] |
| Splash image | The logo on a transparent PNG (≈1024×1024 source, shown ~200 dp wide), on a `#020617` background. Android 12+ shows it as an icon in a circle, so keep it simple | `expo-splash-screen` plugin (`image`, `imageWidth`, `backgroundColor`) | [ ] |

Not needed: notification icon (no push notifications planned) and an iOS-specific
icon set (the 1024 icon covers it later).

Checks:
- [ ] Preview the adaptive icon with circle, squircle and teardrop masks (Android
  Studio's Image Asset tool, or an online adaptive icon previewer).
- [ ] Install a preview build and look at the icon on a real home screen, in the
  app switcher and with themed icons turned on.

## 2. Store listing graphics

Location for sources and exports: `docs/landgrab/assets/store/` (or a design folder
outside the repo if files get large). Keep the editable source files too (Figma, SVG,
etc.).

| Asset | Required | Spec | Status |
| --- | --- | --- | --- |
| Hi-res app icon | Yes | 512×512 PNG, 32-bit, ≤1 MB. Play adds the rounded corners and shadow, so supply it full-square | [ ] |
| Feature graphic | Yes | 1024×500 JPEG or 24-bit PNG (no transparency). Shown at the top of the listing and in promotions | [ ] |
| Phone screenshots | Yes, at least 2 (up to 8) | JPEG or 24-bit PNG, sides 320–3840 px, long side no more than 2× the short side. For games, **at least 3 landscape screenshots at 1920×1080 or larger** to be eligible for featuring in Play's game sections | [ ] |
| 7" tablet screenshots | Recommended | Same format; needed to appear in tablet-optimised listings | [ ] |
| 10" tablet screenshots | Recommended | Same format | [ ] |
| Chromebook screenshots | Optional | Only if we opt in to large-screen distribution | [ ] |
| Promo video | Optional | Public or unlisted YouTube URL, embeddable, no ads, not age-restricted. 30–60 s of real gameplay | [ ] |

### Screenshot shot list (v1, single player)

All landscape, matching the app's `orientation: landscape`:

1. [ ] Mid-match: several territories, a visible trail, the HUD.
2. [ ] Capture moment: a loop just closed and territory filling in.
3. [ ] Player profile: name and the 8×8 avatar editor.
4. [ ] Bot opponents or bot profile panel.
5. [ ] Game over and match records chart.
6. [ ] (Optional) Replay view.

Guidelines:
- [ ] Use real in-game footage. No mock-ups of features that don't exist yet. In
  particular, **don't show multiplayer, lobbies or tournaments before they ship**,
  because that counts as misleading under Play policy.
- [ ] Short caption overlays are fine. Avoid claims like "#1", "Best", rankings or
  price promotions; Play rejects those in graphics.
- [ ] Use player names and avatars that are clearly sample content (e.g. "Player 1",
  simple shapes), with no real names.
- [ ] If captions are used, make a Korean version of each captioned screenshot and of
  the feature graphic.

How to capture:
- Option A: the EAS preview build on a physical device or emulator, using the
  emulator's screenshot tool at 1920×1080.
- Option B: run `land-grab-web` and capture with Playwright at a 1920×1080 viewport
  (the repo already has Playwright set up). This can be repeated after UI changes. Only
  use it while the web build looks the same as the in-app WebView.

## 3. Store listing text

Write in English first, then Korean (the overall plan's two target languages). Play
lets each language have its own text and graphics.

| Field | Limit | EN | KO |
| --- | --- | --- | --- |
| App name | 30 chars | [ ] "LandGrab" (+ optional subtitle, e.g. "LandGrab: Territory Battle") | [ ] |
| Short description | 80 chars | [ ] | [ ] |
| Full description | 4000 chars | [ ] | [ ] |
| Release notes ("What's new") | 500 chars per release | [ ] | [ ] |

Full description outline:
- [ ] One-line hook: claim territory by drawing loops; don't get your trail cut.
- [ ] How to play (3–4 short lines).
- [ ] Features: offline play vs bots, the avatar editor, match records and replays.
- [ ] "No ads, no in-app purchases, no account needed". This is true and a strong
  selling point for parents in a Families listing.
- [ ] Contact/support line.
- [ ] Don't repeat keywords to game search ranking. Play policy rejects that.

Other Play Console fields:
- [ ] Category: Game → Casual (or Strategy).
- [ ] Tags: up to 5 from Play's list (e.g. Casual, Strategy, Multiplayer once it ships).
- [ ] Contact email (required, shown publicly). A dedicated address is better than a
  personal one.
- [ ] Website (optional).

## 4. Hosted pages and contact details

These must stay reachable while the AWS stack is torn down, so host them on GitHub
Pages or an always-on bucket, not the game server.

| Page | Needed for | Status |
| --- | --- | --- |
| Privacy policy (EN + KO) | v1, required (Families) | [ ] |
| Support / contact page | v1, recommended | [ ] |
| Terms / community rules | Multiplayer (players accept these before going online) | [ ] |
| `schedule.json` (next online match time) | Multiplayer | [ ] |

## Multiplayer update — assets to change

When the multiplayer release ships (Phase 6 of the deployment plan):

- [ ] New screenshots: online lobby, live match with other players' names and
  avatars, the "next online match" screen when offline. Use sample names only.
- [ ] Update the feature graphic if it shows the game as single-player only.
- [ ] Full description: add online matches and **say that online play happens at
  scheduled times**, with practice vs bots available anytime. This sets expectations
  and helps app review.
- [ ] Description and in-app text mention the report and block tools (part of what
  Play expects when players can see each other's content).
- [ ] Release notes in EN + KO.
- [ ] Add a "Multiplayer" tag.
- [ ] Privacy policy multiplayer section, terms page and `schedule.json` go live.

## Ownership & storage

- [ ] Keep exported store assets (PNG/JPG) in git, under `docs/landgrab/assets/store/`.
  Keep large source files (video, layered design files) outside the repo, with a link
  here.
- [ ] Record fonts and any third-party art with their licences. Everything in the
  listing must be ours or properly licensed, including emoji fonts if emoji appear in
  screenshots (system emoji in a screenshot are fine; emoji artwork used as a logo
  needs a licence check).
