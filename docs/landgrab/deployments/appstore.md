# LandGrab — Apple App Store submission plan

Plan for taking `apps/land-grab-mobile` (Expo SDK 57, RN 0.86, `react-native-webview`)
to the iOS App Store, alongside the Android plan in [`playstore.md`](playstore.md).
Product decisions are in [`../overall-plan.md`](../overall-plan.md); assets are in
[`../assets/playstore.md`](../assets/playstore.md), and the iOS-specific ones are listed
below.

Much of the work is shared with Android: the privacy policy, terms and support pages,
the always-on host, WebView hardening, the multiplayer backend contract and the
moderation features. This doc covers what is **different or extra** for Apple and links
to `playstore.md` for the rest.

## Where we are today

| Item | State | Notes |
| --- | --- | --- |
| Bundle identifier | `com.emojiapp.landgrab` (`app.json` `ios.bundleIdentifier`) | Permanent once an App Store Connect record exists. Same decision as the Android package name |
| Apple Developer Program | Unknown | Check whether an old Apple ID from the hybrid-app days still has a membership. See Phase 1 |
| Mac / Xcode | Not needed for building | EAS Build compiles in the cloud. A physical iPhone/iPad is strongly recommended for testing |
| iOS builds so far | None (only Android preview APKs) | `web-app-deployments.md` describes an iOS ad hoc build but it hasn't been done |
| iPad support | Not set (`ios.supportsTablet` defaults to false) | The app still runs on iPads in iPhone compatibility mode, and **App Review tests it there** |
| App icon | Placeholder `assets/icon.png` **has transparency** | Apple rejects icons with alpha. The final icon must be opaque and full-square |
| Encryption declaration | Not set | Add `ios.config.usesNonExemptEncryption: false` (see Phase 2) |
| Privacy manifest | Not configured | Expo/RN supply their own; the app may need `ios.privacyManifests` entries (see Phase 2) |

## Key differences from Google Play

| Topic | Google Play | Apple App Store |
| --- | --- | --- |
| Cost | US$25 once | **US$99 per year.** If the membership lapses, the app is removed from sale |
| Mandatory pre-release test | 12 testers × 14 days (new personal accounts) | None. TestFlight is optional but recommended |
| Review | Mostly automated, Families review slower | Human review of every build (usually 1–2 days) |
| Main policy risk | Families policy + strangers interacting | **Guideline 4.2 "minimum functionality"** for WebView-wrapped apps, plus Kids Category rules if chosen |
| Kids listing | "Target audience" + Families policy | Optional **Kids Category** with age bands 5 & under / 6–8 / 9–11 |
| Back button | Must handle Android back | No back button. Disable WebView swipe-back navigation |

## Recommended sequencing

Same as Android: **ship single-player first**, multiplayer as a declared update. Apple
has no tester-days requirement, so iOS can go live as soon as review passes. Choose
between:

- **Android first, iOS soon after** (recommended): Android's 14-day closed test is the
  long pole anyway. Use that time to enrol with Apple and run TestFlight, then submit iOS
  when Android reaches production, so both stores launch close together.
- iOS first: possible, but it gains little if the goal is a joint launch.

```text
Phase 0  Decisions (shared with Android Phase 0)
Phase 1  Apple Developer Program + App Store Connect setup
Phase 2  iOS store-readiness (config, WebView, icon, privacy manifest)
Phase 3  Production build, signing, TestFlight
Phase 4  App Store Connect metadata & declarations
Phase 5  Submit for review → release v1 (single player)
Phase 6  Multiplayer update (iOS-specific additions to playstore.md Phase 6)
```

---

## Phase 0 — Decisions

Shared with [`playstore.md` Phase 0](playstore.md#phase-0--decisions--blockers): bundle
ID / package name, app name, age groups, privacy policy host, version scheme. iOS adds:

- [ ] **Individual or organisation membership.** Individual: quick, and your legal name
  is shown as the seller. Organisation: needs a D-U-N-S number (the same one works for
  a Google organisation account) and shows the business name. Choose the same way for
  both stores.
- [ ] **Kids Category or not.** Separate from the age rating. Kids Category means stricter
  rules (no third-party analytics/ads, a parental gate before any link out, purchase or
  permission prompt) and extra scrutiny of multiplayer with strangers. The overall plan
  says Kids/Families listing, so the default is **yes**, with an age band (likely 9–11).
  Revisit before multiplayer (see [Phase 6](#phase-6--multiplayer-update-ios-additions)).
- [ ] **iPad: supported or iPhone-only?**
  - iPhone-only: fewer screenshots, but App Review still runs the app on an iPad in
    compatibility mode, so it must look acceptable there.
  - Supported (`ios.supportsTablet: true`): needs 13" iPad screenshots and a landscape
    layout that works at iPad sizes. The game board already scales with the viewport.
  - Recommendation: **support iPad**. It's low effort for a WebView game, and kids
    often play on iPads.
- [ ] **Countries.** Exclude **mainland China**, where games need a government licence
  (ISBN) number. Korea: check how Apple handles game ratings for the Korean storefront at
  submission time.
- [ ] **EU trader status** (Digital Services Act). Required to distribute in the EU.
  Declaring as a "trader" publishes an address, phone and email on the listing. A free
  hobby game may qualify as non-trader; decide and record why.

## Phase 1 — Apple Developer Program & App Store Connect

- [ ] Check for an existing membership at
  [developer.apple.com/account](https://developer.apple.com/account) with any Apple ID
  used for the old hybrid apps. Apple doesn't close accounts for inactivity the way
  Google did, but a membership that wasn't renewed has to be renewed or re-enrolled.
  Also check whether old apps are still in App Store Connect.
- [ ] Enrol (or renew) at
  [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll):
  Apple ID with two-factor authentication, US$99/year, identity verification. An
  organisation also needs the D-U-N-S number and legal-entity details.
- [ ] Accept the latest agreements in App Store Connect → **Business**. The Free Apps
  agreement is enough (no paid apps or in-app purchases). Builds can't be submitted while
  an agreement is pending.
- [ ] Turn on auto-renew for the membership and put the renewal date in a calendar.
  Learn from the closed Play account: a lapsed membership removes the app.
- [ ] Create an **App Store Connect API key** (Users and Access → Integrations, role
  App Manager). Store the `.p8` file outside the repo. `eas submit` and EAS-managed
  credentials use it.
- [ ] Create the app record in App Store Connect: platform iOS, name, primary language
  English (U.S.), bundle ID `com.emojiapp.landgrab`, SKU (e.g. `landgrab-ios`). Note
  the numeric **Apple ID** (`ascAppId`) for `eas.json`.
- [ ] Add testers in App Store Connect → Users (internal TestFlight testers, up to 100,
  no review needed).

## Phase 2 — iOS store-readiness

### 2.1 Build toolchain

- [ ] **SDK requirement.** Apple requires new uploads to be built with a recent Xcode /
  iOS SDK (currently the iOS 26 SDK / Xcode 26). Check that the EAS build image for
  SDK 57 uses a compliant Xcode (`eas.json` `build.production.ios.image`, or the build
  log). App Store Connect rejects uploads built with an old SDK.
- [ ] **Minimum iOS version.** Use the SDK 57 default. Only raise it if a dependency
  requires it.

### 2.2 App config (`app.json`)

```jsonc
"ios": {
  "bundleIdentifier": "com.emojiapp.landgrab",
  "supportsTablet": true,          // if iPad is supported (Phase 0)
  "requireFullScreen": true,       // landscape-only app: opt out of iPad Split View/Slide Over
  "config": { "usesNonExemptEncryption": false },  // only HTTPS/WSS → exempt, skips the export question per build
  "infoPlist": {
    "UIStatusBarHidden": true,
    "UIViewControllerBasedStatusBarAppearance": false
  }
}
```

- [ ] `usesNonExemptEncryption: false`. HTTPS/WSS through the OS counts as exempt
  encryption, so this skips the export-compliance question on every build.
- [ ] `requireFullScreen: true`. iPad multitasking requires supporting every
  orientation unless the app opts out, and this app is landscape-only.
- [ ] No usage-description strings (camera, mic, location, tracking) and no
  permissions. Confirm nothing in the dependency tree adds one: App Review rejects
  unexplained permission strings, and Kids Category forbids unnecessary prompts.
- [ ] **No App Tracking Transparency**: no tracking SDKs, so no ATT prompt and
  "Data Not Used to Track You".
- [ ] **Privacy manifest** (`PrivacyInfo.xcprivacy`): Expo/RN libraries include their
  own. Run a production build and check App Store Connect's email for "missing API
  declaration" warnings. Add any needed required-reason entries under
  `ios.privacyManifests` in `app.json` (e.g. `NSPrivacyAccessedAPICategoryUserDefaults`
  with reason `CA92.1`).
- [ ] `eas.json`: add `submit.production.ios` with `ascAppId` and the API key settings.
  `appVersionSource: remote` + `autoIncrement` already handle `buildNumber`.

### 2.3 WebView on iOS (WKWebView)

In addition to the shared hardening in
[`playstore.md` §2.3](playstore.md#23-webview-hardening-families-no-external-links-no-surprises):

- [ ] `allowsBackForwardNavigationGestures={false}`, so an edge swipe can't navigate
  the game away.
- [ ] `allowsLinkPreview={false}` and `dataDetectorTypes="none"` (no long-press
  previews or auto-linked text, which would also break the Kids "no links out" rule).
- [ ] `bounces={false}` and `scrollEnabled={false}` (if the layout allows), so the
  board doesn't rubber-band during swipes.
- [ ] `allowsInlineMediaPlayback`, and `mediaPlaybackRequiresUserAction={false}` if the
  game plays sounds.
- [ ] Debugging: `webviewDebuggingEnabled={__DEV__}` (Safari Web Inspector only in dev).
- [ ] **Touch & gestures**: check that swipe controls don't trigger iOS system gestures
  (home indicator, Control Centre). Consider `expo-system-ui` / deferring system
  gestures on the bottom edge, and auto-hiding the home indicator.
- [ ] **Safe areas in landscape**: Dynamic Island / notch on the left or right. Check
  the HUD isn't clipped on iPhone 15/16/17-class devices in both landscape directions.
- [ ] **Storage**: WKWebView `localStorage` can be cleared by iOS under storage
  pressure. That's acceptable for a casual game (profile and records are nice-to-have),
  but mention it in the privacy policy's "stored on device" wording.
- [ ] **Audio**: if the game uses sound, check it respects the silent switch.

### 2.4 Guideline 4.2 — "minimum functionality" (main iOS risk)

Apple rejects apps that are "a repackaged website". LandGrab is defensible because the
game is **bundled and fully playable offline**, not a remote site in a frame. Make
that obvious to the reviewer:

- [ ] App launches straight into the game with no browser look: no URL bar, no loading
  of a remote page, no scroll bounce, no text selection or long-press menus
  (`user-select: none`, `-webkit-touch-callout: none` in the web CSS).
- [ ] Native touches that are cheap to add: a native splash (`expo-splash-screen`),
  haptics on capture/game over (`expo-haptics`, if added), correct safe areas.
- [ ] The App Review notes say: "Game is bundled and works offline vs bots; it is
  not a website wrapper."
- [ ] Avoid any mention of Android or "also on the web" in the app or metadata
  (guideline 2.3.10).

### 2.5 Kids Category requirements (if chosen)

- [ ] No third-party analytics or advertising SDKs at all.
- [ ] **Parental gate** before anything that leaves the app (links, email, store links,
  including the future "update the app" link) or asks for a permission. A gate is an
  adult-level challenge (e.g. type a number shown in words), not a simple tap.
- [ ] No data sent to third parties. Server logs on our own AWS are first-party.
- [ ] Content suitable for the chosen age band throughout, including bot names and
  default avatars.

### 2.6 iOS assets

Full list with specs and capture instructions: [`../assets/appstore.md`](../assets/appstore.md).
Summary:

| Asset | Spec | Notes |
| --- | --- | --- |
| App icon | 1024×1024 PNG, **no transparency**, no rounded corners | iOS masks it. The current placeholder must be flattened onto a background |
| Dark / tinted icon variants | Optional | iOS 18+ home-screen appearances. Newer iOS also supports layered "Liquid Glass" icons made with Apple's Icon Composer, which Expo can point to with `ios.icon`. Nice-to-have |
| iPhone screenshots | Required: 6.9" display, landscape 2868×1320 (or the accepted 6.5" size, 2688×1242). 1–10 per locale | Smaller sizes are scaled down from these |
| iPad screenshots | Required if `supportsTablet`: 13" display, landscape 2752×2064 (or 2732×2048). 1–10 per locale | |
| App preview video | Optional: 15–30 s, captured from the device, per display size | Must show real gameplay captured in-app |
| Splash | Shared `assets/splash-icon.png` via `expo-splash-screen` | Same as Android |

The same shot list and content rules as Android apply: real gameplay, no multiplayer
before it ships, sample names only, EN + KO captioned versions.

## Phase 3 — Build, signing & TestFlight

```bash
npm run sync:land-grab-mobile
npm run typecheck:land-grab
npm run test:land-grab && npm run test:land-grab-web
cd apps/land-grab-mobile
eas build --platform ios --profile production   # EAS creates/stores distribution cert + provisioning profile
eas submit --platform ios --profile production  # uploads to App Store Connect / TestFlight
```

- [ ] Let EAS manage credentials (distribution certificate, provisioning profile). Back
  up the certificate with `eas credentials`, and record which Apple ID / team owns it.
- [ ] Expo Free plan: 15 iOS builds per month. iOS builds are slower than Android, so
  queue waits can be long.
- [ ] **TestFlight internal testing** (up to 100 App Store Connect users, no review):
  test on at least one small iPhone, one Dynamic Island iPhone, and an iPad (or the iPad
  compatibility mode if iPhone-only).
- [ ] Optional **external TestFlight** (up to 10,000 testers via a public link; the
  first build needs a light Beta App Review). Useful for Korea-based testers before
  multiplayer.
- [ ] Test checklist: cold launch in airplane mode, background/resume mid-match, both
  landscape orientations, swipe controls vs system gestures, rotating mid-game,
  low-power mode, VoiceOver doesn't trap focus.

## Phase 4 — App Store Connect metadata & declarations

### 4.1 Listing text (EN + KO localisations)

| Field | Limit | Notes |
| --- | --- | --- |
| Name | 30 chars | "LandGrab" (must be unique on the App Store) |
| Subtitle | 30 chars | e.g. "Claim the grid" |
| Promotional text | 170 chars | Can be changed without a new build. Handy for "next online match" announcements later |
| Description | 4000 chars | Reuse the Play description; remove Android references |
| Keywords | 100 chars, comma-separated | Not shown publicly. Don't use competitor names |
| What's New | Per version | |
| Support URL | Required | Always-on host |
| Marketing URL | Optional | |
| Privacy Policy URL | Required | Same policy as Android, mentions both platforms |
| Copyright | Required | e.g. "2026 <legal name>" |
| Category | Primary: Games; subcategories Casual / Strategy | Kids Category + age band if chosen |

### 4.2 Declarations

| Declaration | v1 single-player answer | Changes with multiplayer? |
| --- | --- | --- |
| Age rating questionnaire | Mild cartoon/fantasy competitive play; no UGC, no messaging | **Yes**: user-generated content (names/avatars) and in-app controls (report/block) change answers |
| App Privacy ("nutrition label") | **Data Not Collected** (everything stays on device) | **Yes**: see Phase 6 |
| Tracking | No | No |
| Export compliance | Exempt (`usesNonExemptEncryption: false`) | No |
| Content rights | No third-party content (confirm fonts/emoji licences) | No |
| Kids Category + age band | Per Phase 0 | Re-reviewed |
| EU trader status | Per Phase 0 | No |
| App Review information | Contact name/phone/email; notes: offline-playable, bundled game, no login needed | Add the online-schedule explanation |

## Phase 5 — Review & release v1

- [ ] Submit with **manual release** selected, so approval and go-live are separate
  (lets us line it up with the Android launch).
- [ ] Common rejection reasons to pre-empt: 4.2 (web wrapper), 2.1 (crash or broken
  feature on the reviewer's iPad), 5.1.1 (privacy policy missing or not matching the
  App Privacy answers), 2.3 (screenshots not showing the actual app).
- [ ] If rejected: reply in Resolution Center with specifics (e.g. "all gameplay is
  bundled; see offline launch"). Appeals go to the App Review Board.
- [ ] Optional: phased release over 7 days for updates (not available for the first
  version).
- [ ] After launch: keep the membership renewed, rebuild yearly when Apple raises the
  minimum SDK, and watch crash reports in App Store Connect / Xcode Organizer (no
  third-party crash SDK under Kids rules).

---

## Phase 6 — Multiplayer update (iOS additions)

Everything in [`playstore.md` Phase 6](playstore.md#phase-6--multiplayer-release-considerations)
applies to iOS too: bundled client + version handshake, stable `wss://` hostname,
always-on `schedule.json`, graceful offline fallback, terms acceptance, name filter,
report/block, and no free-text chat. iOS-specific additions:

- [ ] **Guideline 1.2 (user-generated content)**: Apple requires *all four* of: a
  filter for objectionable content, a way to report it, a way to block abusive users,
  and published contact information. Our design covers the first three in-app. Put the
  contact info on the support page and in the app.
- [ ] **Kids Category + strangers**: Apple scrutinises kids apps that let children
  interact with unknown users. Before submitting the multiplayer build, reread
  guidelines 1.3 and 5.1.4 and choose one of:
  1. Keep Kids Category, and put a **parental gate** in front of online play, plus
     preset names/avatars for online play; or
  2. Leave Kids Category (keeping a 9+ age rating) if review pushes back. This weakens
     the overall plan's "Kids listing" decision, so only as a fallback.
- [ ] **Age rating**: re-answer the questionnaire (UGC, in-app reporting/blocking
  controls). Apple's newer age-rating system also asks about parental controls and
  age assurance; answer for the multiplayer build.
- [ ] **App Privacy label update** (in App Store Connect *before* submitting the build):
  - *User Content → Other User Content* (display name, avatar): collected, **not linked
    to identity**, not used for tracking, purpose: App Functionality.
  - *Identifiers / Diagnostics*: only if server logs keep IPs or crash data. Match the
    privacy policy's log-retention statement.
- [ ] **Network**: App Transport Security requires TLS. `wss://` with the ACM cert
  passes, so don't add ATS exceptions.
- [ ] **No Local Network permission** needed (internet server, not LAN). Make sure no
  dependency triggers the local-network prompt.
- [ ] **App Review when the backend is down**: the reviewer will probably test on a day
  the stack is destroyed. The notes must explain the schedule and that offline practice
  is the always-available core. If online play is the headline feature of the update,
  consider applying the stack during the review window, or giving a short screen
  recording of a live match in the review notes.
- [ ] **Optional later — Game Center**: not required. If leaderboards or matchmaking
  come later, it would add an Apple-account dimension the "no accounts" decision
  avoided, so treat it as a separate decision.
- [ ] **Push notifications for tournament start**: avoid for v1 multiplayer (needs a
  permission prompt, which is gated in Kids Category, plus APNs setup and a backend that
  runs while the stack is down). Promotional text and in-app "next match" cover it.
- [ ] **Update prompts**: iOS has no equivalent of Play In-App Updates. Show a "please
  update" screen with an App Store link, behind the parental gate if in Kids Category.

## Open questions

1. Is there an existing Apple Developer membership from the hybrid-app days, and under
   which Apple ID?
2. Individual or organisation enrolment (match the Google decision)?
3. Kids Category with which age band, and does that still hold once multiplayer
   ships?
4. iPad supported or iPhone-only?
5. Launch together with Android (recommended), or ship iOS as soon as it's approved?
