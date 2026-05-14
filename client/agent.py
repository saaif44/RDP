import sys
import os
import platform

# ── Redirect stdout/stderr to a log file FIRST (before anything else) ──
# This prevents "NoneType has no attribute write" crash when built with
# --noconsole on Windows.
def _redirect_io():
    if platform.system() == 'Windows':
        log_dir = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'LocalRDP')
    else:
        log_dir = os.path.join(os.path.expanduser('~'), '.localrdp')
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, 'agent.log')
    log_file = open(log_path, 'a', buffering=1, encoding='utf-8')
    sys.stdout = log_file
    sys.stderr = log_file

_redirect_io()

# ── Eventlet monkey-patch MUST be first before any other network imports ──
import eventlet
eventlet.monkey_patch()

import socketio
import mss
import pyautogui
from PIL import Image
import io
import base64
import threading
import socket
import time
import json

# Setup Socket.IO Server
sio = socketio.Server(cors_allowed_origins='*', async_mode='eventlet')
app = socketio.WSGIApp(sio)

PC_NAME = platform.node()
OS_NAME = platform.system()
AGENT_PORT = 7420
BROADCAST_PORT = 7421

active_connections = 0

# ── Streaming + control state (admin-configurable at runtime) ──
# Clarity is the default priority. "low_latency" trades sharpness for speed.
QUALITY_PRESETS = {
    'clear':       {'quality': 85, 'max_dim': 1920, 'interval': 0.10},
    'balanced':    {'quality': 65, 'max_dim': 1366, 'interval': 0.07},
    'low_latency': {'quality': 40, 'max_dim': 1024, 'interval': 0.04},
}
DEFAULT_QUALITY_MODE = 'clear'

quality_mode = DEFAULT_QUALITY_MODE
stream_settings = dict(QUALITY_PRESETS[DEFAULT_QUALITY_MODE])
# View-only by default; the admin must explicitly turn control on.
control_enabled = False


def _state_payload():
    return {'quality_mode': quality_mode, 'control_enabled': control_enabled}

@sio.event
def connect(sid, environ):
    global active_connections
    active_connections += 1
    print(f"Admin connected: {sid}", flush=True)
    sio.emit('agent_state', _state_payload(), to=sid)

@sio.event
def disconnect(sid):
    global active_connections
    active_connections -= 1
    print(f"Admin disconnected: {sid}", flush=True)

@sio.on('set_quality')
def on_set_quality(sid, data):
    global quality_mode, stream_settings
    mode = (data or {}).get('mode')
    if mode in QUALITY_PRESETS:
        quality_mode = mode
        stream_settings = dict(QUALITY_PRESETS[mode])
        print(f"Stream quality set to '{mode}' by {sid}", flush=True)
        sio.emit('agent_state', _state_payload())

@sio.on('set_control')
def on_set_control(sid, data):
    global control_enabled
    control_enabled = bool((data or {}).get('enabled'))
    print(f"Remote control {'ENABLED' if control_enabled else 'disabled'} by {sid}", flush=True)
    sio.emit('agent_state', _state_payload())

@sio.on('mouse_move')
def on_mouse_move(sid, data):
    if not control_enabled:
        return
    screen_width, screen_height = pyautogui.size()
    if 'x_pct' in data and 'y_pct' in data:
        target_x = int(data['x_pct'] * screen_width)
        target_y = int(data['y_pct'] * screen_height)
        pyautogui.moveTo(target_x, target_y)

@sio.on('mouse_click')
def on_mouse_click(sid, data):
    if not control_enabled:
        return
    button = data.get('button', 'left')
    if button == 0:
        pyautogui.click(button='left')
    elif button == 2:
        pyautogui.click(button='right')
    elif button == 1:
        pyautogui.click(button='middle')

@sio.on('key_press')
def on_key_press(sid, data):
    if not control_enabled:
        return
    key = data.get('key')
    if key:
        try:
            key_map = {
                'Enter': 'enter', 'Backspace': 'backspace', 'Tab': 'tab',
                'Escape': 'esc', 'ArrowUp': 'up', 'ArrowDown': 'down',
                'ArrowLeft': 'left', 'ArrowRight': 'right', 'Shift': 'shift',
                'Control': 'ctrl', 'Alt': 'alt', 'Meta': 'win'
            }
            pyautogui.press(key_map.get(key, key.lower()))
        except Exception:
            pass

@sio.on('list_dir')
def on_list_dir(sid, data):
    path = data.get('path', os.path.expanduser('~'))
    try:
        files = []
        for f in os.listdir(path):
            full_path = os.path.join(path, f)
            try:
                files.append({
                    'name': f,
                    'is_dir': os.path.isdir(full_path),
                    'size': os.path.getsize(full_path) if os.path.isfile(full_path) else 0
                })
            except PermissionError:
                pass
        files.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))
        sio.emit('dir_data', {'path': path, 'files': files}, to=sid)
    except Exception as e:
        sio.emit('dir_error', {'error': str(e)}, to=sid)

@sio.on('download_file')
def on_download_file(sid, data):
    path = data.get('path')
    try:
        if os.path.isfile(path):
            with open(path, 'rb') as f:
                content = f.read()
                encoded = base64.b64encode(content).decode('utf-8')
                sio.emit('file_data', {'name': os.path.basename(path), 'data': encoded}, to=sid)
        else:
            sio.emit('dir_error', {'error': 'Not a file'}, to=sid)
    except Exception as e:
        sio.emit('dir_error', {'error': str(e)}, to=sid)

def capture_screen():
    global active_connections
    with mss.mss() as sct:
        monitor = sct.monitors[1]
        while True:
            if active_connections > 0:
                settings = stream_settings
                try:
                    sct_img = sct.grab(monitor)
                    img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                    max_dim = settings['max_dim']
                    img.thumbnail((max_dim, max_dim))
                    buffer = io.BytesIO()
                    img.save(buffer, format="JPEG", quality=settings['quality'])
                    encoded_string = base64.b64encode(buffer.getvalue()).decode('utf-8')
                    sio.emit('screen_data', {'image': f"data:image/jpeg;base64,{encoded_string}"})
                except Exception as e:
                    print("Screen capture error:", e, flush=True)
                eventlet.sleep(settings['interval'])
            else:
                eventlet.sleep(0.5)

def broadcast_presence():
    udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    while True:
        try:
            message = json.dumps({
                'name': PC_NAME,
                'os': OS_NAME,
                'port': AGENT_PORT
            }).encode('utf-8')
            udp_socket.sendto(message, ('<broadcast>', BROADCAST_PORT))
        except Exception as e:
            print("Broadcast error:", e, flush=True)
        eventlet.sleep(2)

def add_to_startup():
    if platform.system() == 'Windows':
        try:
            import winreg
            # Use the actual frozen exe path if running as PyInstaller bundle
            exe_path = sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(sys.argv[0])
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                 r'Software\Microsoft\Windows\CurrentVersion\Run',
                                 0, winreg.KEY_SET_VALUE)
            winreg.SetValueEx(key, 'LocalRDP_Agent', 0, winreg.REG_SZ, exe_path)
            winreg.CloseKey(key)
            print("Registered for Windows startup.", flush=True)
        except Exception as e:
            print("Startup registration failed:", e, flush=True)

def check_already_running():
    """Exit gracefully if another instance is already using the agent port."""
    test_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    test_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        test_sock.bind(('0.0.0.0', AGENT_PORT))
        test_sock.close()
    except OSError:
        print(f"LocalRDP Agent is already running on port {AGENT_PORT}. Exiting.", flush=True)
        sys.exit(0)

if __name__ == '__main__':
    pyautogui.FAILSAFE = False  # Disable failsafe for remote control

    check_already_running()  # Exit silently if already running
    add_to_startup()

    print(f"LocalRDP Agent starting on port {AGENT_PORT}...", flush=True)

    eventlet.spawn(capture_screen)
    eventlet.spawn(broadcast_presence)

    eventlet.wsgi.server(eventlet.listen(('0.0.0.0', AGENT_PORT)), app, log_output=False)
