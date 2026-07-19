# Step 3 — Zero controller WebSocket client

Status: implemented in `emoji-os-zero.py` v0.6.0

This document covers all changes needed to the Raspberry Pi Zero script
(`emoji-os-zero.py`) to participate in the real-time game flow. After this
step, the Zero connects to the server WebSocket, receives game lifecycle
events, drives the display and the Pico over BLE, and relays NFC tag reads
back to the server as guesses.

---

## Goal

The Zero currently communicates with the server exclusively via fire-and-forget
HTTP POSTs (`/api/status`, `/api/emoji`). It has no way to receive server
events, so it cannot respond to game state changes without polling. Step 3 adds
a persistent WebSocket client that runs alongside the existing BLE/asyncio loop
and closes the remaining gaps from the design doc:

- `controller.hello` / `controller.welcome` handshake
- Receive and act on `game.opened`, `game.started`, `game.ended`,
  `question.opened`, `question.closed`
- POST `/api/games/:gameId/join` when the player triggers a join
- Relay `TAG:<cardUid>` notifications from the Pico as `POST /api/guesses`
- HTTP fallback poll (`GET /api/pairs/:pairName`) when the WS is down
- Reconnect with exponential backoff

---

## Thread model

The Zero already runs an `asyncio` event loop on a daemon BLE thread
(`ble_event_loop`). The WebSocket client is an additional `asyncio` task
started in the same loop — no new threads are required.

```
main thread        — joystick/button loop (blocking `time.sleep`)
BLE daemon thread  — asyncio event loop
                       ├── BLE scan/connect (_initial_connect, _reconnect)
                       ├── _heartbeat_loop   (BLE keepalive + liveness POST)
                       └── _ws_connect_loop  (NEW — WebSocket client)
battery daemon     — INA219 poll every 60 s (unchanged)
API daemon threads — fire-and-forget HTTP POSTs (unchanged)
```

---

## New dependency

Install the `websockets` library on the Pi (the `requests` library is already
present):

```bash
pip3 install websockets
```

Add to any requirements file or install note for the Pi setup.

---

## New global state

```python
# === WebSocket / Game state ===
# Set to the SERVER_URL ws(s):// equivalent once the WS client starts.
# ws://... for HTTP server, wss://... for HTTPS server.
_WS_URL = ""          # derived from SERVER_URL at startup

# Current game snapshot (updated from controller.welcome and game events).
_ws_game_id       = None   # str | None
_ws_game_state    = None   # "draft"|"lobby"|"active"|"completed"|None
_ws_question_id   = None   # str | None (currently open question)
_ws_joined        = False  # True once join POST has been sent this session

# Set to True when a game.opened event arrives and the join prompt is shown.
# The main button loop polls this and issues the join POST on KEY1 press.
_join_pending     = False

# Set by _ws_connect_loop while the socket is open. Checked by the HTTP
# fallback poller to suppress redundant polling when WS is healthy.
_ws_connected     = False
```

---

## Deriving `_WS_URL` from `SERVER_URL`

Add at startup (after `SERVER_URL` is defined):

```python
if SERVER_URL.startswith("https://"):
    _WS_URL = "wss://" + SERVER_URL[len("https://"):]
elif SERVER_URL.startswith("http://"):
    _WS_URL = "ws://" + SERVER_URL[len("http://"):]
else:
    _WS_URL = ""
```

---

## WebSocket connect loop

A new coroutine runs in `ble_event_loop` as an `asyncio.Task`. It connects to
`<_WS_URL>/ws`, sends `controller.hello`, processes the `controller.welcome`
snapshot, then processes events until the socket closes. On any disconnect or
error it backs off and retries.

```python
_WS_BACKOFF_MIN_S = 2.0
_WS_BACKOFF_MAX_S = 60.0

async def _ws_connect_loop():
    global _ws_connected
    if not _WS_URL:
        print("[WS] _WS_URL is empty — WebSocket client disabled", flush=True)
        return
    backoff = _WS_BACKOFF_MIN_S
    while True:
        try:
            import websockets
            uri = f"{_WS_URL}/ws"
            print(f"[WS] connecting to {uri}", flush=True)
            async with websockets.connect(uri, ping_interval=None) as ws:
                _ws_connected = True
                backoff = _WS_BACKOFF_MIN_S          # reset on successful connect
                print("[WS] connected — sending controller.hello", flush=True)
                import json
                hello = {
                    "type": "controller.hello",
                    "pairName": PAIR_NAME,
                    "controllerId": CONTROLLER_ID,
                    "controllerVersion": _CONTROLLER_VERSION,
                    "picoVersion": _pico_version,
                    "token": None,
                }
                await ws.send(json.dumps(hello))
                async for raw in ws:
                    try:
                        event = json.loads(raw)
                    except Exception:
                        continue
                    await _ws_handle_event(event)
        except Exception as exc:
            print(f"[WS] disconnected: {exc!r}; retry in {backoff:.0f}s", flush=True)
        finally:
            _ws_connected = False
        await asyncio.sleep(backoff)
        backoff = min(backoff * 2, _WS_BACKOFF_MAX_S)
```

`ping_interval=None` disables the `websockets`-library client-side pings —
the server already sends pings every 30 s (Step 2) and the `websockets`
library responds to server pings with pongs automatically.

---

## Event handler

```python
async def _ws_handle_event(event: dict):
    global _ws_game_id, _ws_game_state, _ws_question_id, _ws_joined, _join_pending

    etype = event.get("type")
    print(f"[WS] event: {etype}", flush=True)

    if etype == "controller.welcome":
        _ws_game_id     = event.get("gameId")
        _ws_game_state  = event.get("state")
        _ws_question_id = event.get("openQuestionId")
        _ws_joined      = event.get("joined", False)
        print(f"[WS] welcome: game={_ws_game_id} state={_ws_game_state} joined={_ws_joined}", flush=True)
        _apply_game_state_to_display()

    elif etype == "game.opened":
        _ws_game_id    = event.get("gameId")
        _ws_game_state = "lobby"
        _ws_joined     = False
        _join_pending  = True
        print(f"[WS] game.opened: {_ws_game_id}", flush=True)
        # Display updates are drawn the next time draw_display() is called
        # (main loop or explicit call below).  Only redraw if in game mode.
        if game_mode_active:
            draw_display()

    elif etype == "game.started":
        _ws_game_state = "active"
        print("[WS] game.started — writing GAME:active to Pico", flush=True)
        if game_mode_active:
            draw_display()
        await _ble_write_game_cmd("GAME:active")

    elif etype == "question.opened":
        _ws_question_id = event.get("questionId")
        print(f"[WS] question.opened: {_ws_question_id}", flush=True)
        if game_mode_active:
            draw_display()
        await _ble_write_game_cmd("GAME:question_open")

    elif etype == "question.closed":
        _ws_question_id = None
        print("[WS] question.closed", flush=True)
        if game_mode_active:
            draw_display()
        await _ble_write_game_cmd("GAME:question_close")

    elif etype == "game.ended":
        _ws_game_state  = "completed"
        _ws_question_id = None
        print("[WS] game.ended", flush=True)
        if game_mode_active:
            draw_display()
        await _ble_write_game_cmd("GAME:ended")
```

---

## BLE write helper for game commands

```python
async def _ble_write_game_cmd(cmd: str):
    """Write a GAME:* command to the Pico over BLE. No-op if not connected."""
    if not (ble_controller.client and ble_controller.client.is_connected):
        print(f"[WS] BLE not connected — skipping {cmd}", flush=True)
        return
    try:
        await ble_controller.client.write_gatt_char(
            UART_RX_CHAR_UUID, cmd.encode("utf-8")
        )
        print(f"[BLE] wrote {cmd!r}", flush=True)
    except Exception as exc:
        print(f"[BLE] write {cmd!r} failed: {exc}", flush=True)
```

---

## Game mode — new emoji choice

### Concept

Rather than intercepting buttons globally, game mode follows the same pattern
as NFC mode: the player navigates to a specific menu slot, selects it, and the
Zero enters a dedicated mode that occupies the main display area. All
game-related interaction (join, observing state changes) happens inside that
mode. Navigation buttons exit it, exactly like NFC mode.

**Slot: menu 3 · pos 4 · neg 0**

This slot is currently shown as a question mark. It is repurposed as the "Game"
entry point. The question mark matrix in this slot is replaced with a **capital
`G` matrix** to signal "Game mode available". The NFC modes (menu 3 · neg 4 and
the legacy pos 4 → NFC positive path) are **not changed**.

> **Note:** The existing code in `start_emoji_animation` gates NFC mode on
> `menu == 3 and (pos == 4 or neg == 4)`. That condition must be tightened to
> `menu == 3 and neg == 4` (NFC negative only) so that `pos == 4` is free for
> game mode. The old "NFC positive" slot (pos 4) was already a question mark
> with no distinct NFC-positive behaviour in the current firmware — removing it
> from the NFC branch is safe.

### New global state

```python
# True while the player is in game mode (entered via menu 3, pos 4, neg 0).
game_mode_active = False
```

### `game_mode_matrix` — the 'G' glyph

Add a new 8×8 pixel-art matrix to `emojis_zero.py` (or inline at the top of
`emoji-os-zero.py`) that renders a white capital 'G' on a dark background.
Exact pixel values are a visual detail to finalise during implementation;
a rough 8×8 'G' shape:

```python
# Capital 'G' — white pixels on black background
game_mode_matrix = [
    [0, 1, 1, 1, 1, 1, 0, 0],
    [1, 0, 0, 0, 0, 0, 1, 0],
    [1, 0, 0, 0, 0, 0, 0, 0],
    [1, 0, 0, 1, 1, 1, 1, 0],
    [1, 0, 0, 0, 0, 0, 1, 0],
    [1, 0, 0, 0, 0, 0, 1, 0],
    [0, 1, 1, 1, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0],
]
```

The matrix uses the same single-colour convention as `others_circle_matrix`
(colour resolved via `color_map`).

### Changes to `get_left_side_emojis()`

Replace `question_mark_matrix` in the menu 3 row (index 3, i.e. pos 4) with
`game_mode_matrix`:

```python
elif menu == 3:
    return [others_circle_matrix, others_yes_matrix, others_somi_matrix, game_mode_matrix]
```

### Changes to `get_main_emoji()` and `get_main_emoji_animation()`

Game mode overrides the main emoji display, just like NFC mode does. Add the
check **above** the NFC mode check in `get_main_emoji()`:

```python
def get_main_emoji():
    # Game mode overrides the main emoji area.
    if game_mode_active:
        return game_mode_matrix   # 'G' glyph; text overlay shows live status

    # NFC mode overrides next.
    if nfc_mode_active:
        ...
```

Do the same in `get_main_emoji_animation()` so the wink animation does not
play while in game mode:

```python
def get_main_emoji_animation():
    if game_mode_active:
        return game_mode_matrix
    if nfc_mode_active:
        ...
```

### Changes to `start_emoji_animation()`

Add a game mode branch **before** the NFC mode branch, and tighten the NFC
condition to `neg == 4` only:

```python
def start_emoji_animation():
    global prev_state, prev_menu, prev_pos, prev_neg, menu, pos, neg, state
    global game_mode_active, nfc_mode_active, nfc_last_result, nfc_last_card_name

    # Game mode: menu 3, pos 4, neg 0
    if menu == 3 and pos == 4 and neg == 0:
        prev_state = "done"
        prev_menu  = menu
        prev_pos   = pos
        prev_neg   = neg
        game_mode_active = True
        print("[GAME] entering game mode", flush=True)
        send_emoji_to_pico(menu, pos, neg)  # optional — no Pico command defined yet
        state = "none"
        pos   = 0
        neg   = 0
        draw_display()
        return

    # NFC mode: menu 3, neg 4 only (pos 4 is now game mode above)
    if menu == 3 and neg == 4:
        prev_state = "done"
        prev_menu  = menu
        prev_pos   = pos
        prev_neg   = neg
        nfc_mode_active  = True
        nfc_last_result  = None
        nfc_last_card_name = ""
        print(f"[NFC] entering NFC mode (menu={menu} pos={pos} neg={neg})", flush=True)
        send_emoji_to_pico(menu, pos, neg)
        state = "none"
        pos   = 0
        neg   = 0
        draw_display()
        return

    # ... rest of existing animation logic unchanged ...
```

### Exiting game mode

`reset_prev()` is already called by the UP/DOWN/LEFT navigation handlers. Add
`game_mode_active = False` to `reset_prev()` alongside the existing NFC reset:

```python
def reset_prev():
    global prev_state, prev_menu, prev_pos, prev_neg
    global nfc_mode_active, nfc_last_result, nfc_last_card_name
    global game_mode_active                    # NEW
    prev_state = "none"
    prev_menu  = 0
    prev_pos   = 0
    prev_neg   = 0
    nfc_mode_active   = False
    nfc_last_result   = None
    nfc_last_card_name = ""
    game_mode_active  = False                  # NEW
```

---

## Game mode display

While `game_mode_active` is True, `get_main_emoji()` returns `game_mode_matrix`
('G' glyph). The status text is drawn in the same overlay band used by NFC
(`y ≈ 57`), giving a consistent layout:

| State | Main emoji | Status text (y≈57) | Text colour |
| --- | --- | --- | --- |
| `lobby`, not joined | 'G' glyph | `JOIN? KEY1` | yellow |
| `lobby`, joined | 'G' glyph | `WAITING...` | white |
| `active`, no open question | 'G' glyph | `GAME ON` | green |
| `active`, question open | 'G' glyph | `SCAN NOW` | amber |
| `completed` | 'G' glyph | `GAME OVER` | red |
| `None` / `draft` | 'G' glyph | *(empty)* | — |

Add to `draw_display()`, inside the existing
`if nfc_mode_active and nfc_last_card_name:` block, a parallel block:

```python
if game_mode_active:
    if _ws_game_state == "lobby" and not _ws_joined:
        draw_centered_text(draw, "JOIN? KEY1", 57, font, disp.width, "yellow")
    elif _ws_game_state == "lobby":
        draw_centered_text(draw, "WAITING...", 57, font, disp.width, "white")
    elif _ws_game_state == "active" and _ws_question_id:
        draw_centered_text(draw, "SCAN NOW",   57, font, disp.width, (255, 200, 0))
    elif _ws_game_state == "active":
        draw_centered_text(draw, "GAME ON",    57, font, disp.width, (0, 220, 0))
    elif _ws_game_state == "completed":
        draw_centered_text(draw, "GAME OVER",  57, font, disp.width, (200, 0, 0))
```

The `_apply_game_state_to_display()` helper (called on `controller.welcome`
after a WS reconnect) simply calls `draw_display()` — the status text is
redrawn from the globals automatically:

```python
def _apply_game_state_to_display():
    """Re-apply current game state to the display (e.g. after WS reconnect)."""
    if game_mode_active:
        draw_display()
```

---

## Join flow: KEY1 inside game mode

The join POST fires from the **KEY1** (positive) handler when
`game_mode_active` is True and a lobby is waiting. **KEY2** exits game
mode to menu select (it does not join). Re-entering game mode syncs the
current server snapshot to Zero + Pico via `_apply_game_state_to_display`.

```python
# === Handle KEY1 button (Positive) ===
if key1_pressed and not button_states['key1']:
    if game_mode_active:
        if _join_pending and _ws_game_id:
            _join_pending = False
            _ws_joined    = True
            post_to_server(
                f"/api/games/{_ws_game_id}/join",
                {"pairName": PAIR_NAME, "controllerId": CONTROLLER_ID},
            )
            draw_display()
            # … BLE GAME:lobby_joined …
        time.sleep(0.2)
        button_states['key1'] = key1_pressed
        continue
    # --- existing positive-selection logic continues unchanged ---
    ...
```

The display update is handled by `draw_display()` (which checks `_ws_joined`
in the game mode block) rather than a one-off text draw, so the status stays
consistent.

---

## NFC tag relay: `TAG:` → `POST /api/guesses`

The Pico currently sends `NFC:<card_id>`. Step 4 will change the Pico to send
`TAG:<cardUid>`. Add handling for the new prefix alongside the existing `NFC:`
handler in `_on_pico_tx_notify`:

```python
def _on_pico_tx_notify(_sender: BleakGATTCharacteristic, data: bytearray):
    try:
        text = bytes(data).decode("utf-8", "ignore").strip()
        print(f"[PICO→ZERO] {text!r}", flush=True)
        if text.startswith("TAG:"):
            # New game-mode path (Step 4 Pico firmware).
            card_uid = text[4:]
            _relay_nfc_tag(card_uid)
        elif text.startswith("NFC:"):
            # Legacy path — keep for backward compatibility.
            card_id = text[4:]
            _handle_nfc_card(card_id)
    except Exception as e:
        print(f"[BLE] error in TX notify handler: {e}", flush=True)


def _relay_nfc_tag(card_uid: str):
    """Relay a TAG:<cardUid> from the Pico as POST /api/guesses."""
    if not _ws_game_id or not _ws_question_id:
        print(
            f"[NFC] TAG {card_uid!r} ignored — no active game/question "
            f"(gameId={_ws_game_id} questionId={_ws_question_id})",
            flush=True,
        )
        return
    payload = {
        "gameId":     _ws_game_id,
        "questionId": _ws_question_id,
        "pairName":   PAIR_NAME,
        "badgeId":    _resolve_badge_id(),
        "cardUid":    card_uid,
    }
    print(f"[NFC] relaying TAG {card_uid!r} → POST /api/guesses", flush=True)
    post_to_server("/api/guesses", payload)
```

---

## HTTP fallback poller

When the WS cannot connect, the Zero polls `GET /api/pairs/:pairName` on an
interval (reuses the existing `_heartbeat_loop`). Add to the heartbeat:

```python
_WS_FALLBACK_POLL_S = 30.0
_last_ws_fallback_poll = 0.0

async def _heartbeat_loop(interval_s: float = 5.0):
    global _last_status_liveness_post, _last_ws_fallback_poll
    while True:
        await asyncio.sleep(interval_s)
        # --- existing BLE STATUS ping ---
        if ble_controller.client and ble_controller.client.is_connected:
            try:
                await ble_controller.client.write_gatt_char(UART_RX_CHAR_UUID, b"STATUS")
            except Exception:
                pass
            nowm = time.monotonic()
            if nowm - _last_status_liveness_post >= STATUS_LIVENESS_POST_S:
                _last_status_liveness_post = nowm
                post_to_server("/api/status", _status_payload("connected"))
        # --- NEW: HTTP fallback for game state ---
        if not _ws_connected:
            nowm = time.monotonic()
            if nowm - _last_ws_fallback_poll >= _WS_FALLBACK_POLL_S:
                _last_ws_fallback_poll = nowm
                _poll_pair_binding()


def _poll_pair_binding():
    """Fetch GET /api/pairs/:pairName and apply the game snapshot."""
    data = fetch_from_server(f"/api/pairs/{PAIR_NAME}")
    if not isinstance(data, dict):
        return
    import asyncio as _asyncio
    _asyncio.run_coroutine_threadsafe(
        _ws_handle_event({
            "type":           "controller.welcome",
            "gameId":         data.get("gameId"),
            "state":          data.get("state"),
            "joined":         data.get("joined", False),
            "openQuestionId": data.get("openQuestionId"),
        }),
        ble_event_loop,
    )
```

---

## Startup changes: launch WS task

In `init_ble_connection` → `connect()`, after the event loop is created,
schedule the WebSocket loop as an additional task:

```python
ble_event_loop = asyncio.new_event_loop()
asyncio.set_event_loop(ble_event_loop)

# Start WebSocket client alongside BLE (both run in the same event loop).
ble_event_loop.create_task(_ws_connect_loop())

# ... existing BLE startup code continues ...
```

---

## Files to change

| File | Change |
| --- | --- |
| `rainbow-connection/python/emoji-os/emoji-os-zero.py` | All changes above |

No server changes — all server-side endpoints and events were implemented in
Step 1.

---

## New Pi dependency

```bash
pip3 install websockets
```

If a `requirements.txt` exists in the `python/emoji-os/` folder, add:

```
websockets
```

---

## Acceptance criteria

- Zero connects to `ws://localhost:3000/ws` (local) or
  `wss://emoji-staging.kogs.link/ws` (staging) on startup.
- Server log shows `controller.hello` received and a `controller.welcome`
  reply is sent back.
- Menu 3 left-side slot 4 shows a 'G' glyph instead of a question mark.
- Selecting menu 3 · pos 4 · neg 0 (center/KEY2) enters game mode; the main
  emoji area shows the 'G' glyph and status text reflects the current game
  state from `controller.welcome`.
- When the referee posts `game.opened`, the Zero display (if in game mode)
  updates to "JOIN? KEY1".
- Pressing KEY1 while in game mode and `_join_pending` sends
  `POST /api/games/:gameId/join`; dashboard shows `controller.joined`; display
  updates to "WAITING...".
- Pressing any navigation button exits game mode; emoji picker resumes
  normally.
- When referee starts the game, display (if in game mode) shows "GAME ON" and
  Pico receives `GAME:active` over BLE.
- When referee opens a question, display (if in game mode) shows "SCAN NOW"
  and Pico receives `GAME:question_open`.
- A `TAG:<cardUid>` from the Pico triggers `POST /api/guesses`; dashboard
  shows `nfc.tagged`.
- When the WS is intentionally blocked, the HTTP fallback fires every 30 s and
  the Zero still reflects the latest game state.
- If the WS drops, the Zero reconnects automatically with backoff; on
  reconnect the `controller.welcome` snapshot re-applies so no state is missed.

---

## Open questions for this step

- **`TAG:` vs `NFC:` prefix during transition**: Step 4 changes the Pico to
  send `TAG:`. Until the Pico is updated, only the legacy `NFC:` path fires.
  The `_relay_nfc_tag` handler will be exercised only after Step 4. This is by
  design; both handlers can coexist.
- **NFC positive slot (menu 3 · pos 4)**: Repurposing this slot for game mode
  removes the "NFC positive" entry point. Confirm whether the NFC positive
  feature (circle result) is still needed and, if so, which slot it moves to.
  The neg 4 slot (NFC negative, 'x' result) is untouched.
- **Game mode and normal emoji picker coexist**: While `game_mode_active` is
  True, the player cannot use the emoji picker. Pressing any navigation button
  exits game mode (via `reset_prev()`). This means a player must re-enter menu
  3 · pos 4 to return to game mode. Confirm this is acceptable UX.
- **Multiple game events before BLE is ready**: if `game.started` arrives
  before the Pico is paired, the BLE write is skipped. `_apply_game_state_to_display`
  (called on `controller.welcome` after reconnect) redraws the display but
  does not re-send the missed BLE write. Acceptable for the demo.
- **`game_mode_matrix` pixel art**: The 8×8 'G' matrix above is a rough
  draft. Adjust pixels during implementation to match the visual style of other
  matrices in `emojis_zero.py`.
- **`yellow` colour string**: Pillow accepts `"yellow"` as a named colour.
  Verify it renders clearly on the 128×128 LCD; swap for an explicit RGB tuple
  if needed.
