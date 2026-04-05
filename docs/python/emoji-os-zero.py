# -*- coding:utf-8 -*-
# Emoji OS Zero
VERSION = " v0.4.7"
# When stdout is redirected (e.g. rc.local >> log), Python buffers unless run with
# `python -u` or PYTHONUNBUFFERED=1 — use flush=True on early prints so the log updates.
print(f"emoji-os-zero{VERSION} starting", flush=True)

import LCD_1in44
import time
import threading
import asyncio
import warnings
import requests
from datetime import datetime, timezone
from bleak import BleakScanner, BleakClient
from bleak.backends.characteristic import BleakGATTCharacteristic
import RPi.GPIO as GPIO

from PIL import Image,ImageDraw,ImageFont,ImageColor
from emojis_zero import *
from animations_zero import fireworks_animation as fw_anim_func, rain_animation as rain_anim_func
from emojis_zero import fireworks_animation, rain_animation, connecting_matrix, connected_matrix, not_connected_matrix

# === Server Configuration ===
# Set SERVER_URL to enable reporting to the emoji server dashboard.
# Leave empty to disable (safe default — server is not required to run).
SERVER_URL = "https://4jvum6svrd.ap-southeast-2.awsapprunner.com"  # no trailing slash
# Logical Pi Zero id (POST /api/status and /api/emoji).
CONTROLLER_ID = "zero-living-room"
# If non-empty, used as badgeId for all API posts. If empty, badgeId is derived from
# the BLE address of the connected Pico (see _resolve_badge_id).
BADGE_ID = ""
# Optional extra headers, e.g. {"x-api-key": "..."} — leave empty if unused.
API_HEADERS = {}

if SERVER_URL:
    print(f"[API] SERVER_URL is set — POSTs go to {SERVER_URL}", flush=True)
else:
    print(
        "[API] SERVER_URL is empty — no requests to AWS/dashboard. "
        "Set SERVER_URL in emoji-os-zero.py (HTTPS base, no trailing slash).",
        flush=True,
    )

# === BLE Configuration ===
# Nordic UART Service UUIDs
UART_SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
UART_RX_CHAR_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"  # Write characteristic
UART_TX_CHAR_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"  # Notify characteristic

# Device name to look for - matches the working controller.py approach
TARGET_DEVICE_NAME = "Pico-Client"


def _scan_device_service_uuids(device):
    """Service UUIDs from a scan result; prefers non-deprecated Bleak fields."""
    uuids = getattr(device, "service_uuids", None)
    if uuids:
        return list(uuids)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", FutureWarning)
        meta = getattr(device, "metadata", None)
        if meta:
            return list(meta.get("uuids", []) or [])
    return []


# BLE Controller class - from working controller-1.3.py
class BLEController:
    """BLE Central controller that connects to Pico and sends emoji commands
    Enhanced with better device discovery using test write method
    """
    
    def __init__(self):
        self.client = None
        self.device_address = None
        self.connected = False
        
    async def scan_for_device(self, timeout=10):
        """Scan for the target Pico device by name or service UUID"""
        global ble_connection_status
        ble_connection_status = "scanning"
        # Update display to show scanning indicator
        draw_connection_indicator()
        disp.LCD_ShowImage(image,0,0)
        print("[BLE] scanning — queueing POST /api/status", flush=True)
        post_to_server("/api/status", _status_payload("scanning"))

        print(f"Scanning for Pico device (preferred name: '{TARGET_DEVICE_NAME}')...")
        print("Will also search for Nordic UART Service if name doesn't match")
        print("Make sure your Pico is running emoji-os-pico-0.2.0.py...")
        
        # First, try scanning by service UUID (most reliable)
        print("\nAttempting to scan by service UUID...")
        try:
            devices = await BleakScanner.discover(
                timeout=timeout,
                service_uuids=[UART_SERVICE_UUID]
            )
            if devices:
                print(f"✓ Found {len(devices)} device(s) advertising Nordic UART Service:")
                for device in devices:
                    name = device.name or "(No Name)"
                    print(f"  - {name:<20} | {device.address}")
                    self.device_address = device.address
                    print(f"✓ Selected device: {name} at {self.device_address}")
                    return True
        except Exception as e:
            print(f"Service UUID scan failed: {e}")
        
        # Fallback: General scan and check for name match or verify service
        print(f"\nPerforming general scan for {timeout} seconds...")
        devices = await BleakScanner.discover(timeout=timeout)
        
        print(f"Found {len(devices)} BLE devices:")
        print("-" * 50)
        
        # First, check for exact name match
        for i, device in enumerate(devices, 1):
            name = device.name or "(No Name)"
            print(f"{i:2d}. {name:<20} | {device.address}")
            
            if device.name == TARGET_DEVICE_NAME:
                print(f"    *** FOUND TARGET DEVICE BY NAME! ***")
                self.device_address = device.address
                print("-" * 50)
                print(f"✓ Found {TARGET_DEVICE_NAME} at address: {self.device_address}")
                return True
        
        print("-" * 50)
        
        # If no name match, try to find by service UUID by connecting to candidates
        print("\nNo exact name match found. Checking devices for Nordic UART Service...")
        candidate_devices = []
        
        # Look for devices that might be the Pico (advertised service UUIDs if present)
        for device in devices:
            name = device.name or "(No Name)"
            adv_uuids = _scan_device_service_uuids(device)
            if UART_SERVICE_UUID.lower() in [s.lower() for s in adv_uuids]:
                candidate_devices.append(device)
                print(f"  Candidate: {name} ({device.address}) - UART service in advertisement")
        
        # If we found candidates via metadata, use the first one
        if candidate_devices:
            device = candidate_devices[0]
            name = device.name or "(No Name)"
            self.device_address = device.address
            print(f"✓ Selected candidate device: {name} at {self.device_address}")
            return True
        
        # Last resort: try connecting to devices and test write (avoids service discovery issues)
        print("\nTesting devices by attempting connection and test write...")
        print("(This may take a moment - checking up to 15 devices)...")
        
        # Known Pico MAC addresses from previous successful connections (for priority)
        known_pico_addresses = ["28:CD:C1:05:AB:A4", "28:CD:C1:07:2C:E8", "2C:CF:67:05:A4:F4"]
        
        # First, check known addresses (faster)
        for known_addr in known_pico_addresses:
            for device in devices:
                if device.address.upper() == known_addr.upper():
                    name = device.name or "(No Name)"
                    print(f"\n  Testing known address: {name} ({device.address})...", end=" ")
                    if await self._test_device_connection(device.address):
                        self.device_address = device.address
                        print(f"✓ FOUND!")
                        print(f"\n✓ Found Pico device (known address):")
                        print(f"  Name: {name}")
                        print(f"  Address: {self.device_address}")
                        return True
                    break
        
        # Then test all other devices
        for device in devices[:15]:  # Check up to 15 devices
            # Skip if we already checked this as a known address
            if device.address.upper() in [a.upper() for a in known_pico_addresses]:
                continue
                
            name = device.name or "(No Name)"
            print(f"  Testing {name} ({device.address})...", end=" ")
            if await self._test_device_connection(device.address):
                self.device_address = device.address
                print(f"✓ FOUND!")
                print(f"\n✓ Found Pico device with Nordic UART Service:")
                print(f"  Name: {name}")
                print(f"  Address: {self.device_address}")
                return True
        
        print(f"\n✗ Could not find Pico device")
        print("\nTroubleshooting tips:")
        print("1. Make sure Pico is running emoji-os-pico-0.2.0.py")
        print("2. Check that Pico shows 'Starting advertising...'")
        print("3. Try moving devices closer together")
        print("4. Restart both devices")
        print("5. Device may be advertising with a different name")
        ble_connection_status = "disconnected"
        draw_connection_indicator()
        disp.LCD_ShowImage(image,0,0)
        post_to_server("/api/status", _status_payload("disconnected"))
        return False
    
    async def _test_device_connection(self, address):
        """Test if a device has the Nordic UART Service by attempting a test write"""
        test_client = None
        try:
            test_client = BleakClient(address)
            await test_client.connect(timeout=3.0)
            
            # Try to write a test command directly to the RX characteristic
            # If this succeeds, we know the device has the UART service
            test_command = b"STATUS"  # Non-destructive test command
            try:
                await test_client.write_gatt_char(UART_RX_CHAR_UUID, test_command)
                # If write succeeded, this is likely our device
                await test_client.disconnect()
                return True
            except Exception as write_error:
                # Write failed - not the right device or characteristic doesn't exist
                await test_client.disconnect()
                return False
                
        except asyncio.TimeoutError:
            if test_client:
                try:
                    await test_client.disconnect()
                except:
                    pass
            return False
        except Exception as e:
            # Connection failed or other error
            if test_client:
                try:
                    await test_client.disconnect()
                except:
                    pass
            return False
    
    async def connect_to_device(self):
        """Connect to the discovered Pico device"""
        global ble_connection_status
        if not self.device_address:
            print("No device address available. Run scan_for_device() first.")
            ble_connection_status = "disconnected"
            draw_connection_indicator()
            disp.LCD_ShowImage(image,0,0)
            return False
            
        try:
            print(f"Connecting to {self.device_address}...")
            ble_connection_status = "connecting"
            draw_connection_indicator()
            disp.LCD_ShowImage(image,0,0)
            print("[BLE] connecting — queueing POST /api/status", flush=True)
            post_to_server("/api/status", _status_payload("connecting"))

            self.client = BleakClient(
                self.device_address,
                disconnected_callback=_on_pico_disconnect,
            )
            await self.client.connect(timeout=10.0)
            
            if self.client.is_connected:
                print("✓ Successfully connected!")
                self.connected = True
                ble_connection_status = "connected"
                draw_connection_indicator()
                disp.LCD_ShowImage(image,0,0)
                print("[BLE] connected — queueing POST /api/status", flush=True)
                post_to_server("/api/status", _status_payload("connected"))
                # Verify the service exists
                try:
                    uart_found = False
                    for service in self.client.services:
                        if service.uuid.lower() == UART_SERVICE_UUID.lower():
                            uart_found = True
                            print(f"✓ Verified Nordic UART Service is available")
                            break
                    if not uart_found:
                        print("⚠ Warning: Connected but Nordic UART Service not found!")
                        print("  This might not be the correct device.")
                except Exception as e:
                    print(f"⚠ Warning: Could not verify services: {e}")
                # Cancel any previous heartbeat and start a fresh one
                global _heartbeat_task, _last_status_liveness_post
                if _heartbeat_task and not _heartbeat_task.done():
                    _heartbeat_task.cancel()
                _last_status_liveness_post = time.monotonic()
                _heartbeat_task = asyncio.create_task(_heartbeat_loop())
                return True
            else:
                print("✗ Failed to connect (not connected after connect() call)")
                ble_connection_status = "disconnected"
                draw_connection_indicator()
                disp.LCD_ShowImage(image,0,0)
                return False
                
        except asyncio.TimeoutError:
            print(f"✗ Connection timeout - device may not be in range or not advertising")
            ble_connection_status = "disconnected"
            draw_connection_indicator()
            disp.LCD_ShowImage(image,0,0)
            return False
        except Exception as e:
            error_msg = str(e)
            print(f"✗ Connection error: {error_msg}")
            if "not found" in error_msg.lower() or "not available" in error_msg.lower():
                print("  → Device may not be advertising or is out of range")
            elif "timeout" in error_msg.lower():
                print("  → Connection timed out - device may be busy or not responding")
            ble_connection_status = "disconnected"
            draw_connection_indicator()
            disp.LCD_ShowImage(image,0,0)
            return False
    
    async def send_emoji_command(self, menu, pos, neg):
        """Send emoji selection command to the connected Pico"""
        if not self.client or not self.client.is_connected:
            print("Not connected to any device — skipping BLE write and /api/emoji", flush=True)
            return False

        command = f"{menu}:{pos}:{neg}"
        try:
            await self.client.write_gatt_char(UART_RX_CHAR_UUID, command.encode("utf-8"))
            print(f"✓ Sent emoji command: '{command}'", flush=True)
            print("[BLE] queueing POST /api/emoji", flush=True)
            post_to_server("/api/emoji", _emoji_payload(menu, pos, neg))
            return True

        except Exception as e:
            print(f"✗ Send failed for '{command}': {e} — marking as disconnected", flush=True)
            self.connected = False
            global ble_connection_status
            ble_connection_status = "disconnected"
            draw_connection_indicator()
            disp.LCD_ShowImage(image, 0, 0)
            post_to_server("/api/status", _status_payload("disconnected"))
            if ble_event_loop and ble_event_loop.is_running():
                asyncio.run_coroutine_threadsafe(_reconnect(), ble_event_loop)
            return False
    
    async def disconnect(self):
        """Disconnect from the device"""
        global ble_connection_status, _heartbeat_task
        if _heartbeat_task and not _heartbeat_task.done():
            _heartbeat_task.cancel()
            _heartbeat_task = None
        if self.client and self.client.is_connected:
            await self.client.disconnect()
            print("Disconnected from Pico")
            self.connected = False
            ble_connection_status = "disconnected"
            draw_connection_indicator()
            disp.LCD_ShowImage(image,0,0)
            post_to_server("/api/status", _status_payload("disconnected"))

# Global BLE controller instance
ble_controller = BLEController()
ble_connection_thread = None
ble_event_loop = None

# Connection status state: "idle", "connecting", "connected", "disconnected"
ble_connection_status = "idle"

# Heartbeat asyncio task — cancelled and replaced on each reconnect
_heartbeat_task = None


def _utc_iso_timestamp():
    # Hint for APIs only — Pi RTC/NTP may be wrong; emoji-app should use server time.
    return datetime.now(timezone.utc).isoformat()


def _resolve_badge_id():
    if BADGE_ID and BADGE_ID.strip():
        return BADGE_ID.strip()
    addr = ble_controller.device_address
    if addr:
        slug = addr.lower().replace(":", "-")
        return f"badge-{slug}"
    return "unknown"


def _emoji_label(menu, pos, neg):
    """Human-readable slug for POST /api/emoji; matches get_main_emoji selections."""
    if menu == 0:
        if pos == 1:
            return "regular"
        if pos == 2:
            return "wry"
        if pos == 3:
            return "happy"
        if pos == 4:
            return "heart_eyes"
        if neg == 1:
            return "thick_lips"
        if neg == 2:
            return "sad_wry"
        if neg == 3:
            return "sad"
        if neg == 4:
            return "crossbone_eyes"
    elif menu == 1:
        if pos == 1:
            return "fireworks"
        if pos == 2:
            return "circular_rainbow"
        if pos == 3:
            return "chakana"
        if pos == 4:
            return "heart"
        if neg == 1:
            return "rain"
    elif menu == 2:
        if pos == 1:
            return "finn"
        if pos == 2:
            return "pikachu"
        if pos == 3:
            return "crab"
        if pos == 4:
            return "frog"
        if neg == 1:
            return "bald"
        if neg == 2:
            return "surprise"
        if neg == 3:
            return "green_monster"
        if neg == 4:
            return "angry"
    elif menu == 3:
        if pos == 1:
            return "others_circle"
        if pos == 2:
            return "others_yes"
        if pos == 3:
            return "others_somi"
        if neg == 1:
            return "others_x"
        if neg == 2:
            return "others_no"
    return f"m{menu}-{pos}-{neg}"


def _status_payload(ble_status: str):
    # API: startup | scanning | connecting | connected | disconnected (see server statusBodySchema).
    return {
        "controllerId": CONTROLLER_ID,
        "badgeId": _resolve_badge_id(),
        "bleStatus": ble_status,
        "timestamp": _utc_iso_timestamp(),
    }


def _emoji_payload(menu, pos, neg):
    return {
        "controllerId": CONTROLLER_ID,
        "badgeId": _resolve_badge_id(),
        "menu": menu,
        "pos": pos,
        "neg": neg,
        "label": _emoji_label(menu, pos, neg),
        "timestamp": _utc_iso_timestamp(),
    }


# Log once if posts are disabled so rc.local.log shows why nothing reaches the API.
_api_skip_empty_url_logged = False


def post_to_server(path: str, payload: dict):
    """Fire-and-forget HTTP POST to the emoji server.

    Runs in a daemon thread so a slow or unreachable server never blocks the UI loop.
    No-op when SERVER_URL is empty.
    """
    global _api_skip_empty_url_logged
    if not SERVER_URL:
        if not _api_skip_empty_url_logged:
            print(
                "[API] skip: SERVER_URL is empty — no HTTP posts (set SERVER_URL at top of script)",
                flush=True,
            )
            _api_skip_empty_url_logged = True
        return

    def _post():
        cid = payload.get("controllerId", "?")
        bid = payload.get("badgeId", "?")
        url = f"{SERVER_URL}{path}"
        try:
            kw = {"json": payload, "timeout": 3}
            if API_HEADERS:
                kw["headers"] = API_HEADERS
            print(f"[API] POST {path} controller={cid} badge={bid}", flush=True)
            r = requests.post(url, **kw)
            snippet = (r.text or "").replace("\n", " ").strip()
            if len(snippet) > 100:
                snippet = snippet[:100] + "…"
            print(f"[API] response {path} -> HTTP {r.status_code} {snippet}", flush=True)
        except Exception as e:
            print(f"[API] request failed {path}: {e}", flush=True)

    threading.Thread(target=_post, daemon=True).start()


def _on_pico_disconnect(client: BleakClient):
    """Bleak calls this (sync) when the BLE connection is lost unexpectedly."""
    global ble_connection_status
    print("⚠ Pico disconnected unexpectedly")
    ble_controller.connected = False
    ble_connection_status = "disconnected"
    draw_connection_indicator()
    disp.LCD_ShowImage(image, 0, 0)
    post_to_server("/api/status", _status_payload("disconnected"))
    if ble_event_loop and ble_event_loop.is_running():
        asyncio.run_coroutine_threadsafe(_reconnect(), ble_event_loop)


async def _reconnect():
    """Scan and reconnect after an unexpected BLE drop."""
    await asyncio.sleep(2)  # brief back-off before scanning
    if await ble_controller.scan_for_device(timeout=10):
        await ble_controller.connect_to_device()


_last_status_liveness_post = 0.0
# POST /api/status while connected at least this often so the dashboard can detect power loss.
STATUS_LIVENESS_POST_S = 40.0


async def _heartbeat_loop(interval_s: float = 5.0):
    """Periodically write a STATUS ping to detect dropped connections quickly.

    The Pico firmware should silently ignore STATUS messages so they do not
    trigger unintended display changes.

    Also POST ``connected`` to the emoji server on an interval so the UI can
    mark the link offline when the Pi or Pico stops without a disconnect POST.
    """
    global _last_status_liveness_post
    while True:
        await asyncio.sleep(interval_s)
        if ble_controller.client and ble_controller.client.is_connected:
            try:
                await ble_controller.client.write_gatt_char(UART_RX_CHAR_UUID, b"STATUS")
            except Exception:
                # The disconnected_callback will handle the clean-up;
                # swallow the exception here to keep the loop alive.
                pass
            nowm = time.monotonic()
            if nowm - _last_status_liveness_post >= STATUS_LIVENESS_POST_S:
                _last_status_liveness_post = nowm
                print("[BLE] liveness — queueing POST /api/status connected", flush=True)
                post_to_server("/api/status", _status_payload("connected"))

# Initialize GPIO before LCD initialization to ensure lgpio allocation works
# LCD_Config.GPIO_Init() will set up the specific pins with initial values
# to avoid the "GPIO not allocated" error with lgpio backend
try:
    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
except:
    pass  # Ignore if already set

# 240x240 display with hardware SPI:
disp = LCD_1in44.LCD()
Lcd_ScanDir = LCD_1in44.SCAN_DIR_DFT  #SCAN_DIR_DFT = D2U_L2R
disp.LCD_Init(Lcd_ScanDir)
disp.LCD_Clear()

# Create blank image for drawing.
# Make sure to create image with mode '1' for 1-bit color.
image = Image.new('RGB', (disp.width, disp.height))

# Get drawing object to draw on image.
draw = ImageDraw.Draw(image)

# Draw a black filled box to clear the image.
draw.rectangle((0,0,disp.width,disp.height), outline=0, fill=0)
disp.LCD_ShowImage(image,0,0)

# === State Machine Variables ===
menu = 0  # Main menu selection (0-3)
pos = 0   # Positive selection (left side emojis)
neg = 0   # Negative selection (right side emojis)
state = "none"  # State: "none", "start", "choosing"
is_winking = False  # Flag to control winking animation
is_animating = False  # Flag to control main emoji animation
animation_running = False  # Flag to prevent multiple animation threads
stop_animation = False  # Flag to interrupt procedural animations

# Previous state tracking for emoji toggling
prev_menu = 0
prev_pos = 0
prev_neg = 0
prev_state = "none"  # or "done"

# === Menu Items ===
menu_items = ["Emojis", "Animations", "Characters", "Other"]

# === Button State Tracking ===
button_states = {
    'up': True,
    'down': True,
    'left': True,
    'right': True,
    'center': True,
    'key1': True,
    'key2': True,
    'key3': True
}

# === Helper Functions ===

def draw_centered_text(draw, text, y_position, font, max_width, text_color="white"):
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
    except AttributeError:
        text_width, text_height = draw.textsize(text, font=font)
    
    x_position = (max_width - text_width) // 2
    draw.text((x_position, y_position), text, font=font, fill=text_color)

def draw_menu_row(draw, text, y_position, font, is_selected=False):
    row_height = 14
    row_y = y_position
    
    if is_selected:
        bg_width = 80  # Fixed width for selection background
        bg_x = 24
        draw.rectangle((bg_x, row_y, bg_x + bg_width, row_y + row_height), fill="white")
        draw_centered_text(draw, text, row_y + 2, font, 128, "black")
    else:
        draw_centered_text(draw, text, row_y + 2, font, 128, "white")

def get_main_emoji():
    """Get the main emoji matrix based on current menu, pos, and neg selection"""
    if menu == 0:  # Emojis menu
        # Show the currently selected emoji when in choosing state
        if state == "choosing":
            if pos == 1:
                return regular_matrix
            elif pos == 2:
                return wry_matrix
            elif pos == 3:
                return happy_matrix
            elif pos == 4:
                return heart_eyes_matrix
            elif neg == 1:
                return thick_lips_matrix
            elif neg == 2:
                return sad_wry_matrix
            elif neg == 3:
                return sad_matrix
            elif neg == 4:
                return crossbone_eyes_matrix
        # Show default when not in choosing state
        elif pos == 1:
            return regular_matrix
        elif pos == 2:
            return wry_matrix
        elif pos == 3:
            return happy_matrix
        elif pos == 4:
            return heart_eyes_matrix
        elif neg == 1:
            return thick_lips_matrix
        elif neg == 2:
            return sad_wry_matrix
        elif neg == 3:
            return sad_matrix
        elif neg == 4:
            return crossbone_eyes_matrix
    
    elif menu == 1:  # Animations menu
        # Return preview matrices for animations
        if state == "choosing":
            if pos == 1:
                return fireworks_animation.preview
            elif pos == 2:
                return circular_rainbow_preview_matrix
            elif pos == 3:
                return chakana_matrix
            elif pos == 4:
                return heart_matrix
            elif neg == 1:
                return rain_animation.preview
        elif pos == 1:
            return fireworks_animation.preview
        elif pos == 2:
            return circular_rainbow_preview_matrix
        elif pos == 3:
            return chakana_matrix
        elif pos == 4:
            return heart_matrix
        elif neg == 1:
            return rain_animation.preview
    
    elif menu == 2:  # Characters menu
        # Show the currently selected character when in choosing state
        if state == "choosing":
            if pos == 1:
                return finn_matrix
            elif pos == 2:
                return pikachu_matrix
            elif pos == 3:
                return crab_matrix
            elif pos == 4:
                return frog_matrix
            elif neg == 1:
                return bald_matrix
            elif neg == 2:
                return surprise_matrix
            elif neg == 3:
                return green_monster_matrix
            elif neg == 4:
                return angry_matrix
        # Show last confirmed character/negative when not in choosing state
        elif pos == 1:
            return finn_matrix
        elif pos == 2:
            return pikachu_matrix
        elif pos == 3:
            return crab_matrix
        elif pos == 4:
            return frog_matrix
        elif neg == 1:
            return bald_matrix
        elif neg == 2:
            return surprise_matrix
        elif neg == 3:
            return green_monster_matrix
        elif neg == 4:
            return angry_matrix

    elif menu == 3:  # Others menu
        if state == "choosing":
            if pos == 1:
                return others_circle_matrix
            elif pos == 2:
                return others_yes_matrix
            elif pos == 3:
                return others_somi_matrix
            elif neg == 1:
                return others_x_matrix
            elif neg == 2:
                return others_no_matrix
        elif pos == 1:
            return others_circle_matrix
        elif pos == 2:
            return others_yes_matrix
        elif pos == 3:
            return others_somi_matrix
        elif neg == 1:
            return others_x_matrix
        elif neg == 2:
            return others_no_matrix
    
    # Default to regular smiley for other menus
    return smiley_matrix

def get_main_emoji_animation():
    """Get the animation state of the main emoji"""
    if menu == 0:  # Emojis menu
        # Show the animation for currently selected emoji when in choosing state
        if state == "choosing":
            if pos == 1:
                return regular_wink_matrix
            elif pos == 2:
                return wry_wink_matrix
            elif pos == 3:
                return happy_wink_matrix
            elif pos == 4:
                return heart_eyes_wink_matrix
            elif neg == 1:
                return thick_lips_wink_matrix
            elif neg == 2:
                return sad_wry_wink_matrix
            elif neg == 3:
                return sad_wink_matrix
            elif neg == 4:
                return crossbone_eyes_wink_matrix
        # Show animation for selected emoji when not in choosing state
        elif pos == 1:
            return regular_wink_matrix
        elif pos == 2:
            return happy_wink_matrix
        elif pos == 3:
            return wry_wink_matrix
        elif pos == 4:
            return heart_eyes_wink_matrix
        elif neg == 1:
            return thick_lips_wink_matrix
        elif neg == 2:
            return sad_wry_wink_matrix
        elif neg == 3:
            return sad_wink_matrix
        elif neg == 4:
            return crossbone_eyes_wink_matrix
    
    elif menu == 1:  # Animations menu - circular rainbow, chakana, heart bounce previews
        if pos == 2:
            return circular_rainbow_wink_matrix
        elif pos == 3:
            return chakana_matrix
        elif pos == 4:
            return heart_bounce_matrix
    
    elif menu == 2:  # Characters menu animations (use character-specific matrices)
        if state == "choosing":
            if pos == 1:
                return finn_wink_matrix
            elif pos == 2:
                return pikachu_wink_matrix
            elif pos == 3:
                return crab_wink_matrix
            elif pos == 4:
                return frog_wink_matrix
            elif neg == 1:
                return bald_wink_matrix
            elif neg == 2:
                return surprise_wink_matrix
            elif neg == 3:
                return green_monster_wink_matrix
            elif neg == 4:
                return angry_wink_matrix
        elif pos == 1:
            return finn_wink_matrix
        elif pos == 2:
            return pikachu_wink_matrix
        elif pos == 3:
            return crab_wink_matrix
        elif pos == 4:
            return frog_wink_matrix
        elif neg == 1:
            return bald_wink_matrix
        elif neg == 2:
            return surprise_wink_matrix
        elif neg == 3:
            return green_monster_wink_matrix
        elif neg == 4:
            return angry_wink_matrix

    elif menu == 3:  # Others menu previews in animation phase
        if pos == 1:
            return others_circle_matrix
        elif pos == 2:
            return others_yes_matrix
        elif pos == 3:
            return others_somi_matrix
        elif neg == 1:
            return others_x_matrix
        elif neg == 2:
            return others_no_matrix
    
    # Default to wink smiley for other menus
    return smiley_wink_matrix

def get_left_side_emojis():
    """Get the left side emoji matrices for menu 0 (Emojis) and menu 1 (Animations)"""
    if menu == 0:
        return [regular_matrix, wry_matrix, happy_matrix, heart_eyes_matrix]
    elif menu == 1:
        return [
            fireworks_animation.preview,
            circular_rainbow_preview_matrix,
            chakana_matrix,
            heart_matrix,
        ]
    elif menu == 2:
        # Finn, Pikachu, Crab, and Frog in the four character slots.
        return [finn_matrix, pikachu_matrix, crab_matrix, frog_matrix]
    elif menu == 3:
        return [others_circle_matrix, others_yes_matrix, others_somi_matrix, smiley_matrix]
    else:
        return [smiley_matrix, smiley_matrix, smiley_matrix, smiley_matrix]

def get_right_side_emojis():
    """Get the right side emoji matrices for menu 0 (Emojis), menu 1 (Animations), and menu 2 (Characters)"""
    if menu == 0:
        return [
            thick_lips_matrix,
            sad_wry_matrix,
            sad_matrix,
            crossbone_eyes_matrix,
        ]
    elif menu == 1:
        return [rain_animation.preview, smiley_matrix, smiley_matrix, smiley_matrix]
    elif menu == 2:
        # Bald, Surprise, Green Monster, Angry — matches Pico menu 2 negatives.
        return [
            bald_matrix,
            surprise_matrix,
            green_monster_matrix,
            angry_matrix,
        ]
    elif menu == 3:
        return [others_x_matrix, others_no_matrix, smiley_matrix, smiley_matrix]
    else:
        return [smiley_matrix, smiley_matrix, smiley_matrix, smiley_matrix]

def check_menu():
    global menu
    if menu > 3:
        menu = 0
    if menu < 0:
        menu = 3

def check_pos():
    global pos
    if pos > 4:
        pos = 1
    if pos < 1:
        pos = 4

def check_neg():
    global neg
    if neg > 4:
        neg = 1
    if neg < 1:
        neg = 4

def reset_state():
    """Save current state as previous and reset to initial state"""
    global state, menu, pos, neg, prev_state, prev_menu, prev_pos, prev_neg
    prev_state = "done"
    prev_menu = menu
    prev_pos = pos
    prev_neg = neg
    state = "none"
    menu = 0
    pos = 0
    neg = 0

def reset_prev():
    """Clear previous state tracking"""
    global prev_state, prev_menu, prev_pos, prev_neg
    prev_state = "none"
    prev_menu = 0
    prev_pos = 0
    prev_neg = 0

def check_animation_interruption():
    """Check if user wants to interrupt the current animation"""
    global stop_animation
    try:
        key1_pressed = disp.digital_read(disp.GPIO_KEY1_PIN) == 0
        key3_pressed = disp.digital_read(disp.GPIO_KEY3_PIN) == 0
        
        # If opposite button is pressed, signal interruption
        if (menu == 1 and pos > 0 and key3_pressed) or (menu == 1 and neg > 0 and key1_pressed):
            stop_animation = True
            return True
        return False
    except:
        # If GPIO read fails, don't interrupt
        return False

def send_emoji_to_pico(menu_val, pos_val, neg_val):
    """Send emoji selection to Pico via BLE"""
    global ble_event_loop
    
    if not ble_event_loop:
        print("BLE not initialized yet — cannot send to Pico or /api/emoji", flush=True)
        return
    
    def send_command():
        try:
            # Use the existing event loop
            future = asyncio.run_coroutine_threadsafe(
                ble_controller.send_emoji_command(menu_val, pos_val, neg_val),
                ble_event_loop
            )
            ok = future.result(timeout=5)
            print(f"[BLE] send_emoji_command finished ok={ok} (False means no BLE write / no API)", flush=True)
        except Exception as e:
            print(f"Error sending to Pico: {e}", flush=True)
    
    # Send in a separate thread to avoid blocking the main loop
    send_thread = threading.Thread(target=send_command)
    send_thread.daemon = True
    send_thread.start()

def start_procedural_animation():
    """Start a procedural animation (fireworks or rain) with interruption support"""
    global animation_running, stop_animation, prev_menu, prev_pos, prev_neg, prev_state
    global state, menu, pos, neg
    
    if animation_running:
        return
    
    animation_running = True
    stop_animation = False
    
    # Save current selection
    prev_state = "done"
    prev_menu = menu
    prev_pos = pos
    prev_neg = neg
    
    # Send emoji command to Pico
    send_emoji_to_pico(menu, pos, neg)
    
    # Clear the display for animation
    draw.rectangle((0, 0, disp.width, disp.height), outline=0, fill=0)
    
    # Calculate position for full-screen animation (bottom half like emojis)
    scale = 7
    emoji_width = scale * 8
    emoji_height = scale * 8
    start_x = (disp.width - emoji_width) // 2
    start_y = 64 + (64 - emoji_height)
    
    interrupted = False
    
    # Run the appropriate animation
    if menu == 1 and pos == 1:
        # Fireworks animation
        interrupted = fw_anim_func(draw, image, disp, scale, start_x, start_y, 
                                   iters=10, interruption_check=check_animation_interruption)
    elif menu == 1 and neg == 1:
        # Rain animation
        interrupted = rain_anim_func(draw, image, disp, scale, start_x, start_y, 
                                    iters=200, density=1, interruption_check=check_animation_interruption)
    
    # Handle interruption - toggle to opposite animation
    if interrupted and stop_animation:
        # User pressed opposite button - toggle pos/neg
        if prev_pos > 0:
            neg = prev_pos
            pos = 0
            menu = prev_menu
        elif prev_neg > 0:
            pos = prev_neg
            neg = 0
            menu = prev_menu
        
        # Reset flags
        animation_running = False
        stop_animation = False
        
        # Start the opposite animation in a new thread to avoid recursion
        animation_thread = threading.Thread(target=start_procedural_animation)
        animation_thread.daemon = True
        animation_thread.start()
        return
    
    # Animation completed normally - reset state
    state = "none"
    pos = 0
    neg = 0
    animation_running = False
    stop_animation = False
    draw_display()

def emoji_two_part_animation():
    """Function to handle two-part emoji animation: normal state then animation state"""
    global is_winking, is_animating, animation_running
    if animation_running:
        return
    animation_running = True
    
    # Send emoji command to Pico
    send_emoji_to_pico(menu, pos, neg)
    
    # First show the normal emoji state
    is_winking = False
    is_animating = False
    draw_display()
    time.sleep(0.5)  # Show normal state for 0.5 seconds
    
    # Then show the animation state
    if menu == 1 and pos == 4:  # Heart bounce (menu 1, pos 4)
        is_animating = True
        is_winking = False
    else:  # Wink animation for other emojis
        is_winking = True
        is_animating = False
    
    draw_display()
    time.sleep(1.0)  # Show animation for 1 second
    
    # Return to normal state
    is_winking = False
    is_animating = False
    draw_display()
    animation_running = False

def start_emoji_animation():
    """Start the appropriate animation based on menu selection"""
    global prev_menu, prev_pos, prev_neg, prev_state, menu, pos, neg, state
    
    # Check if this is a procedural animation (menu 1)
    if menu == 1 and (pos == 1 or neg == 1):
        start_procedural_animation()
    else:
        # Regular two-part emoji animation
        prev_state = "done"
        prev_menu = menu
        prev_pos = pos
        prev_neg = neg
        
        # Run the animation
        emoji_two_part_animation()
        
        # Reset to none state after animation completes (no menu selection)
        state = "none"
        pos = 0
        neg = 0

def draw_connection_indicator(clear_area=True):
    """Draw the BLE connection status indicator in the lower left corner
    
    Args:
        clear_area: If True, clear the indicator area before drawing (for standalone updates)
    """
    global ble_connection_status
    
    # Position in lower left corner (small scale for compact indicator)
    indicator_scale = 2
    indicator_size = indicator_scale * 8
    indicator_x = 2
    indicator_y = disp.height - indicator_size - 2  # 2 pixels from bottom
    
    # Clear the indicator area if requested (for standalone updates)
    if clear_area:
        draw.rectangle((indicator_x, indicator_y, indicator_x + indicator_size, indicator_y + indicator_size), 
                      outline=0, fill=0)
    
    # Select the appropriate matrix based on connection status
    if ble_connection_status in ("scanning", "connecting"):
        indicator_matrix = connecting_matrix
    elif ble_connection_status == "connected":
        indicator_matrix = connected_matrix
    else:  # "idle" or "disconnected"
        indicator_matrix = not_connected_matrix
    
    # Draw the indicator
    draw_emoji(draw, indicator_matrix, color_map, indicator_scale, indicator_x, indicator_y)

def draw_display():
    """Draw the complete display"""
    # Clear screen
    draw.rectangle((0,0,disp.width,disp.height), outline=0, fill=0)
    
    # === Main Emoji (bottom half) ===
    scale = 7
    emoji_width = scale * 8
    emoji_height = scale * 8
    start_x = (disp.width - emoji_width) // 2
    start_y = 64 + (64 - emoji_height)
    
    # Get the appropriate main emoji
    if is_winking or is_animating:
        current_emoji = get_main_emoji_animation()
    else:
        current_emoji = get_main_emoji()
    
    draw_emoji(draw, current_emoji, color_map, scale, start_x, start_y)
    
    # === Left Side Emojis (with selection) ===
    left_emoji_y = [1, 16, 31, 46]
    left_emojis = get_left_side_emojis()
    for i, y_pos in enumerate(left_emoji_y):
        show_selection = (state == "choosing" and pos == i + 1)
        draw_emoji(draw, left_emojis[i], color_map, 1.5, 5, y_pos, show_selection)
    
    # === Right Side Emojis (with selection) ===
    right_emoji_y = [1, 16, 31, 46]
    right_emojis = get_right_side_emojis()
    for i, y_pos in enumerate(right_emoji_y):
        show_selection = (state == "choosing" and neg == i + 1)
        draw_emoji(draw, right_emojis[i], color_map, 1.5, 110, y_pos, show_selection)
    
    # === Menu Text ===
    text_y_positions = [1, 16, 31, 46]
    for i, item in enumerate(menu_items):
        # Show main menu selection in both "start" and "choosing" states
        is_selected = (i == menu and (state == "start" or state == "choosing"))
        draw_menu_row(draw, item, text_y_positions[i], font, is_selected)
    
    # === BLE Connection Status Indicator (lower left) ===
    draw_connection_indicator(clear_area=False)  # Don't clear since we already cleared the whole screen
    
    # Update display
    disp.LCD_ShowImage(image,0,0)

# === Load font ===
try:
    font = ImageFont.load_default()
except:
    font = ImageFont.load_default()

# === Initial display ===
draw_display()

print("Emoji OS Zero " + VERSION + " started with BLE Controller functionality")
print("Joystick: Navigate menus")
print("KEY1: Select positive")
print("KEY2: Navigate/confirm")
print("KEY3: Select negative")
print("=" * 50)

# === Initialize BLE Connection ===
def init_ble_connection():
    """Initialize BLE connection in a separate thread"""
    global ble_event_loop, ble_connection_thread
    
    def connect():
        global ble_event_loop
        try:
            # Create a new event loop for this thread
            ble_event_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(ble_event_loop)

            print("[BLE] startup — queueing POST /api/status", flush=True)
            post_to_server("/api/status", _status_payload("startup"))

            # Scan and connect
            if ble_event_loop.run_until_complete(ble_controller.scan_for_device(timeout=5)):
                ble_event_loop.run_until_complete(ble_controller.connect_to_device())
            
            # Keep the event loop running
            ble_event_loop.run_forever()
            
        except Exception as e:
            print(f"BLE initialization error: {e}")
    
    # Start BLE connection in background
    ble_connection_thread = threading.Thread(target=connect)
    ble_connection_thread.daemon = True
    ble_connection_thread.start()

# Start BLE connection
init_ble_connection()

try:
    while True:
        # === Read button states ===
        up_pressed = disp.digital_read(disp.GPIO_KEY_UP_PIN) == 0
        down_pressed = disp.digital_read(disp.GPIO_KEY_DOWN_PIN) == 0
        left_pressed = disp.digital_read(disp.GPIO_KEY_LEFT_PIN) == 0
        right_pressed = disp.digital_read(disp.GPIO_KEY_RIGHT_PIN) == 0
        center_pressed = disp.digital_read(disp.GPIO_KEY_PRESS_PIN) == 0
        key1_pressed = disp.digital_read(disp.GPIO_KEY1_PIN) == 0
        key2_pressed = disp.digital_read(disp.GPIO_KEY2_PIN) == 0
        key3_pressed = disp.digital_read(disp.GPIO_KEY3_PIN) == 0
        
        # === Handle UP button ===
        if up_pressed and not button_states['up']:
            reset_prev()  # Clear previous state when navigating
            if state == "none":
                state = "start"
            elif state == "start":
                menu = (menu - 1) % 4
                check_menu()
            elif state == "choosing":
                # In choosing mode, UP/DOWN should cycle through left side emojis (positive)
                pos = (pos - 1) % 5
                if pos == 0:
                    pos = 4
                neg = 0
                check_pos()
            draw_display()
            print('Up - Menu:', menu, 'Pos:', pos, 'Neg:', neg, 'State:', state)
            time.sleep(0.2)
        button_states['up'] = up_pressed
        
        # === Handle DOWN button ===
        if down_pressed and not button_states['down']:
            reset_prev()  # Clear previous state when navigating
            if state == "none":
                state = "start"
            elif state == "start":
                menu = (menu + 1) % 4
                check_menu()
            elif state == "choosing":
                # In choosing mode, UP/DOWN should cycle through left side emojis (positive)
                pos = (pos + 1) % 5
                if pos == 0:
                    pos = 1
                neg = 0
                check_pos()
            draw_display()
            print('Down - Menu:', menu, 'Pos:', pos, 'Neg:', neg, 'State:', state)
            time.sleep(0.2)
        button_states['down'] = down_pressed
        
        # === Handle LEFT button ===
        if left_pressed and not button_states['left']:
            reset_prev()  # Clear previous state when navigating
            if state == "choosing":
                neg = (neg + 1) % 5
                if neg == 0:
                    neg = 1
                pos = 0
                check_neg()
            draw_display()
            print('Left - Negative:', neg, 'State:', state)
            time.sleep(0.2)
        button_states['left'] = left_pressed
        
        # === Handle RIGHT button ===
        if right_pressed and not button_states['right']:
            reset_prev()  # Clear previous state when navigating
            if state == "choosing":
                pos = (pos + 1) % 5
                if pos == 0:
                    pos = 1
                neg = 0
                check_pos()
            draw_display()
            print('Right - Positive:', pos, 'State:', state)
            time.sleep(0.2)
        button_states['right'] = right_pressed
        
        # === Handle CENTER button ===
        if center_pressed and not button_states['center']:
            if state == "start":
                state = "choosing"
                pos = 1
                neg = 0
            elif state == "choosing":
                # Show selected emoji and trigger appropriate animation
                print(f"Selected: Menu {menu}, Pos {pos}, Neg {neg}")
                # Start animation in a separate thread
                animation_thread = threading.Thread(target=start_emoji_animation)
                animation_thread.daemon = True
                animation_thread.start()
                # Don't reset state here - let animation handle it
            draw_display()
            print('Center - State:', state)
            time.sleep(0.2)
        button_states['center'] = center_pressed
        
        # === Handle KEY1 button (Positive) ===
        if key1_pressed and not button_states['key1']:
            print('debug KEY1 - menu:', menu, "pos", pos, "neg", neg, 
                "state", state, "prev_pos", prev_pos, "prev_neg", prev_neg, "prev_state", prev_state)

            # Try toggle or replay previous if available
            if prev_state == "done":
                if prev_neg > 0:
                    # Toggle from previous negative to positive
                    pos = prev_neg
                    neg = 0
                    menu = prev_menu
                    print('KEY1 - Toggle from neg to pos, menu:', menu, "pos", pos, "neg", neg)
                    animation_thread = threading.Thread(target=start_emoji_animation)
                    animation_thread.daemon = True
                    animation_thread.start()
                    draw_display()
                    time.sleep(0.2)
                    button_states['key1'] = key1_pressed
                    continue
                elif prev_pos > 0:
                    # Replay previous positive
                    pos = prev_pos
                    neg = 0
                    menu = prev_menu
                    print('KEY1 - Replay prev pos, menu:', menu, "pos", pos, "neg", neg)
                    animation_thread = threading.Thread(target=start_emoji_animation)
                    animation_thread.daemon = True
                    animation_thread.start()
                    draw_display()
                    time.sleep(0.2)
                    button_states['key1'] = key1_pressed
                    continue

            # Fallback to regular logic
            if state == "choosing":
                pos = (pos + 1) % 5
                if pos == 0:
                    pos = 1
                neg = 0
                check_pos()

            elif state == "start":
                state = "choosing"
                pos = 1
                neg = 0

            elif state == "none":
                state = "choosing"
                pos = 1
                neg = 0

            draw_display()
            print('KEY1 - Positive:', pos, 'State:', state)
            time.sleep(0.2)
        button_states['key1'] = key1_pressed
        
        # === Handle KEY2 button (Menu/Confirm) ===
        if key2_pressed and not button_states['key2']:
            # Only clear prev when *not* confirming the current choosing
            if state != "choosing":
                reset_prev()

            if state == "start":
                menu = (menu + 1) % 4
                check_menu()
            elif state == "none":
                state = "start"
            elif state == "choosing":
                # Don't reset prev here! First record prev, then animate
                print(f"Selected: Menu {menu}, Pos {pos}, Neg {neg}")
                animation_thread = threading.Thread(target=start_emoji_animation)
                animation_thread.daemon = True
                animation_thread.start()
            draw_display()
            print('KEY2 - Menu:', menu, 'State:', state)
            time.sleep(0.2)
        button_states['key2'] = key2_pressed
        
        # === Handle KEY3 button (Negative) ===
        if key3_pressed and not button_states['key3']:
            print('debug KEY3 - menu:', menu, "pos", pos, "neg", neg, 
                  "state", state, "prev_pos", prev_pos, "prev_neg", prev_neg, "prev_state", prev_state)

            # First, attempt the "toggle / replay previous" case if just after an animation
            if prev_state == "done":
                if prev_pos > 0:
                    # Toggle from previous positive to negative
                    neg = prev_pos
                    pos = 0
                    menu = prev_menu
                    print('KEY3 - Toggle from pos to neg, menu:', menu, "pos", pos, "neg", neg)
                    animation_thread = threading.Thread(target=start_emoji_animation)
                    animation_thread.daemon = True
                    animation_thread.start()
                    # We do NOT reset prev_state here, so it doesn't fall through to other branches
                    draw_display()
                    time.sleep(0.2)
                    button_states['key3'] = key3_pressed
                    continue
                elif prev_neg > 0:
                    # Replay previous negative
                    neg = prev_neg
                    pos = 0
                    menu = prev_menu
                    print('KEY3 - Replay prev neg, menu:', menu, "pos", pos, "neg", neg)
                    animation_thread = threading.Thread(target=start_emoji_animation)
                    animation_thread.daemon = True
                    animation_thread.start()
                    draw_display()
                    time.sleep(0.2)
                    button_states['key3'] = key3_pressed
                    continue

            # If we didn't take the toggle/replay branch, do the normal logic
            if state == "choosing":
                neg = (neg + 1) % 5
                if neg == 0:
                    neg = 1
                pos = 0
                check_neg()

            elif state == "start":
                state = "choosing"
                neg = 1
                pos = 0

            elif state == "none":
                state = "choosing"
                neg = 1
                pos = 0

            draw_display()
            print('KEY3 - Negative:', neg, 'State:', state)
            time.sleep(0.2)
        button_states['key3'] = key3_pressed
        time.sleep(0.1)

except KeyboardInterrupt:
    print("Exiting...")
    # Clean up BLE connection
    if ble_event_loop:
        try:
            # Schedule disconnect and stop the loop
            ble_event_loop.call_soon_threadsafe(
                lambda: asyncio.create_task(ble_controller.disconnect())
            )
            # Give it a moment to disconnect
            time.sleep(1)
            ble_event_loop.stop()
        except:
            pass
    # Clean up GPIO pins
    try:
        GPIO.cleanup()
    except:
        pass
    try:
        disp.module_exit()
    except:
        pass
