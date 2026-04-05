# emoji os pico - Startup/connection indicator; white 5s then blue; red on BLE error
VERSION = "0.2.9"

import glowbit
from machine import Pin
import time
from emojis import (
    regular,
    happy,
    wry,
    sadWry,
    crossboneEyes,
    heartEyes,
    thickLips,
    sad,
    angry,
    greenMonster,
    chakana,
    heartBounce,
    finn,
    pikachu,
    crab,
    frog,
    bald,
    surprise,
)

# === BLE Imports ===
import bluetooth
from ble_advertising import advertising_payload
from micropython import const

# === BLE Constants ===
_IRQ_CENTRAL_CONNECT = const(1)
_IRQ_CENTRAL_DISCONNECT = const(2)
_IRQ_GATTS_WRITE = const(3)

_FLAG_READ = const(0x0002)
_FLAG_WRITE_NO_RESPONSE = const(0x0004)
_FLAG_WRITE = const(0x0008)
_FLAG_NOTIFY = const(0x0010)

# Nordic UART Service UUIDs
_UART_UUID = bluetooth.UUID("6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
_UART_TX = (
    bluetooth.UUID("6E400003-B5A3-F393-E0A9-E50E24DCCA9E"),
    _FLAG_READ | _FLAG_NOTIFY,
)
_UART_RX = (
    bluetooth.UUID("6E400002-B5A3-F393-E0A9-E50E24DCCA9E"),
    _FLAG_WRITE | _FLAG_WRITE_NO_RESPONSE,
)
_UART_SERVICE = (
    _UART_UUID,
    (_UART_TX, _UART_RX),
)

# === Hardware Setup ===
matrix = glowbit.matrix8x8()
matrix.pixelsFill(matrix.black())

# Status indicator colours (pale white, pale blue, light green, pale red for error)
PALE_WHITE = (80, 80, 80)
PALE_BLUE = (60, 60, 140)
LIGHT_GREEN = (100, 220, 100)
PALE_RED = (180, 60, 60)


def draw_center_indicator(rgb_tuple):
    """Draw a 2x2 square in the centre of the matrix with the given (R,G,B) colour."""
    matrix.pixelsFill(matrix.black())
    r, g, b = rgb_tuple
    colour = matrix.rgbColour(r, g, b)
    matrix.drawRectangleFill(3, 3, 4, 4, colour)
    matrix.pixelsShow()


button1 = Pin(22, Pin.IN, Pin.PULL_DOWN)
button2 = Pin(21, Pin.IN, Pin.PULL_DOWN)
button3 = Pin(20, Pin.IN, Pin.PULL_DOWN)
buzzer = Pin(11, Pin.OUT)
led_onboard = Pin("LED", Pin.OUT)

# === State Variables ===
# Display indicator states (centre 2x2): startup (white 5s) -> advertising (blue) -> connected
# (green 5s) -> waiting (blank). Red square = BLE init/connect problem (no new state variable).
# Menu/button states (other than choosing emoji): state in ("none", "start", "choosing");
# prev_state in ("none", "done"); menu 0..3; pos/neg 0..4; prev_menu, prev_pos, prev_neg.
menu = 0
pos = 0
neg = 0
state = "none"  # start end or none
# preserve the previous state for pos/neg flipping
prev_menu = 0
prev_pos = 0
prev_neg = 0
prev_state = "none"  # or done
pause = 0.2

# === Helper Functions ===
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

def check_neg():
    global neg
    if neg > 4:
        neg = 1

# drawing the menu could be considered a training mode
def draw_menu():
    global menu
    global pause
    if menu == 0:
        matrix.drawRectangleFill(3,0, 4,1, matrix.white()) # 1 center square
        matrix.pixelsShow()
        time.sleep(pause)
    if menu == 1:
        matrix.drawRectangleFill(3,2, 4,3, matrix.white()) # 1 center square
        matrix.pixelsShow()
        time.sleep(pause)
    if menu == 2:
        matrix.drawRectangleFill(3,4, 4,5, matrix.white()) # 1 center square
        matrix.pixelsShow()
        time.sleep(pause)
    if menu == 3:
        matrix.drawRectangleFill(3,6, 4,7, matrix.white()) # 1 center square
        matrix.pixelsShow()
        time.sleep(pause)

# draw the positive state value.  possibly we will hide these
# pos & neg start at 1.  0 means either one has not been selected
def draw_pos():
    global pos
    if pos == 1:
        matrix.drawRectangleFill(0,0, 1,1, matrix.green()) # 1 center square
        matrix.pixelsShow()
        time.sleep(pause)
    if pos == 2:
        matrix.drawRectangleFill(0,2, 1,3, matrix.green()) # 1 center square
        matrix.pixelsShow()
        time.sleep(pause)
    if pos == 3:
        matrix.drawRectangleFill(0,4, 1,5, matrix.green()) # 1 center square
        matrix.pixelsShow()
        time.sleep(pause)
    if pos == 4:
        matrix.drawRectangleFill(0,6, 1,7, matrix.green()) # 1 center square
        matrix.pixelsShow()
        time.sleep(pause)

def draw_neg():
    global neg
    if neg == 1:
        matrix.drawRectangleFill(5,0, 6,1, matrix.red()) # 1 center square
        matrix.pixelsShow()
        # time.sleep(0.5)
    if neg == 2:
        matrix.drawRectangleFill(5,2, 6,3, matrix.red()) # 1 center square
        matrix.pixelsShow()
        # time.sleep(0.5)
    if neg == 3:
        matrix.drawRectangleFill(5,4, 6,5, matrix.red()) # 1 center square
        matrix.pixelsShow()
        # time.sleep(0.5)
    if neg == 4:
        matrix.drawRectangleFill(5,6, 6,7, matrix.red()) # 1 center square
        matrix.pixelsShow()
        # time.sleep(0.5)

def reset_state():
    global state
    global menu
    global pos
    global neg
    global prev_state
    global prev_menu
    global prev_pos
    global prev_neg
    prev_state = "done"
    prev_menu = menu
    prev_pos = pos
    prev_neg = neg
    state = "none"
    menu = 0
    pos = 0
    neg = 0

def reset_prev():
    global prev_state
    global prev_menu
    global prev_pos
    global prev_neg
    prev_state = "none"
    prev_menu = 0
    prev_pos = 0
    prev_neg = 0
    
def buzz():
    buzzer.value(1)
    time.sleep(0.1)
    buzzer.value(0)

# draw the chosen emoji and reset values
def draw_emoji():
    global state
    global menu
    global pos
    global neg
    print("draw emoji menu at", menu, "pos at", pos, "neg at", neg, "state", state)
    matrix = glowbit.matrix8x8(rateLimitCharactersPerSecond=0.7)
    #==========
    #POSITIVE 0
    # regular
    if (menu == 0 and pos == 1):
        print("menu 0 pos 1 normal")
        regular()
    # happy
    if (menu == 0 and pos == 2):
        print("menu 0 pos 3 wry")
        wry()
    # wry
    if (menu == 0 and pos == 3):
        print("menu 0 pos 2 happy")
        happy()
    # heart eyes
    if (menu == 0 and pos == 4):
        print("menu 0 pos 4 heart eyes")
        heartEyes()
    # NEGATIVE 0
    # thick lips
    if (menu == 0 and neg == 1):
        print("menu 0 neg 1 thick lips")
        thickLips()
     # sad wry
    if (menu == 0 and neg == 2):
        print("menu 0 neg 2 sad wry")
        sadWry()
    # sad
    if (menu == 0 and neg == 3):
        print("menu 0 neg 3 sad")
        sad()
    # crossbone eyes
    if (menu == 0 and neg == 4):
        print("menu 0 neg 4 crossbone eyes")
        crossboneEyes()
    #==========
    #POSITIVE 1
    # fireworks
    if (menu == 1 and pos == 1):
        print("menu 1 pos 1 fireworks " + state)
        matrix = glowbit.matrix8x8(rateLimitCharactersPerSecond=1)
        matrix.fireworks()
    # circularRainbow
    if (menu == 1 and pos == 2):
        print("menu 1 pos 2 circularRainbow")
        matrix = glowbit.matrix8x8(rateLimitCharactersPerSecond=20)
        matrix.circularRainbow()
    # chakana (was scroll_large_image)
    if (menu == 1 and pos == 3):
        print("menu 1 pos 3 scroll_large_image")
        print("chakana")
        chakana()
    # heart bounce
    if (menu == 1 and pos == 4):
        print("menu 1 pos 4 heart bounce")
        heartBounce()
    # NEGATIVE 1
    # rain
    if (menu == 1 and neg == 1):
        print("menu 1 neg 1 rain")
        matrix = glowbit.matrix8x8(rateLimitCharactersPerSecond=5)
        matrix.rain()
    # ??
    if (menu == 1 and neg == 2):
        print("menu 1 neg 2 ")
        # sad()
    # ??
    if (menu == 1 and neg == 3):
        print("menu 1 neg 3")
        # angry()
    # ??
    if (menu == 1 and neg == 4):
        print("menu 1 neg 4 green monster")
        #greenMonster()
    #==========
    #POSITIVE 2
    # finn
    if (menu == 2 and pos == 1):
        print("menu 2 pos 1 finn")
        finn()
    # pikachu
    if (menu == 2 and pos == 2):
        print("menu 2 pos 2 pikachu")
        pikachu()
    # crab
    if (menu == 2 and pos == 3):
        print("menu 2 pos 2 crab")
        crab()
    # frog
    if (menu == 2 and pos == 4):
        print("menu 2 pos 2 frog")
        frog()
    # NEGATIVE 2
    # bald
    if (menu == 2 and neg == 1):
        print("menu 2 neg 1 bald")
        bald()
    # surprise
    if (menu == 2 and neg == 2):
        print("menu 2 neg 2 surprise")
        surprise()
    if (menu == 2 and neg == 3):
        print("menu 2 neg 3 green monster")
        greenMonster()
    if (menu == 2 and neg == 4):
        print("menu 2 neg 4 angry")
        angry()
    #==========
    #POSITIVE 3
    # circle
    if (menu == 3 and pos == 1):
        print("menu 3 pos 1 circle")
        matrix.drawCircle(3, 3, 3, matrix.blue())
        matrix.pixelsShow()
    # yes
    if (menu == 3 and pos == 2):
        print("menu 3 pos 2 Yes")
        matrix.addTextScroll("YES")
        while matrix.scrollingText == True:
            matrix.updateTextScroll()
            matrix.pixelsShow()
    # Somi
    if (menu == 3 and pos == 3):
        print("menu 3 pos 3 Somi")
        matrix.addTextScroll("Somi")
        while matrix.scrollingText == True:
            matrix.updateTextScroll()
            matrix.pixelsShow()
    # NEGATIVE 3
    # X
    if (menu == 3 and neg == 1):
        print("menu 3 neg 1")
        matrix.drawLine(0, 0, 7, 7, matrix.red())
        matrix.drawLine(0, 7, 7, 0, matrix.red())
        matrix.pixelsShow()
    # no
    if (menu == 3 and neg == 2):
        print("menu 3 neg 2")
        matrix.addTextScroll("NO")
        while matrix.scrollingText == True:
            matrix.updateTextScroll()
            matrix.pixelsShow()
    # Tim
    if (menu == 3 and pos == 3):
        print("menu 3 neg 3 Tim")
        matrix.addTextScroll("Tim")
        while matrix.scrollingText == True:
            matrix.updateTextScroll()
            matrix.pixelsShow()
    else:
        # do we need this in scrolling mode?
        reset_state()

# === BLE Classes ===
class BLESimplePeripheral:
    """BLE Peripheral that advertises UART service and receives emoji commands
    Enhanced version with MAC address logging and proper BLE stack reset
    """
    
    def __init__(self, ble, name="Pico-Client"):
        self._ble = ble
        # Force BLE stack reset to clear cached name
        self._ble.active(False)
        time.sleep(0.1)
        self._ble.active(True)
        time.sleep(0.1)
        self._ble.irq(self._irq)
        
        # Get and log the BLE MAC address
        mac_str = "Unknown"
        try:
            mac_data = self._ble.config('mac')
            
            # Handle tuple format: (addr_type, mac_bytes)
            # The MAC address is in the second element as bytes
            if isinstance(mac_data, tuple) and len(mac_data) >= 2:
                # Extract the bytes object from the tuple
                mac_bytes = mac_data[1]
                if isinstance(mac_bytes, bytes) and len(mac_bytes) == 6:
                    # Convert bytes to list of integers
                    mac_ints = [b for b in mac_bytes]
                    # Format MAC address as XX:XX:XX:XX:XX:XX
                    mac_parts = [f'{b:02X}' for b in mac_ints]
                    mac_str = ':'.join(mac_parts)
                    print(f"BLE MAC Address: {mac_str}")
                else:
                    mac_str = "Unknown"
            elif isinstance(mac_data, bytes) and len(mac_data) == 6:
                # Direct bytes object
                mac_ints = [b for b in mac_data]
                mac_parts = [f'{b:02X}' for b in mac_ints]
                mac_str = ':'.join(mac_parts)
                print(f"BLE MAC Address: {mac_str}")
            elif isinstance(mac_data, (tuple, list)) and len(mac_data) == 6:
                # Already a sequence of 6 integers
                mac_ints = [int(x) if not isinstance(x, int) else x for x in mac_data]
                mac_parts = [f'{b:02X}' for b in mac_ints]
                mac_str = ':'.join(mac_parts)
                print(f"BLE MAC Address: {mac_str}")
        except Exception as e:
            print(f"Could not retrieve MAC address (method 1): {e}")
            # Try alternative method
            try:
                # Some MicroPython versions use 'addr' instead of 'mac'
                mac_data = self._ble.config('addr')
                # Handle tuple format: (addr_type, mac_bytes)
                if isinstance(mac_data, tuple) and len(mac_data) >= 2:
                    mac_bytes = mac_data[1]
                    if isinstance(mac_bytes, bytes) and len(mac_bytes) == 6:
                        mac_ints = [b for b in mac_bytes]
                        mac_parts = [f'{b:02X}' for b in mac_ints]
                        mac_str = ':'.join(mac_parts)
                        print(f"BLE MAC Address (via 'addr'): {mac_str}")
                    else:
                        mac_str = "Unknown"
                elif isinstance(mac_data, bytes) and len(mac_data) == 6:
                    mac_ints = [b for b in mac_data]
                    mac_parts = [f'{b:02X}' for b in mac_ints]
                    mac_str = ':'.join(mac_parts)
                    print(f"BLE MAC Address (via 'addr'): {mac_str}")
                else:
                    mac_str = "Unknown"
            except Exception as e2:
                mac_str = "Unknown"
        
        # Register the UART service
        ((self._handle_tx, self._handle_rx),) = self._ble.gatts_register_services((_UART_SERVICE,))
        
        self._connections = set()
        self._write_callback = None
        self._display_callback = None  # called with "advertising" when we start/restart advertising
        self._just_connected = False
        self._payload = advertising_payload(name=name, services=[_UART_UUID])
        self._mac_address = mac_str
        self._advertise()

    def _irq(self, event, data):
        """Handle BLE events"""
        if event == _IRQ_CENTRAL_CONNECT:
            conn_handle, _, _ = data
            print(f"✓ Connected: {conn_handle}")
            self._connections.add(conn_handle)
            self._just_connected = True
        elif event == _IRQ_CENTRAL_DISCONNECT:
            conn_handle, _, _ = data
            print(f"✗ Disconnected: {conn_handle}")
            self._connections.remove(conn_handle)
            # Restart advertising after disconnect
            self._advertise()
            if self._display_callback:
                self._display_callback("advertising")
        elif event == _IRQ_GATTS_WRITE:
            conn_handle, value_handle = data
            value = self._ble.gatts_read(value_handle)
            if value_handle == self._handle_rx and self._write_callback:
                self._write_callback(value)

    def send(self, data):
        """Send data to connected central devices"""
        for conn_handle in self._connections:
            self._ble.gatts_notify(conn_handle, self._handle_tx, data)

    def is_connected(self):
        """Check if any central device is connected"""
        return len(self._connections) > 0

    def _advertise(self, interval_us=500000):
        """Start advertising the BLE service"""
        print("Starting advertising...")
        self._ble.gap_advertise(interval_us, adv_data=self._payload)
        if self._display_callback:
            self._display_callback("advertising")

    def did_just_connect(self):
        """Return True once after a connection, then clear the flag."""
        if self._just_connected:
            self._just_connected = False
            return True
        return False

    def set_display_callback(self, callback):
        """Set callback(state) for display updates: state is 'advertising'."""
        self._display_callback = callback

    def on_write(self, callback):
        """Set callback for when data is written to RX characteristic"""
        self._write_callback = callback

# === BLE Command Handlers ===
def handle_command(command_data):
    """Handle incoming commands from central device"""
    try:
        # Decode the command
        command = command_data.decode('utf-8').strip()
        print(f"✓ Received command: '{command}'")
        
        # Check if this is an emoji command (format: "MENU:POS:NEG")
        if ':' in command:
            try:
                parts = command.split(':')
                if len(parts) == 3:
                    menu_val = int(parts[0])
                    pos_val = int(parts[1])
                    neg_val = int(parts[2])
                    
                    print(f"Emoji Command - Menu: {menu_val}, Pos: {pos_val}, Neg: {neg_val}")
                    
                    # Handle emoji selection
                    handle_emoji_selection(menu_val, pos_val, neg_val)
                    return
            except ValueError:
                print(f"Invalid emoji command format: '{command}'")
        
        # Process legacy commands
        if command == "ON":
            print("Command: Turning ON")
            led_onboard.on()
        elif command == "OFF":
            print("Command: Turning OFF")
            led_onboard.off()
        elif command == "STATUS":
            print("Command: STATUS requested")
            print(f"LED is {'ON' if led_onboard.value() else 'OFF'}")
        elif command == "BLINK":
            print("Command: BLINK")
            for _ in range(3):
                led_onboard.on()
                time.sleep(0.2)
                led_onboard.off()
                time.sleep(0.2)
        else:
            print(f"Unknown command: '{command}'")
            
    except Exception as e:
        print(f"✗ Error processing command: {e}")


def handle_emoji_selection(menu_val, pos_val, neg_val):
    """Handle emoji selection from the Pi Zero"""
    global menu, pos, neg, state
    
    print(f"Processing emoji selection:")
    print(f"  Menu: {menu_val} ({get_menu_name(menu_val)})")
    print(f"  Position: {pos_val}")
    print(f"  Negative: {neg_val}")
    
    # Set the global state variables
    menu = menu_val
    pos = pos_val
    neg = neg_val
    state = "choosing"
    
    # Visual feedback with LED
    for _ in range(2):
        led_onboard.on()
        time.sleep(0.1)
        led_onboard.off()
        time.sleep(0.1)
    
    # Display the emoji immediately
    matrix.pixelsFill(matrix.black())
    draw_emoji()


def get_menu_name(menu_val):
    """Get the name of the menu"""
    menu_names = ["Emojis", "Animations", "Characters", "Other"]
    if 0 <= menu_val < len(menu_names):
        return menu_names[menu_val]
    return "Unknown"

# === Startup: pale white 2x2 centre for 5s, then same position turns pale blue (advertising) ===
draw_center_indicator(PALE_WHITE)
time.sleep(5)
draw_center_indicator(PALE_BLUE)

# === Initialize BLE ===
try:
    ble = bluetooth.BLE()
    p = BLESimplePeripheral(ble, "Pico-Client")

    # Set up command handler and display callback (advertising -> pale blue)
    p.on_write(handle_command)

    def on_advertising(_state=None):
        draw_center_indicator(PALE_BLUE)

    p.set_display_callback(on_advertising)
except Exception as e:
    print(f"BLE init/connect problem: {e}")
    draw_center_indicator(PALE_RED)
    # Re-raise or enter a loop so script doesn't continue with undefined p
    raise

print("Emoji OS Pico " + VERSION + " - Startup/connection indicator; red = BLE error")
print("Device Name: Pico-Client")
print("Supports emoji commands in format: 'MENU:POS:NEG'")
print("Legacy commands: ON, OFF, STATUS, BLINK")

# === Main Loop ===
while True:
    # On first connection: light green 5s then blank (waiting for command)
    if p.did_just_connect():
        draw_center_indicator(LIGHT_GREEN)
        time.sleep(5)
        matrix.pixelsFill(matrix.black())
        matrix.pixelsShow()

    # blocks need to be in reverse order to stop the cascade through the conditions
    if button1.value():
        print('debug btn 1 menu ', menu, "pos", pos, "neg", neg, "state", state, "prev_pos", prev_pos, "prev_neg", prev_neg, "prev_state", prev_state)
        if state == "choosing":
            buzz()
            # increment positive choice
            pos = pos + 1
            neg = 0  # reset any negative value
            check_pos()
            print('button 1 pressed, menu ', menu, "pos", pos, "state", state)
            matrix.pixelsFill(matrix.black())
            draw_menu()
            draw_pos()
        if state == "start":
            buzz()
            # increment positive choice
            state = "choosing"
            pos = pos + 1
            check_pos()
            print('button 1 pressed, menu ', menu, "pos", pos, "state", state)
            matrix.pixelsFill(matrix.black())
            draw_menu()
            draw_pos()
        if prev_state == "done":
            if (prev_neg > 0):
                # reverse previous neg choice
                buzz()
                matrix.pixelsFill(matrix.black())
                pos = prev_neg
                neg = 0
                menu = prev_menu
                print('button 1 pressed again, menu ', menu, "pos", pos, "neg", neg, "state", state)
                draw_emoji()
            if (prev_pos > 0):
                # play last pos
                buzz()
                matrix.pixelsFill(matrix.black())
                pos = prev_pos
                neg = 0
                menu = prev_menu
                print('button 3 pressed again, menu ', menu, "pos", pos, "neg", neg, "state", state)
                draw_emoji()
    if button2.value():
        reset_prev()
        print('debug btn 2 menu ', menu, "pos", pos, "neg", neg, "state", state, "prev_pos", prev_pos, "prev_neg", prev_neg, "prev_state", prev_state)
        buzz()
        if state == "start":
            # start or increment main menu
            menu = menu + 1
            check_menu()
            matrix.pixelsFill(matrix.black())
            draw_menu()
            print('button 2 pressed, menu ', menu, "state", state)
        if state == "none":
            buzz()
            # start or increment main menu
            state = "start"
            check_menu()
            matrix.pixelsFill(matrix.black())
            draw_menu()
            print('button 2 pressed, menu ', menu, "state", state)
        if state == "choosing":
            buzz()
            # done choosing, draw emoji
            print("finshed, draw emoji")
            matrix.pixelsFill(matrix.black())
            draw_emoji()
    if button3.value():
        print('debug btn 3 menu ', menu, "pos", pos, "neg", neg, "state", state, "prev_pos", prev_pos, "prev_neg", prev_neg, "prev_state", prev_state)
        buzz()
        if state == "choosing":
            # increment negative choice
            neg = neg + 1
            pos = 0  # reset positive
            check_neg()
            print('button 3 pressed, menu ', menu, "neg", neg, "state", state)
            matrix.pixelsFill(matrix.black())
            draw_menu()
            draw_neg()
        if state == "start":
            buzz()
            # increment negative choice
            state = "choosing"
            neg = neg + 1
            check_neg()
            print('button 3 pressed, menu ', menu, "neg", neg, "state", state)
            matrix.pixelsFill(matrix.black())            
            draw_menu()
            draw_neg()
        if prev_state == "done":
            print("prev_pos", prev_pos)
            if (prev_pos > 0):
                # toggle pos to neg response
                buzz()
                matrix.pixelsFill(matrix.black())
                neg = prev_pos
                pos = 0
                menu = prev_menu
                print('button 3 pressed again, menu ', menu, "pos", pos, "neg", neg, "state", state)
                draw_emoji()
            if (prev_neg > 0):
                # play last neg
                buzz()
                matrix.pixelsFill(matrix.black())
                neg = prev_neg
                pos = 0
                menu = prev_menu
                print('button 3 pressed again, menu ', menu, "pos", pos, "neg", neg, "state", state)
                draw_emoji()

