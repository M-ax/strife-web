"""Check an extracted, trusted Strife release inside a disposable Linux container.

Usage: python3 linux-desktop-smoke.py /tmp/Strife
Needs distro runtime dependencies, a running X11/Xwayland display and dbus session.
This verifies ABI, authenticated voice startup and desktop bootstrap, not hardware.
"""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

app = Path(sys.argv[1]).resolve()
for binary in [app / 'Strife', app / 'PhotinoX.Native.so', app / 'voice/strife-voice']:
    result = subprocess.run(['ldd', str(binary)], capture_output=True, text=True)
    assert result.returncode == 0 and 'not found' not in result.stdout + result.stderr, result.stdout + result.stderr
print('PASS: desktop and voice shared libraries resolve', flush=True)

def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

with tempfile.TemporaryDirectory(prefix='strife-smoke-') as directory:
    profile = Path(directory)
    settings = profile / 'mumble-settings.json'
    # No physical audio devices exist in the container. Avoid falling back to
    # JACK when its library is installed but its server is absent.
    settings.write_text(json.dumps({'settings_version': 1, 'mumble_has_quit_normally': True,
                                    'audio': {'transmit_mode': 'PTT', 'input': 'PulseAudio', 'output': 'PulseAudio'}}))
    database = profile / 'mumble.sqlite'
    database.touch()
    token = secrets.token_hex(32)
    with socket.socket(socket.AF_UNIX) as listener, (profile / 'voice.log').open('w+') as log:
        listener.bind(str(profile / 'voice'))
        listener.listen(1)
        listener.settimeout(30)
        process = subprocess.Popen([str(app / 'voice/strife-voice'), '--multiple', '--hidden', '--config', str(settings),
                                    '--default-certificate-dir', directory, '--skip-settings-backup-prompt'],
                                   env={**os.environ, 'STRIFE_PIPE': str(profile / 'voice'), 'STRIFE_PIPE_TOKEN': token,
                                        'STRIFE_DATABASE': str(database)}, stdout=log, stderr=log)
        try:
            connection, _ = listener.accept()
            with connection:
                connection.settimeout(20)
                stream = connection.makefile('rb')
                hello = json.loads(stream.readline())
                assert hello['type'] == 'hello' and hello['protocol'] == 1 and hello['token'] == token
                connection.sendall(b'{"command":"hello"}\n')
                while True:
                    message = json.loads(stream.readline())
                    if message.get('type') == 'state':
                        assert message['rnnoise'] and message['transmitMode'] == 2
                        break
                connection.sendall(b'{"command":"mute","id":"distro-smoke"}\n')
                while True:
                    message = json.loads(stream.readline())
                    if message.get('id') == 'distro-smoke':
                        assert message['ok']
                        break
                connection.sendall(b'{"command":"shutdown"}\n')
                assert process.wait(timeout=10) == 0
            print('PASS: authenticated voice, RNNoise, PTT, mute and clean shutdown', flush=True)
        except Exception:
            log.seek(0)
            print(log.read(), file=sys.stderr)
            raise
        finally:
            stop(process)

    with (profile / 'desktop.log').open('w+') as log:
        desktop = subprocess.Popen([str(app / 'Strife')], env={**os.environ, 'STRIFE_PROFILE': directory}, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                assert desktop.poll() is None, 'Desktop exited during startup'
                sockets = set()
                for fd in Path(f'/proc/{desktop.pid}/fd').iterdir():
                    try:
                        target = os.readlink(fd)
                        if target.startswith('socket:['):
                            sockets.add(target[8:-1])
                    except FileNotFoundError:
                        pass
                ports = [int(fields[1].split(':')[1], 16)
                         for line in Path('/proc/net/tcp').read_text().splitlines()[1:]
                         if (fields := line.split())[3] == '0A' and fields[9] in sockets]
                children = Path(f'/proc/{desktop.pid}/task/{desktop.pid}/children').read_text().split()
                voice_started = any('strife-voice' in Path(f'/proc/{pid}/comm').read_text() for pid in children if Path(f'/proc/{pid}/comm').exists())
                ui_ready = False
                # The host also owns a video proxy listener. Identify the UI by
                # its page content rather than assuming /proc socket order.
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                for port in ports if voice_started else []:
                    try:
                        with opener.open(f'http://127.0.0.1:{port}/', timeout=5) as response:
                            ui_ready = b'id="controls-pane"' in response.read()
                    except (urllib.error.URLError, TimeoutError):
                        continue
                    if ui_ready:
                        break
                if ui_ready:
                    time.sleep(3)
                    assert desktop.poll() is None
                    print('PASS: packaged desktop serves UI and WebKit starts native voice', flush=True)
                    break
                time.sleep(.25)
            else:
                raise AssertionError('Desktop UI did not bootstrap native voice')
        except Exception:
            log.seek(0)
            print(log.read(), file=sys.stderr)
            raise
        finally:
            stop(desktop)
