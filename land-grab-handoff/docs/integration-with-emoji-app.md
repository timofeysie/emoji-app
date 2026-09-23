# Integrating LandGrab with emoji-app

## Question

Can this repository add a top-level `hybrid/` directory for the Expo app, even
though the repository currently has one root `package.json` for `client/` and
`server/`? Would a separate repository be safer?

## Short answer

Yes, an Expo app can live in this repository. It should have its own
`package.json`, Expo configuration, TypeScript configuration, and build
commands. Having more than one `package.json` in a repository is normal.

The recommended approach is to keep LandGrab in this repository and turn the
repository into a small npm-workspaces monorepo. Do not put Expo dependencies
into the existing root dependency list.

`hybrid/` would work as a directory name, but `land-grab-mobile/` or
`apps/land-grab-mobile/` communicates its purpose more clearly. The Expo app is
only the native shell. The current Phaser game is a separate web bundle loaded
by an Expo `WebView`.

## What exists today

The repository is monorepo-shaped but is not currently configured as a package
workspace:

- The root `package.json` owns dependencies for both `client/` and `server/`.
- Root scripts pass explicit configuration paths to Vite and TypeScript.
- Neither `client/` nor `server/` has its own `package.json`.
- There is one root lockfile and one root `node_modules/`.
- The `land-grab-handoff/src/` directory is source material, not a runnable
  project. It has no package manifest or build configuration in this
  repository.
- The handed-off UI imports React, Phaser, Lucide, React Router, Vitest, and UI
  components from its original application. Some of those dependencies and
  components are not present in the handoff.

Consequently, copying the handoff into an Expo source directory will not make
it run. Phaser renders through browser canvas and DOM APIs. React Native does
not provide those APIs.

## Two applications are required

The architecture selected in
[`overall-plan.md`](./overall-plan.md) requires two client artifacts:

1. A web game built with React, Vite, and Phaser.
2. An Expo React Native app that displays that web game in a `WebView` and
   provides any native shell behavior.

The Expo app must not directly import `LandGrabDemo.tsx` or Phaser. It loads
the output of the web build.

A third artifact can be introduced when networking starts:

1. A framework-independent package containing simulation rules and shared
   network message types.

That shared package can be consumed by the browser game and the Node server.
It should not depend on Phaser, React, browser storage, or React Native.

## Important offline issue

The current overall plan says both of the following:

- The Node backend serves the web game.
- The Expo app offers local practice while the backend is destroyed.

Those statements are incompatible if the `WebView` only opens the backend URL.
When ECS and its load balancer are destroyed, neither the API nor the web game
is available.

One of these delivery models is needed:

- **Bundle the web build with the Expo app.** Load packaged HTML and assets in
  the `WebView` for practice, and let that web code connect to the game server
  when it is available. This best matches the "always on" requirement, but
  packaging Vite output and resolving local assets in iOS and Android requires
  dedicated build work.
- **Host the web build independently.** Put the static game on an always-on
  host such as S3 and CloudFront, while destroying only the game server. This
  simplifies the `WebView`, but it is not fully offline and adds a small
  permanent hosting surface.
- **Accept no practice while offline.** Point the `WebView` at the Node server
  and show a native unavailable screen while the stack is down. This is the
  simplest first prototype, but it does not satisfy the stated final behavior.

Bundling the web build is the best match for the chosen product behavior.
During initial development, the Expo `WebView` can point at the Vite
development server. The packaged-web-build step can follow after the handoff
runs successfully in a browser.

## Repository options

### Option 1: Add Expo dependencies to the root package

This would preserve the single-package setup. Root scripts could build
`client/`, `server/`, and `hybrid/`.

This is not recommended. Expo controls a set of compatible React Native and
native package versions. The existing web app uses its own React and bundler
versions. Combining all of them in one package increases the chance of peer
dependency conflicts, makes upgrades affect unrelated applications, and gives
every installation all dependencies.

### Option 2: Add independent nested packages without workspaces

The Expo and web game directories could each have a `package.json` and their
own lockfile and `node_modules`.

This works, but contributors must run installs in several directories. Shared
packages are awkward, dependency versions can drift, and root scripts must
manually enter each project. It is acceptable for a short experiment but not a
good target structure.

### Option 3: Use npm workspaces in this repository

The root remains private and declares the new applications and shared packages
as workspaces. Each new application owns its direct dependencies. npm keeps
one root lockfile and can link local shared packages.

Benefits include:

- One clone, install, lockfile, and pull request for coordinated changes.
- Clear dependency boundaries between Expo, Phaser, and the existing app.
- Easy sharing of pure simulation and protocol code with the server.
- Independent scripts and builds for each application.
- No need to move the existing `client/` and `server/` immediately.

This is the recommended option.

### Option 4: Use a separate repository

A separate repository gives LandGrab fully independent dependencies, CI,
versioning, permissions, and release history.

It also makes coordinated changes to WebSocket contracts, server behavior, and
infrastructure span repositories. Shared simulation code would need to be
published, copied, or consumed through a Git dependency.

A separate repository is justified if LandGrab will have a different owner,
access policy, deployment lifecycle, or long-term product identity. The current
plan emphasizes reuse of this server and its infrastructure, so those benefits
do not yet outweigh the coordination cost.

## Recommended structure

Use descriptive application names and leave the existing projects in place:

```text
/
├── client/                     Existing emoji-app browser client
├── server/                     Existing API and future game server
├── apps/
│   ├── land-grab-web/          React, Vite, and Phaser game
│   └── land-grab-mobile/       Expo app and WebView shell
├── packages/
│   ├── land-grab-core/         Pure simulation and bot logic
│   └── land-grab-protocol/     WebSocket messages, added later
├── land-grab-handoff/          Temporary migration source and notes
├── package.json
└── package-lock.json
```

It is also reasonable to start with a top-level `hybrid/` and rename it later.
The `apps/` layout is preferable because it prevents "hybrid" from becoming a
mixture of the Expo shell, browser game, shared rules, and server code.

The existing `client/` and `server/` do not need to become workspaces in the
first change. The root can continue to own their current dependencies and
scripts while only the new LandGrab projects are workspace packages. A later
cleanup can give every application its own manifest if that provides enough
value.

## Workspace implications

The root manifest would eventually declare entries similar to:

```json
{
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
```

Each application then declares only what it imports. For example,
`land-grab-web` owns Phaser and its web UI dependencies, while
`land-grab-mobile` owns Expo, React Native, and `react-native-webview`.

Important operational effects are:

- Run `npm install` at the repository root.
- Commit the root `package-lock.json`.
- Use workspace-qualified root scripts for development, tests, and builds.
- Keep Expo's required dependency versions aligned with the selected Expo SDK.
- Ensure Docker and CI install only what their builds require, or deliberately
  install all workspaces.
- Give each application its own `tsconfig.json`; do not force browser, Node,
  and React Native source through one TypeScript program.

Workspaces do not combine the applications into one runtime bundle. They are a
dependency-management and task-running mechanism.

## Suggested first migration

1. Create `apps/land-grab-web` as a minimal Vite React application with its own
   package manifest.
2. Move the handoff files into it without redesigning the game.
3. Replace or copy the missing original UI components and routing dependencies
   until the existing local game and tests run.
4. Create `apps/land-grab-mobile` with the Expo tooling and
   `react-native-webview`.
5. During development, load the LAN URL of `land-grab-web` in the `WebView`.
   Android emulators, iOS simulators, and physical devices use different host
   addresses, so make the URL an environment setting.
6. Decide and prove the packaged-web-build approach before relying on offline
   practice.
7. Extract only the DOM-free simulation modules into
   `packages/land-grab-core` when the Node server needs them.
8. Add WebSocket protocol types as a separate package when the protocol takes
   shape.
9. Remove the `land-grab-handoff/src` directory after its code, tests, and
   useful history have been migrated and verified.

## Decision

Keep LandGrab in the emoji-app repository for now and use npm workspaces.
Create separate web and Expo applications rather than treating `hybrid/` as a
single home for all LandGrab code. Revisit a separate repository only if
ownership or release independence becomes more important than sharing server,
protocol, simulation, and infrastructure changes.

## Implemented layout

The migration uses the workspace design above:

- `packages/land-grab-core` contains simulation, bots, scoring, replay data,
  avatars, record building, and their pure Vitest tests.
- `apps/land-grab-web` contains React, Phaser, browser persistence, profile and
  records UI, touch steering, and browser-storage tests.
- `apps/land-grab-mobile` contains only the Expo and WebView native shell.

Core exports TypeScript source through the workspace package export. It has no
React, Phaser, DOM, React Native, or browser-storage dependency. Record
construction is core logic. Record and profile persistence remain in the web
application.

The web application uses local dialog and tab components instead of the
original application's Radix and shadcn components. Tailwind is retained to
preserve the handed-off utility-class layout. Phaser remains entirely inside
the web application.

## Offline mobile bundle

The Vite build uses `vite-plugin-singlefile`. JavaScript, CSS, and other web
assets are inlined into `dist/index.html`. The synchronization script reads
that file and generates:

```text
apps/land-grab-mobile/src/generated/landGrabHtml.ts
```

The mobile app imports that TypeScript module and passes its HTML to the
WebView. Local practice therefore does not require a server or network
request.

Run this whenever web code changes:

```bash
npm run sync:land-grab-mobile
```

The generated module is checked in. A safe placeholder is also valid before
the first synchronization, so mobile type checking does not depend on a prior
web build.

## Server configuration bridge

For a web development build, create
`apps/land-grab-web/.env.local` containing:

```dotenv
VITE_LAND_GRAB_SERVER_URL=https://game.example.com
```

For Expo, create `apps/land-grab-mobile/.env.local` containing:

```dotenv
EXPO_PUBLIC_LAND_GRAB_SERVER_URL=https://game.example.com
```

The native shell injects `window.__LAND_GRAB_CONFIG__.gameServerUrl` before
the page loads. The web app also reads `VITE_LAND_GRAB_SERVER_URL`. No network
transport is implemented yet. With no URL, the page enters offline-practice
mode.

## Commands

Install all repository and workspace dependencies with one root lockfile:

```bash
npm install
```

Develop the standalone web game:

```bash
npm run dev:land-grab-web
```

Run core and browser-storage tests:

```bash
npm run test:land-grab
npm run test:land-grab-web
```

Type-check all three LandGrab workspaces:

```bash
npm run typecheck:land-grab
```

Build the single-file web game and refresh the native embedded copy:

```bash
npm run build:land-grab-web
npm run sync:land-grab-mobile
```

Start or export the Expo application:

```bash
npm run dev:land-grab-mobile
npm run export:land-grab-mobile
```

Expo SDK 57 uses the package versions from the current
`create-expo-app` TypeScript template. `react-native-webview` is the only
additional native runtime dependency.

## Current online-mode boundary

The configuration value is intentionally only a bridge. Local bots-only play
is complete and offline. Human-versus-human networking, WebSocket protocol
types, authentication, matchmaking, and server authority remain future work.
