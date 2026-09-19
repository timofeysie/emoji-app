# Motion integration

The emoji app uses [Motion for React](https://motion.dev/docs/react), formerly
known as Framer Motion, to make live game-state changes easier to follow.
Animations are presentational only: API requests, WebSocket events, polling,
and persisted game state remain the source of truth.

React components import its APIs from `motion/react`:

```tsx
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
```

The dependency is declared in `package.json`. Do not install the deprecated
`framer-motion` package alongside it.

## Animation principles

- Use spring transitions for movement between meaningful game states.
- Keep animation state derived from existing React and server state.
- Use stable keys and `layoutId` values so Motion can associate elements
  between renders.
- Avoid continuous decorative animation on live dashboards.
- Keep interactive controls usable while animations are running.
- Use `pointer-events-none` and `aria-hidden` on decorative focus rings.

## Badge registration

`client/src/app/views/BadgesView.tsx` animates Zero-Pico pair registration.

The badge grid uses `LayoutGroup` and `AnimatePresence` with
`mode="popLayout"`. Each badge card is a `motion.div` with the `layout` prop,
allowing existing cards to reposition smoothly when another pair appears.

New cards:

- Appear as a small tile, spin once while expanding, then settle upright at full
  size.
- Use a slight scale overshoot to soften the final expansion.
- Receive a short primary-color ring and shadow.
- Skip the initial stagger when added through a live update.

The first badge snapshot is treated as baseline data. Existing badges animate
into the initial grid but are not marked as newly registered. A key first seen
after snapshot hydration receives the temporary registration highlight.

BLE state icons and primary badge visuals use `AnimatePresence` with
`mode="wait"` to crossfade status changes instead of swapping abruptly.

## Referee pair chips

`client/src/app/views/components/GameRefereePanel.tsx` animates bound-pair
chips.

- Newly bound pairs spring into the list.
- Removed pairs fade and scale out.
- Layout changes reposition the remaining chips.
- The waiting and ready states crossfade.
- The ready check icon springs into place when a controller joins.

These animations do not change pair binding or game lifecycle API calls.

## Live status text reveal

`client/src/app/shared/text-reveal.tsx` adapts Motion's
[text reveal example](https://motion.dev/examples/react-text-reveal) for
state-driven updates. The previous value collapses and fades while the new
value reveals from zero width using a spring transition.

The effect is used for:

- Badge dashboard game-state labels.
- Referee pair chips when a player joins or changes between awaiting, ready,
  and wait.
- Player-view pair chips between rounds.

The reveal key must represent the displayed state, not a timestamp, so polling
the same value does not replay the animation. The component uses an ARIA live
region so the changed status remains available to assistive technology.

## Game-stage focus ring

`client/src/app/views/GameDetailView.tsx` uses a shared focus ring to guide the
referee through the game flow.

The ring has the stable layout identifier `game-stage-focus-ring`. Only one
instance is rendered at a time. When game state changes, Motion treats the new
instance as the same visual element and animates it between containers.

The current mapping is:

- `ready` and `lobby`: Referee Controls
- `active` and `paused`: Rounds
- `completed`: Result
- `cancelled`: no stage highlight

Entering the lobby also applies a short `x`, `y`, and `rotate` spring to the
Referee Controls panel. This follows the state-driven animation pattern from
the Motion
[animate state example](https://motion.dev/examples/react-state-updates).

Game refreshes triggered by lifecycle actions use a silent refresh. Keeping
the page mounted is important because unmounting both focus-ring instances
would prevent the shared-layout transition.

## Next-round focus ring

Round cards use a second shared layout identifier,
`next-question-focus-ring`. It is intentionally amber and solid so it is
visually distinct from the dotted primary game-stage ring.

While a game is active, the highlighted card is selected in this order:

1. The currently open round.
2. The first draft round by sequence.
3. No round when all rounds are closed.

Closing the current round updates server state. After the questions refresh,
the amber ring moves to the next draft round. Internal API and model names
continue to use `question`; the interface presents these records as rounds.

## Student round transition

`client/src/app/views/GamePlayView.tsx` replaces a completed round with its tag
scan results while waiting for the referee. When the next round opens,
`AnimatePresence` moves the result panel away before the new question expands
and rotates into place. Answer options then enter with a short stagger.

## Adding motion

When adding another animated state:

1. Derive the target from existing application state.
2. Wrap related elements in a scoped `LayoutGroup`.
3. Use `layout` for size and position changes.
4. Use one stable `layoutId` for a visual element that moves between
   containers.
5. Use `AnimatePresence` only when an element needs an exit animation.
6. Keep decorative animation separate from API and WebSocket logic.

Prefer shared constants for spring configuration when multiple elements should
feel related.

## Verification

Run the client locally:

```bash
npm run dev
```

Check the following flows:

1. Open `/badges` and register a new Zero-Pico pair.
2. Bind and join a pair in Referee Controls.
3. Select **Open for Joining** and confirm the stage ring is on Referee
   Controls.
4. Select **Start Game** and confirm the ring moves to Rounds.
5. Open and close rounds and confirm the amber ring advances.
6. Select **End Game** and confirm the stage ring moves to Result.
7. Select **Play Again** and confirm the stage ring returns to Referee
   Controls.
8. Open student mode, close a round, and confirm its tag results remain visible
   until the next round animates in.

Run static checks after changing animation code:

```bash
npm run typecheck
npm run lint
```
