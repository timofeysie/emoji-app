# LandGrab — Google Play Store submission plan

Plan for taking `apps/land-grab-mobile` (Expo SDK 57, RN 0.86, `react-native-webview`)
from the current EAS preview APK to a production listing on Google Play, with the
multiplayer phase from [`../overall-plan.md`](../overall-plan.md) designed in rather than
bolted on later.

Related docs: [`docs/apps/expo-account.md`](../../apps/expo-account.md) (EAS account,
keystore) and [`docs/apps/web-app-deployments.md`](../../apps/web-app-deployments.md)
(building the web bundle into the app, preview APK). The iOS counterpart is
[`appstore.md`](appstore.md).

## Where we are today

| Item | State | Notes |
| --- | --- | --- |
| Expo project | Linked (`owner: timofeysie`, `projectId` set) | `apps/land-grab-mobile/app.json` |
| Package name | `com.emojiapp.landgrab` | **Permanent once uploaded to Play** — confirm before first upload |
| Game delivery | Web build inlined into the app (`src/generated/landGrabHtml.ts`, ~1.4 MB) loaded via `source={{ html }}` | Works fully offline. Differs from the overall plan's "WebView around the deployed web client" — see [Delivery model](#delivery-model-bundled-vs-hosted) |
| Server URL | `EXPO_PUBLIC_LAND_GRAB_SERVER_URL`, baked in at build time and injected as `window.__LAND_GRAB_CONFIG__` | Already the seam for multiplayer |
| Versions | App `0.1.0` (`app.json`), web `0.1.3` | Align before the first store build |
| `eas.json` | `preview` (APK, internal) and `production` (`autoIncrement`, remote version source) | No `submit` profile yet |
| Icons / splash | None — no `assets/` directory | Expo defaults would ship; must be replaced |
| Permissions | Not declared | Need to audit what the merged manifest actually requests |
| Play developer account | **None usable.** The old account was closed for inactivity on 23 Dec 2021 and can't be reactivated | A new account is needed — see Phase 1. This corrects the overall plan's "a Google Play developer account already exists" |

## Guiding decisions (carried from the overall plan)

- **Kids/Families listing from day one.** No ad SDKs, no general analytics SDKs, no
  external links out of the app, data minimisation.
- **No accounts, no persisted server data.** Simplifies Data safety, but a privacy policy
  is still required.
- **The app must always be useful, even with the backend torn down.** Offline bot
  practice is the baseline experience; multiplayer is an "online when available" mode.

## Recommended sequencing

Ship **single-player first**, multiplayer as a later update — but write every store
declaration so the multiplayer update is a known, scheduled change rather than a
re-review surprise.

Reasons:

1. New personal Play developer accounts need a **closed test with at least 12 opted-in
   testers for 14 continuous days** before production access is granted. Starting that
   clock with the current single-player build costs nothing and runs in parallel with
   multiplayer development.
2. Store declarations (content rating, Data safety, target audience) must describe the
   build that is live. Single-player-vs-bots is the simplest possible version to get
   approved under the Families policy; multiplayer then becomes a declared change.
3. Package name, signing key, listing assets and the privacy policy are all one-time
   work that multiplayer doesn't change.

```text
Phase 0  Decisions & blockers           (days)
Phase 1  Play Console + account setup   (days, parallel with Phase 2)
Phase 2  App store-readiness            (1–2 weeks)
Phase 3  Production build & signing     (1–2 days)
Phase 4  Internal → closed testing      (≥14 days, gated by Google)
Phase 5  Production release v1 (single player)
Phase 6  Multiplayer update release     (after overall-plan phases 1–2)
```

---

## Phase 0 — Decisions & blockers

- [ ] **Package name.** `com.emojiapp.landgrab` can never change after the first upload.
  Decide whether LandGrab should live under an `emojiapp` namespace or its own
  (e.g. a domain you own, reversed). Change it now if at all.
- [ ] **App name on the store.** "LandGrab" — check for existing Play listings with the
  same/similar name and trademark conflicts.
- [ ] **Target age groups.** Overall plan says Kids/Families. Pick the exact Play age
  bands (e.g. 9–12 + 13–15 + 16–17 + 18+ mixed audience, vs. under-13 only). Mixed
  audience including children still falls under the Families policy. See the
  [multiplayer + Families risk](#risk-strangers-interacting-in-a-families-app) before
  locking this in.
- [ ] **Personal or organisation developer account.** The old account is closed, so
  this choice is open again, and it decides the timeline:
  - *Personal*: quick to create (government ID check), but a new personal account must
    run the 12-tester / 14-day closed test before production. Your legal name is shown
    on the listing.
  - *Organisation*: needs a registered business, a D-U-N-S number (free, but can take
    days to weeks to issue) and a business website. No closed-test requirement, and the
    listing shows the business name rather than yours.
- [ ] **Where the privacy policy and support page live.** Must be reachable 24/7 —
  **not** on the weekly-destroyed AWS stack. Options: GitHub Pages, an S3/CloudFront
  bucket that survives `terraform destroy`, or the emoji-app domain.
- [ ] **Version scheme.** Use one version for web bundle + app (`expo.version` =
  `versionName`); `versionCode` stays EAS-managed via `autoIncrement` +
  `appVersionSource: remote`.

## Phase 1 — Play Console & accounts

- [ ] **Create a new developer account** at
  [play.google.com/console/signup](https://play.google.com/console/signup). The old
  account (closed 23 Dec 2021 for inactivity) can't be reactivated.
  - One-time US$25 registration fee.
  - Identity verification (government ID; D-U-N-S for an organisation), plus
    verified contact email and phone. Google may also ask you to verify a physical
    Android device through the Play Console app.
  - Check at signup whether Google lets the same Google account register again after a
    closure. If not, use a dedicated Google account for publishing (a good idea anyway,
    with 2-step verification turned on).
  - Read the email Google sent about the 2021 closure, in case it says anything that
    affects re-registering.
  - Keep the account active once created (sign in and publish regularly), so it isn't
    closed for inactivity again.
- [ ] If personal: the 12-tester / 14-day closed test (Phase 4) applies. Create the
  account early so that time is spent in parallel with Phase 2.
- [ ] Create the app in Play Console: default language English (en-US), type **Game**,
  category *Casual* or *Strategy*, Free.
- [ ] Enrol in **Play App Signing** (mandatory for new apps). EAS's generated keystore
  becomes the *upload key*; Google holds the app signing key.
  - Back up the upload keystore (`eas credentials` → download) to a password manager.
    Losing it is recoverable via Play support but slow.
- [ ] Create a **Google Cloud service account** with Play Console release permissions and
  store its JSON key **outside the repo** (EAS secret / local path in `.gitignore`) for
  `eas submit`.
- [ ] Recruit **≥12 closed testers** (Google group or email list) — friends/family with
  Android devices, ideally including at least one in Korea for the later multiplayer
  latency test.

## Phase 2 — App store-readiness

### 2.1 Build target & technical requirements

- [ ] **Target API level.** Play requires new apps and updates to target a recent API
  level (each August the bar moves up one; currently Android 16 / API 36). Confirm what
  SDK 57 targets: `npx expo prebuild --platform android --no-install` in a scratch copy,
  or read `targetSdkVersion` from an EAS build log. Override with `expo-build-properties`
  only if needed.
- [ ] **16 KB page-size support** (required for apps targeting Android 15+). RN 0.86 /
  SDK 57 native libs should already comply — verify with the Play Console bundle
  explorer warning after the first internal upload.
- [ ] **AAB, not APK.** EAS `production` builds AAB by default; keep `preview` as APK for
  sideloading.
- [ ] **Permissions audit.** Inspect the merged manifest from an EAS build. Expected:
  `INTERNET` only (plus `ACCESS_NETWORK_STATE` once multiplayer needs connectivity
  checks). Block anything else via `android.blockedPermissions` in `app.json`
  (e.g. `SYSTEM_ALERT_WINDOW`, `READ/WRITE_EXTERNAL_STORAGE`, `RECORD_AUDIO` if any
  library pulls them in). Fewer permissions = simpler Families review and Data safety.
- [ ] **No advertising ID.** Ensure `com.google.android.gms.permission.AD_ID` is not in
  the manifest (block it explicitly) and answer "No" to the Advertising ID declaration.

### 2.2 App config (`app.json` / `eas.json`)

- [ ] `icon` (1024×1024), `android.adaptiveIcon` (foreground + background colour
  `#020617`), `splash` / `expo-splash-screen` config — create `apps/land-grab-mobile/assets/`.
- [ ] `expo.version` aligned with the web bundle.
- [ ] `eas.json`: add `submit.production.android` (`serviceAccountKeyPath`,
  `track: "internal"`, `releaseStatus: "draft"` for the first run) and set
  `EXPO_PUBLIC_LAND_GRAB_SERVER_URL` per build profile via `env` (empty for v1).
- [ ] `orientation: landscape` is set — make sure store screenshots match.

### 2.3 WebView hardening (Families: no external links, no surprises)

Current `App.tsx` uses `originWhitelist={["*"]}`.

- [ ] Add `onShouldStartLoadWithRequest` that allows only the bundled origin
  (`https://land-grab.local/`) and, later, the game server origin. Block everything
  else; do **not** open external URLs in the system browser.
- [ ] `setSupportMultipleWindows={false}`, no `allowFileAccess`, no
  `allowUniversalAccessFromFileURLs`, `mixedContentMode="never"`.
- [ ] Disable WebView debugging in production builds
  (`webviewDebuggingEnabled={__DEV__}`).
- [ ] **Android back button**: handle `BackHandler` so it navigates within the game
  (or asks to quit) instead of instantly closing the app mid-match.
- [ ] Persistence check: `localStorage` (profile, game records) survives app restarts in
  the WebView with `domStorageEnabled` — verify, since Data safety answers depend on
  "stored on device only".

### 2.4 Content & policy fit

- [ ] Remove anything that links out (credits, GitHub, feedback forms) or move it behind
  a parental gate if it must stay.
- [ ] Confirm no third-party SDKs beyond Expo/RN core. Any SDK added later (crash
  reporting, analytics) must be on Google's **Families Self-Certified SDK** list.
- [ ] Profile name + 8×8 avatar are local-only in v1 → not UGC visible to others yet.

### 2.5 Store listing assets

Full asset list, specs and shot list: [`../assets/playstore.md`](../assets/playstore.md).

- [ ] App icon 512×512 PNG (32-bit, ≤1 MB).
- [ ] Feature graphic 1024×500.
- [ ] Phone screenshots (min 2, landscape, 16:9) — gameplay, profile/avatar editor,
  game over. Add 7" and 10" tablet screenshots to be eligible for tablet surfaces.
- [ ] Short description (≤80 chars) and full description (≤4000 chars).
- [ ] **Korean listing translation** (matches the English + Korean audience; separate
  from in-app i18n, which stays website-chrome only).
- [ ] Optional: short gameplay video (YouTube, unlisted, no ads on it).

### 2.6 Policy pages (hosted outside the destroyable stack)

- [ ] **Privacy policy** — must cover, even for v1: what is stored on device
  (`localStorage` profile, records), that nothing is sent to a server in single-player,
  children's data handling (COPPA / GDPR-K / Korean PIPA as applicable), contact email.
  Write it forward-compatible: describe the multiplayer data flow
  (display name, avatar, IP in server logs, retention) as a section that becomes active
  with the multiplayer release.
- [ ] Support/contact page and support email.
- [ ] **Terms / community rules** page — not strictly needed for v1, but required for
  multiplayer UGC (see Phase 6), so write it now.

## Phase 3 — Production build & signing

```bash
npm run sync:land-grab-mobile      # rebuild + inline the web bundle
npm run typecheck:land-grab
npm run test:land-grab && npm run test:land-grab-web
cd apps/land-grab-mobile
eas build --platform android --profile production
eas submit --platform android --profile production   # → internal track, draft
```

- [ ] The first AAB upload may need to be manual in Play Console (Google requires one
  manual upload before the API can publish for a new app).
- [ ] Commit the regenerated `landGrabHtml.ts` with the version bump so the store build
  is reproducible from git.
- [ ] Tag the release (e.g. `land-grab-android-v0.2.0`).

## Phase 4 — Play Console declarations & testing tracks

### 4.1 App content declarations (Policy → App content)

| Declaration | v1 single-player answer | Changes with multiplayer? |
| --- | --- | --- |
| Privacy policy URL | Hosted URL | Content updates |
| App access | All functionality available without login | Note when online mode is only available on tournament days |
| Ads | No ads | No |
| Content rating (IARC) | Cartoon/abstract competitive play; **no** user interaction | **Yes** — "Users can interact" becomes yes; re-submit questionnaire |
| Target audience & content | Age bands from Phase 0 → Families policy applies | Re-review risk, see below |
| Data safety | No data collected or shared (device-only storage) | **Yes** — see Phase 6 |
| Government / financial / health / news | N/A | No |
| Advertising ID | Not used | No |

### 4.2 Testing tracks

1. **Internal testing** (up to 100 testers, minutes to roll out): smoke test the AAB on
   several devices — low-end Android, tablet, Android 10 and latest. Check landscape,
   notches/safe area, back button, offline launch in airplane mode, app resume.
2. **Pre-launch report** (automatic on upload): fix crashes, accessibility and
   security warnings it flags.
3. **Closed testing** with the ≥12 recruited testers for **14 continuous days**. Collect
   feedback; ship fixes as new builds on the same track (the clock doesn't reset).
4. Apply for **production access** in Play Console — answers questions about the test
   (how testers were recruited, feedback received, changes made). Keep notes during the
   test to answer these well.

## Phase 5 — Production release v1 (single player)

- [ ] Countries: start with Australia + South Korea + US/UK/NZ/CA, expand later. (Check
  Korea-specific requirements for games — Play handles GRAC rating via IARC.)
- [ ] Staged rollout (e.g. 20% → 50% → 100%) while watching Android vitals
  (ANR/crash rate).
- [ ] Families review typically takes longer than a normal review — budget a week+.
- [ ] Post-launch: respond to reviews, watch vitals, keep target API current every August.

---

## Phase 6 — Multiplayer release considerations

The multiplayer update (overall-plan phases 1–2) changes the app from "offline game"
to "game with strangers over the network". That affects the app, the backend contract
and the store declarations.

### Delivery model: bundled vs hosted

The overall plan says the Expo app wraps the *deployed* web client. The current app
instead **bundles** the web build and only reaches out to `gameServerUrl`. Recommendation:
**keep bundling**, because:

- The app must work while AWS is torn down most of the week — a hosted client would be
  a blank screen on non-tournament days, which Play reviewers treat as broken
  functionality.
- Play policy allows JS executed inside a WebView to change, but a bundled client means
  every behavioural change goes through store review, which keeps Families review
  predictable.

Consequence: **installed clients lag behind the server.** Plan for it:

- [ ] **Protocol version handshake** on WebSocket connect (`clientVersion`,
  `protocolVersion`). Server rejects incompatible clients with a clear "Update LandGrab
  to join online matches" message; offline practice keeps working.
- [ ] Ship the **Play In-App Updates** prompt (flexible update) or at least a deep link
  to the store listing from the "please update" screen (the store is not an "external
  link" in the Families sense, but keep it behind the update flow only).
- [ ] Optional later: `expo-updates` (EAS Update) to push web-bundle fixes without a
  store release. Decide deliberately — it's convenient but means the reviewed build is
  not what users run.

### Backend availability with weekly `terraform destroy`

- [ ] **Stable hostname** for the game server: the Route 53 zone + ACM cert survive
  destroy (per overall plan), so the baked-in `EXPO_PUBLIC_LAND_GRAB_SERVER_URL` stays
  valid across cycles. Never bake an ALB DNS name.
- [ ] **`wss://` only.** Android blocks cleartext by default; don't add a
  `usesCleartextTraffic` exception.
- [ ] **"Is it tournament time?" without the server.** When the stack is destroyed, the
  app needs the next match time from somewhere that survives: a small static JSON
  (`/schedule.json`) on the same always-on host as the privacy policy. App shows
  "Next online match: Sat 19:00 KST — practise now" instead of a connection error.
- [ ] Health check before switching UI into lobby mode; graceful fallback to practice
  on timeout or mid-match disconnect (no crash, no spinner forever).
- [ ] **App review access:** reviewers may test on any day. The App access declaration
  and review notes must explain that online play is scheduled and that offline practice
  is the full always-available experience. Consider a permanently-on minimal
  "review/demo" room only if a rejection forces it — it conflicts with the cost model.
- [ ] Add `ACCESS_NETWORK_STATE` only if connectivity detection needs it.

### Declarations that change

- [ ] **Content rating**: re-take IARC — "Users can interact: Yes" (names + avatars
  visible, no chat). Expect the rating text to gain "Users Interact".
- [ ] **Data safety** — new answers:
  - Personal info → *Name* (display name): collected, shared with other players in the
    match, not stored after the match, required for online play, optional overall
    (practice works without it).
  - *Photos/other user-generated content* → 8×8 avatar: same treatment.
  - App activity / device identifiers: IP addresses in ALB/CloudWatch logs — declare
    if logs retain them; set and state a short log retention (e.g. 7–14 days).
  - Data encrypted in transit: Yes (`wss`).
  - Data deletion: no accounts, so the account-deletion requirement doesn't apply;
    state that match data isn't retained.
- [ ] **Privacy policy**: activate the multiplayer section; list AWS as processor and
  the `ap-southeast-2` region (cross-border transfer note for Korean/EU players).
- [ ] **Target audience**: unchanged ages, but expect a fresh Families review.

### UGC policy requirements (names + avatars seen by strangers)

Play's user-generated-content policy expects, for apps where users see each other's
content:

- [ ] Users **accept terms/community rules** before their name/avatar is shown online
  (one-time checkbox on first entering the online lobby; store acceptance in
  `localStorage`).
- [ ] **Server-side name filter** with fallback names (`Player482`) — already in the
  overall plan's phase 1.
- [ ] **In-app report** of another player, with the per-match threshold auto-kick from
  the overall plan.
- [ ] **Block/mute**: let a player hide another player's name/avatar for the rest of
  the session.
- [ ] Keep **no free-text chat** as a hard constraint — it's what keeps automated-only
  moderation defensible for a Families listing.

### Risk: strangers interacting in a Families app

This is the main policy risk of the whole plan. The Families policy is strict about
children interacting with unknown users. Mitigations already in the design (no chat,
filtered names, 8×8 avatars, ephemeral data, report/kick) are strong, but before the
multiplayer release:

- [ ] Re-read the current Families policy and UGC policy text for social/interaction
  features and record the specific clauses we comply with in this doc.
- [ ] Consider a **"play online" parental/age gate** (e.g. a simple neutral age screen
  or adult confirmation) before online mode is enabled for under-13 users.
- [ ] Fallback options if review pushes back: (a) online mode with *auto-generated
  names and preset avatars only* for under-13s, or (b) narrowing target audience to
  13+ (drops the Families listing — a reversal of an overall-plan decision, so only as a
  last resort).

### Multiplayer release checklist

- [ ] Server: version handshake, name filter, report/kick, session tokens live.
- [ ] Schedule JSON hosted on always-on host.
- [ ] Terms/community rules page live; in-app acceptance flow.
- [ ] IARC re-rated, Data safety updated, privacy policy updated — **submitted before
  or with** the multiplayer build, not after.
- [ ] Closed-test the multiplayer build during a real warm-up window (stack applied),
  including a Korea-based tester.
- [ ] Staged rollout timed so the first public online session is a tournament the team
  is watching.

## Open questions

0. New developer account: personal (closed test required) or organisation (D-U-N-S
   needed, no closed test)?
1. Keep `com.emojiapp.landgrab`, or rename before the first upload?
2. Exact target age bands — and do we accept the Families review risk for multiplayer
   at launch, or launch online mode with preset names/avatars for younger players?
3. Always-on host for privacy policy, terms, support page and `schedule.json` — GitHub
   Pages, or an S3/CloudFront bucket excluded from `terraform destroy`?
4. Is EAS Update (OTA JS) acceptable for this app, or is every change a store release?
5. Who are the 12+ closed testers, and when does the 14-day clock start?
