import eventlet
import socketio
import mss
import pyautogui
from PIL import Image
import io
import base64
import platform
import os
import sys
import threading
import socket
import time
import json

# Setup Socket.IO Server
sio = socketio.Server(cors_allowed_origins='*')
app = socketio.WSGIApp(sio)

PC_NAME = platform.node()
OS_NAME = platform.system()
AGENT_PORT = 4000
BROADCAST_PORT = 4001

active_connections = 0

@sio.event
def connect(sid, environ):
    global active_connections
    active_connections += 1
    print(f"Admin connected: {sid}")

@sio.event
def disconnect(sid):
    global active_connections
    active_connections -= 1
    print(f"Admin disconnected: {sid}")

@sio.on('mouse_move')
def on_mouse_move(sid, data):
    screen_width, screen_height = pyautogui.size()
    if 'x_pct' in data and 'y_pct' in data:
        target_x = int(data['x_pct'] * screen_width)
        target_y = int(data['y_pct'] * screen_height)
        pyautogui.moveTo(target_x, target_y)

@sio.on('mouse_click')
def on_mouse_click(sid, data):
    button = data.get('button', 'left')
    if button == 0:
        pyautogui.click(button='left')
    elif button == 2:
        pyautogui.click(button='right')
    elif button == 1:
        pyautogui.click(button='middle')

@sio.on('key_press')
def on_key_press(sid, data):
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
        except Exception as e:
            pass

@sio.on('list_dir')
def on_list_dir(sid, data):
    path = data.get('path', os.path.expanduser('~'))
    try:
        files = []
        for f in os.listdir(path):
            full_path = os.path.join(path, f)
            files.append({
                'name': f,
                'is_dir': os.path.isdir(full_path),
                'size': os.path.getsize(full_path) if os.path.isfile(full_path) else 0
            })
        # Sort folders first
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
                # Encode as base64 for easy transport over websocket
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
                try:
                    sct_img = sct.grab(monitor)
                    img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                    img.thumbnail((1280, 720))
                    
                    buffer = io.BytesIO()
                    img.save(buffer, format="JPEG", quality=40)
                    encoded_string = base64.b64encode(buffer.getvalue()).decode('utf-8')
                    
                    sio.emit('screen_data', {'image': f"data:image/jpeg;base64,{encoded_string}"})
                except Exception as e:
                    print("Error capturing screen:", e)
            
            # Send at ~10 FPS
            eventlet.sleep(0.1)

def broadcast_presence():
    udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    udp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    
    while True:
        try:
            # We broadcast our existence to the local network
            message = json.dumps({
                'name': PC_NAME,
                'os': OS_NAME,
                'port': AGENT_PORT
            }).encode('utf-8')
            udp_socket.sendto(message, ('<broadcast>', BROADCAST_PORT))
        except Exception as e:
            print("Broadcast error:", e)
        
        eventlet.sleep(2) # Broadcast every 2 seconds

def add_to_startup():
    if platform.system() == 'Windows':
        try:
            import winreg
            exe_path = os.path.abspath(sys.argv[0])
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Run', 0, winreg.KEY_SET_VALUE)
            winreg.SetValueEx(key, 'RDP_Agent', 0, winreg.REG_SZ, exe_path)
            winreg.CloseKey(key)
            print("Successfully configured to run on Windows startup.")
        except Exception as e:
            print("Could not add to Windows startup:", e)

if __name__ == '__main__':
    pyautogui.FAILSAFE = True
    
    # Enable auto-start on Windows boot
    add_to_startup()
    
    print(f"Starting Agent Server on port {AGENT_PORT}...")
    
    # Start screen capture thread
    eventlet.spawn(capture_screen)
    
    # Start UDP broadcast thread
    eventlet.spawn(broadcast_presence)
    
    # Start the Socket.IO server
    eventlet.wsgi.server(eventlet.listen(('0.0.0.0', AGENT_PORT)), app)
