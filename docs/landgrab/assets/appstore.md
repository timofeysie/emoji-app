# LandGrab — App Store (iOS) assets

The iOS assets that **differ from or add to** the Play Store set in
[`playstore.md`](playstore.md). Anything not listed here (visual identity, shot list,
caption rules, the EN + KO approach, the full description, hosted pages) is shared:
make it once for Play and reuse it. Deployment steps are in
[`../deployments/appstore.md`](../deployments/appstore.md).

Specs are Apple's published requirements as last known. App Store Connect's upload
screens are the final word, so recheck sizes when uploading.

## At a glance: what changes vs Play

| Play Store asset | iOS equivalent |
| --- | --- |
| 512×512 hi-res store icon | **None.** The App Store takes the icon from the build (`icon.png`) |
| 1024×500 feature graphic | **None.** iOS has no feature graphic |
| Adaptive + monochrome icons | **None.** iOS uses the single `icon.png` (+ optional dark/tinted variants) |
| Phone / tablet screenshots (flexible sizes) | **Exact pixel sizes** per display class (6.9" iPhone, 13" iPad) |
| YouTube promo video | **App preview videos**, uploaded files, captured from the app itself |
| Short description (80) | **Subtitle** (30) + **promotional text** (170) |
| (no equivalent) | **Keywords** field (100 chars) |
| Support page (recommended) | **Support URL required** |
| Privacy policy URL in Play Console | URL in App Store Connect **and reachable inside the app** |

## 1. App build assets

Location: `apps/land-grab-mobile/assets/` (shared with Android; see that folder's
`README.md`).

| Asset | Spec | `app.json` key | Status |
| --- | --- | --- | --- |
| App icon | 1024×1024 PNG, **no transparency**, square (iOS applies the corner mask), sRGB or P3 | `expo.icon` (or `ios.icon` to override for iOS only) | [ ] The current placeholder `icon.png` **has transparent corners and would be rejected**. The final icon must be opaque full-square artwork. That also works on Android, where the adaptive icon is used anyway |
| Dark icon variant | 1024×1024 PNG, transparent background allowed (iOS draws a dark backdrop) | `ios.icon.dark` | [ ] Optional, iOS 18+ dark home screen |
| Tinted icon variant | 1024×1024 PNG, greyscale artwork | `ios.icon.tinted` | [ ] Optional, iOS 18+ tinted home screen. Can derive from `adaptive-icon-monochrome.png` |
| Layered "Liquid Glass" icon | `.icon` bundle made in Apple's Icon Composer (macOS app) | `ios.icon: "./assets/app.icon"` | [ ] Optional, newer iOS. Needs a Mac to author. Nice-to-have, not a submission requirement |
| Splash | Shared `splash-icon.png` via `expo-splash-screen` | plugin config (optionally `ios`-specific overrides) | [ ] Same as Android. Check how it looks on iPhone and iPad in landscape |

Checks:
- [ ] Confirm the final `icon.png` has no alpha channel:
  `sips -g hasAlpha apps/land-grab-mobile/assets/icon.png` must print `no`.
- [ ] Look at the icon on a real device: home screen, Spotlight (small size), Settings,
  and dark/tinted modes if variants are provided.

## 2. Screenshots

Format: JPEG or PNG, RGB, **no transparency**, 1–10 per display size per locale. Apple
scales the largest size down for smaller devices, so only the largest of each family
is required.

LandGrab is landscape-only, so all screenshots are landscape.

| Display class | Required | Landscape size (px) | Also accepted | Capture viewport (CSS px @ scale) |
| --- | --- | --- | --- | --- |
| iPhone 6.9" | **Yes** | 2868×1320 | 2796×1290, 2736×1260; or provide 6.5" (2688×1242 / 2778×1284) instead | 956×440 @3x |
| iPad 13" | **Yes, if `supportsTablet: true`** | 2752×2064 | 2732×2048 | 1376×1032 @2x |

- [ ] iPhone 6.9" set, EN (3–6 shots from the shared shot list).
- [ ] iPhone 6.9" set, KO.
- [ ] iPad 13" set, EN (if iPad is supported).
- [ ] iPad 13" set, KO (if iPad is supported).

iOS-specific rules on top of the shared ones:
- [ ] **No Android UI** in any screenshot: no Android status bar, navigation bar, back
  button, Android-style dialogs or "Get it on Google Play" text (guideline 2.3.10).
  Don't reuse Android emulator captures.
- [ ] Screenshots must show the app as it runs on that device class. iPad shots must
  show the iPad layout, not a stretched iPhone image.
- [ ] Device frames are optional. If used, use Apple's official product bezels, and
  only for the matching device.
- [ ] Mind the **Dynamic Island / notch side** in iPhone landscape shots: the HUD must
  not sit under it. Capture with the real safe-area insets, or from a device or
  simulator.

How to capture:
- Option A: iOS Simulator (needs a Mac) or a TestFlight build on a real device, then
  `xcrun simctl io booted screenshot` or the device's screenshot button. This gives
  real safe areas.
- Option B: Playwright against `land-grab-web` with the viewport and
  `deviceScaleFactor` from the table above. It produces exact pixel sizes and can be
  repeated, but simulates no notch or safe area. Only use it while the in-app HUD is
  verified to look the same as the web build.

## 3. App preview videos (optional)

| Item | Spec |
| --- | --- |
| Length | 15–30 seconds |
| Count | Up to 3 per display size per locale |
| Format | `.mov`, `.m4v` or `.mp4` (H.264 or ProRes), ≤500 MB, 30 fps |
| Resolution | Per display class. For 6.9" iPhone landscape about 1920×886; for 13" iPad landscape 1600×1200 (check App Store Connect's list for the exact accepted sizes) |
| Content | **Footage captured from the app on the device only.** Captions and overlays allowed; no people holding devices, no Android or web footage |
| Poster frame | Chosen frame shown before playback. Pick a busy mid-match moment |

- [ ] 6.9" iPhone preview (EN; KO captions version if captions are used).
- [ ] 13" iPad preview (if iPad is supported).
- [ ] Capture via QuickTime screen recording of a connected iPhone/iPad, or
  `xcrun simctl io booted recordVideo`. Trim to 15–30 s.

## 4. Listing text (iOS-only fields)

Shared with Play: app name (30), full description (4000, remove any Android/Play
mentions), release notes. iOS adds:

| Field | Limit | EN | KO | Notes |
| --- | --- | --- | --- | --- |
| Subtitle | 30 chars | [ ] | [ ] | Shown under the name, e.g. "Claim the grid". Searchable |
| Promotional text | 170 chars | [ ] | [ ] | Top of the description. **Editable without a new build or review**, useful later for "next online match" announcements |
| Keywords | 100 chars | [ ] | [ ] | Comma-separated, no spaces after commas. Don't repeat words already in the name/subtitle, competitor names or "game"/"app". Research Korean keywords separately rather than translating the English ones |
| Copyright | — | [ ] | — | e.g. "2026 <legal name or business>" |
| What's New | 4000 chars | [ ] | [ ] | Per version, can reuse Play release notes |

## 5. URLs and in-app policy access

| Item | Required | Notes |
| --- | --- | --- |
| Support URL | **Yes** | Always-on host. Must contain real contact info (email). Also needed for multiplayer UGC rules |
| Privacy Policy URL | **Yes** | Same policy as Android, covering both platforms |
| Marketing URL | Optional | |
| **Privacy policy inside the app** | **Yes** | Apple requires the policy to be easily reachable within the app. In Kids Category, links out need a parental gate, so the simplest compliant option is a **bundled in-app "Privacy" screen** with the policy text (EN + KO), plus the URL as plain text. Worth doing for Android too |

- [ ] Add an in-app Privacy screen (web client, reachable from the home/settings
  screen) with the bundled policy text.

## 6. App Review assets

Not shown to customers, but needed for every submission:

- [ ] **Review notes** (EN): the game is bundled and fully playable offline vs bots, no
  login needed, and (after multiplayer) when online play is scheduled.
- [ ] Review contact: name, phone, email.
- [ ] For the multiplayer update: an optional **screen recording of a live online match**
  attached to the review notes (a link or file), in case the reviewer tests while the
  backend is down.

## Multiplayer update — iOS asset changes

On top of the shared list in
[`playstore.md`](playstore.md#multiplayer-update--assets-to-change):

- [ ] Re-capture the iPhone 6.9" and iPad 13" screenshot sets with online-play shots
  (EN + KO).
- [ ] New app preview video if one exists and it showed single-player only.
- [ ] Add "multiplayer"/"online" style terms to keywords (EN + KO) if they fit in 100
  characters.
- [ ] Promotional text: announce online matches and the schedule.
- [ ] Support page: contact info prominent (required for UGC under guideline 1.2).
- [ ] In-app Privacy screen: add the multiplayer data section.
- [ ] Review notes + recording of a live match.

## Storage

- [ ] Exports under `docs/landgrab/assets/store/ios/` (e.g.
  `iphone-6.9/en/01-midmatch.png`, `ipad-13/ko/...`). Keep video and design sources
  outside the repo, with a link here.
- [ ] Keep each file name the same across locales so uploads stay in the same order.
