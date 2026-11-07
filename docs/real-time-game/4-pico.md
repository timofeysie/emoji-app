# Step 4 — Pico badge game commands

Status: implemented in `emoji-os-pico.py` v0.4.0

This document covers all changes needed to the Pico badge script
(`emoji-os-pico.py`) to participate in the real-time game flow. After this
step, the Pico responds to `GAME:*` lifecycle commands from the Zero, shows
game state on its 8×8 matrix, and sends `TAG:<cardUid>` BLE notifications when
an NFC card is scanned during an open question.

---

## What is already done

| Feature | Status |
| --- | --- |
| `PAIR_OK:<VERSION>` handshake reply | ✅ done (v0.3.3) |
| NFC polling in legacy NFC mode (`nfc_mode_active`) | ✅ done |
| `NFC:<card_id>` BLE notify to Zero | ✅ done (legacy path, keep) |
| `NFC_RESULT:<circle\|x>` display handler | ✅ done |

Step 4 adds the game-mode layer on top without removing any existing behaviour.

---

## Current version

`VERSION = "0.3.3"` → bump to **`"0.4.0"`** (significant new feature: game
command handling).

---

## New Pico game state

The Pico does not connect to the server directly; it learns about game state
purely from BLE commands sent by the Zero. Add a small state variable that
tracks which game phase the Pico is currently in:

```python
# === Game state (driven by GAME:* commands from the Zero) ===
# None    — no game in progress / idle
# "active"         — game started, no open question
# "question_open"  — NFC scanning active; TAG: notifies sent on read
# "question_close" — between questions
# "ended"          — game finished
_game_state = None
```

---

## New commands in `handle_command`

The current dispatcher in `handle_command` recognises emoji commands
(`MENU:POS:NEG`), `NFC_RESULT:*`, and a handful of legacy strings. Add a new
`GAME:*` branch **before** the legacy commands block:

```python
def handle_command(command_data):
    try:
        command = command_data.decode('utf-8').strip()
        print(f"✓ Received command: '{command}'")

        if ':' in command:
            parts = command.split(':', 1)
            prefix = parts[0]

            # --- NEW: game lifecycle commands ---
            if prefix == "GAME":
                _handle_game_command(parts[1] if len(parts) > 1 else "")
                return

            # NFC result from Zero (legacy)
            if command.startswith("NFC_RESULT:"):
                _handle_nfc_result(command[11:])
                return

            # Emoji command MENU:POS:NEG (three-part)
            try:
                p = command.split(':')
                if len(p) == 3:
                    handle_emoji_selection(int(p[0]), int(p[1]), int(p[2]))
                    return
            except ValueError:
                print(f"Invalid emoji command format: '{command}'")

        # ... legacy ON / OFF / STATUS / BLINK unchanged ...
```

> **Note on `split`**: change `command.split(':', 1)` for the GAME prefix check
> but keep the existing three-way split for emoji commands. The cleanest
> approach is to check `prefix == "GAME"` first, then fall through to the
> existing emoji parsing.

---

## `_handle_game_command`

```python
def _handle_game_command(subcommand: str):
    """Dispatch a GAME:<subcommand> received from the Zero."""
    global _game_state
    print(f"[GAME] command: {subcommand!r}")

    if subcommand == "active":
        _game_state = "active"
        _show_game_active()

    elif subcommand == "question_open":
        _game_state = "question_open"
        _show_question_open()

    elif subcommand == "question_close":
        _game_state = "question_close"
        _show_question_close()

    elif subcommand == "ended":
        _game_state = "ended"
        _show_game_ended()

    else:
        print(f"[GAME] unknown subcommand: {subcommand!r}")
```

---

## Display routines for game state

The Pico 8×8 matrix is the only output, so each game state gets a distinct
visual. Exact pixel art is finalised during implementation; the descriptions
below specify intent.

### `_show_game_active()`

Game has started but no question is open yet — show a steady **green centre
square** (similar to the "connected" indicator but green-filled, signalling
"live game, stand by"):

```python
def _show_game_active():
    """Solid green 4×4 centre: game is active, waiting for a question."""
    matrix.pixelsFill(matrix.black())
    matrix.drawRectangleFill(2, 2, 5, 5, matrix.green())
    matrix.pixelsShow()
```

### `_show_question_open()`

Reuse the existing `draw_question_mark()` — the '?' glyph already means
"waiting for a card scan" in the legacy NFC flow. This keeps the UX consistent:

```python
def _show_question_open():
    """Question mark: scan ready — waiting for NFC card."""
    draw_question_mark()
```

### `_show_question_close()`

Question has closed — dim indicator (small white centre dot) to signal "between
questions":

```python
def _show_question_close():
    """Small white dot: question closed, game still active."""
    matrix.pixelsFill(matrix.black())
    matrix.drawRectangleFill(3, 3, 4, 4, matrix.white())
    matrix.pixelsShow()
```

### `_show_game_ended()`

Scroll "DONE" across the matrix then go dark:

```python
def _show_game_ended():
    """Scroll 'DONE' then clear: game has ended."""
    _m = glowbit.matrix8x8(rateLimitCharactersPerSecond=0.7)
    _m.addTextScroll("DONE")
    while _m.scrollingText:
        _m.updateTextScroll()
        _m.pixelsShow()
    matrix.pixelsFill(matrix.black())
    matrix.pixelsShow()
```

---

## NFC scanning in game mode: `TAG:` notify

The existing NFC polling block fires when `nfc_mode_active` is True. Add a
parallel branch for game mode that sends `TAG:` instead of `NFC:`.

### New `_game_nfc_tag_until_ms` timer

To match the existing question-mark revert logic, track a display timer for
the game NFC path:

```python
_game_nfc_display_until_ms = 0   # monotonic ms; when elapsed, revert to question mark
```

### Updated NFC polling in the main loop

Replace the single `if nfc_mode_active` block with two sequential blocks:

```python
    # === Legacy NFC mode polling (Zero sends menu 3, neg 4) ===
    if nfc_mode_active and rfid is not None:
        # revert circle/cross to question mark after timer
        if nfc_display_state != "question" and \
                time.ticks_diff(time.ticks_ms(), nfc_display_until_ms) >= 0:
            nfc_display_state = "question"
            draw_question_mark()
        if nfc_display_state == "question":
            try:
                if rfid.tagPresent():
                    card_id = rfid.readID()
                    print('NFC (legacy) tag:', card_id)
                    if p.is_connected():
                        p.send(('NFC:' + card_id).encode())
            except Exception as _e:
                print('NFC poll error:', _e)

    # === Game mode NFC polling (GAME:question_open active) ===
    if _game_state == "question_open" and rfid is not None:
        # revert to question mark after display timer
        if _game_nfc_display_until_ms and \
                time.ticks_diff(time.ticks_ms(), _game_nfc_display_until_ms) >= 0:
            _game_nfc_display_until_ms = 0
            draw_question_mark()   # back to waiting
        # only send a new TAG while showing the question mark
        if _game_nfc_display_until_ms == 0:
            try:
                if rfid.tagPresent():
                    card_id = rfid.readID()
                    print('NFC (game) tag:', card_id)
                    if p.is_connected():
                        p.send(('TAG:' + card_id).encode())
                    # show a brief circle/green indicator then revert
                    matrix.pixelsFill(matrix.black())
                    matrix.drawCircle(3, 3, 3, matrix.green())
                    matrix.pixelsShow()
                    _game_nfc_display_until_ms = time.ticks_add(
                        time.ticks_ms(), NFC_PICO_RESULT_DISPLAY_S * 1000
                    )
            except Exception as _e:
                print('NFC game poll error:', _e)
```

The brief green circle after a game-mode scan gives the player visual feedback
that the tag was read. The Zero will respond with the guess result separately
(not currently routed back to the Pico — see open questions).

---

## Clean up `handle_emoji_selection` NFC condition

The Zero's game mode entry (menu 3 · pos 4) no longer sends a BLE command to
the Pico (the Zero handles game mode locally). Tighten the NFC activation
condition to match:

```python
# Old:
if menu_val == 3 and (pos_val == 4 or neg_val == 4):

# New (neg 4 only — pos 4 is game mode on the Zero, never sent to Pico):
if menu_val == 3 and neg_val == 4:
```

This is a clean-up only; because the Zero no longer sends `(3, 4, 0)` to the
Pico in game mode, this condition would never fire for `pos_val == 4` anyway.

---

## Startup log update

Update the print line at startup to reflect the new capabilities:

```python
print("NFC game mode: GAME:question_open activates TAG: notifies on NFC read")
```

---

## Files to change

| File | Change |
| --- | --- |
| `rainbow-connection/python/emoji-os/emoji-os-pico.py` | All changes above |

No server changes — the server already handles `TAG:` as a `cardUid` in
`submitGuess` / `nfc.tagged` (implemented in Step 1). No Zero changes — the
Zero's `_on_pico_tx_notify` already handles `TAG:` (implemented in Step 3).

---

## Version bump

```python
VERSION = "0.4.0"
```

The Zero reads this version from the `PAIR_OK:0.4.0` handshake reply and
includes it in `POST /api/status` as `picoVersion`. The dashboard can then
confirm the Pico is running the correct firmware via `GET /api/version`
(`expectedPicoVersion`).

---

## Acceptance criteria

- `GAME:active` received → Pico shows green centre square.
- `GAME:question_open` received → Pico shows question mark glyph.
- NFC tag scanned while `_game_state == "question_open"` → Pico sends
  `TAG:<cardUid>` via BLE notify → Zero logs `[NFC] relaying TAG ...` and
  POSTs to `/api/guesses` → dashboard shows `nfc.tagged` event.
- `GAME:question_close` received → Pico shows small white dot.
- `GAME:ended` received → Pico scrolls "DONE" then goes dark.
- `GAME:` commands do not interfere with legacy NFC mode or the emoji picker.
- `PAIR_OK:0.4.0` sent in handshake; dashboard reports `picoVersion: "0.4.0"`.
- Existing emoji commands (`MENU:POS:NEG`), `NFC_RESULT:*`, and legacy
  `ON/OFF/STATUS/BLINK` continue to work unchanged.
- NFC legacy mode (menu 3 · neg 4 from Zero) still sends `NFC:<card_id>` and
  still triggers the Zero's `_handle_nfc_card` display path.

---

## Open questions

- **Guess result feedback to Pico**: after the Zero POSTs the guess and the
  server responds, should the Zero send the result back to the Pico (e.g.
  `NFC_RESULT:circle` or a new `GUESS_RESULT:<ok|miss>`)? The current design
  leaves the Pico in the green-circle state for `NFC_PICO_RESULT_DISPLAY_S`
  seconds with no server confirmation. Decide whether to add a round-trip
  result write in a later step.
- **Multiple tags per question**: the current polling gate (`_game_nfc_display_until_ms
  == 0`) prevents re-sending the same physical card during the display hold
  period (~5 s). If a player needs to scan a second card before the timer
  resets, they must wait. Confirm whether this is acceptable or whether the
  gate should be lifted after the first `TAG:` is sent.
- **`_show_game_ended` local `_m` variable**: the function creates a new
  `glowbit.matrix8x8` instance to use `addTextScroll`. Verify that creating a
  second instance in MicroPython is harmless (it may share the underlying
  hardware object). Alternatively, scroll via the global `matrix` if it
  exposes the same method.
