"""Launch the real app in an isolated profile; never use a personal Library.

This checks lifecycle logs emitted from actual native visibility and WebKit
callbacks, then reproduces force-quit/relaunch with the old backend retained.
"""
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request

app = Path(sys.argv[1]).resolve()
root = app / 'Contents/Resources/app'
executable = app / 'Contents/MacOS/Classmate Lilith'
profile = Path(tempfile.mkdtemp(prefix='lilith-native-startup-'))
log = profile / 'logs/launcher.log'
children = []
backend_pids = set()
environment = dict(os.environ, CLASSMATE_DATA_DIR=str(profile / 'data'),
                   CLASSMATE_LOG_DIR=str(profile / 'logs'),
                   CLASSMATE_STARTUP_DIAGNOSTIC='1', NO_PROXY='127.0.0.1,localhost')
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def logs():
    return log.read_text(errors='replace') if log.exists() else ''


def wait_for(process, marker, after=0, timeout=40):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'Native app exited prematurely: {process.returncode}')
        recent = logs()[after:]
        backend_pids.update(map(int, re.findall(r'backend.started pid=(\d+)', logs())))
        if 'startup.failure:' in recent:
            raise RuntimeError(recent[-3000:])
        if marker in recent:
            return
        time.sleep(.1)
    raise RuntimeError(f'No {marker!r} callback; log tail: {logs()[-3000:]}')


def launch():
    process = subprocess.Popen([str(executable)], env=environment,
                               stdout=output, stderr=output, start_new_session=True)
    children.append(process)
    return process


with (profile / 'native-output.log').open('wb') as output:
    try:
        # Refuse to touch a service already listening on this runner.
        try:
            opener.open('http://127.0.0.1:4178/api/health', timeout=1)
        except Exception as error:
            if not isinstance(error, urllib.error.URLError):
                raise
        else:
            raise RuntimeError('Port 4178 already occupied; no test app was started')
        first = launch()
        wait_for(first, 'workspace.visible')
        for marker in ('bootstrap.enter', 'bootstrap.delegate-bound',
                       'lifecycle.did-finish-launching', 'window.visible=true', 'webview.initialized'):
            if marker not in logs():
                raise RuntimeError(f'Missing native startup stage: {marker}')
        with opener.open('http://127.0.0.1:4178/api/health', timeout=3) as response:
            health = json.load(response)
        if Path(health['root']).resolve() != root:
            raise RuntimeError('Native app did not start its own packaged service')
        # Ask LaunchServices to reopen this exact running bundle.
        before = len(logs())
        subprocess.run(['open', str(app)], env=environment, check=True, timeout=10)
        wait_for(first, 'lifecycle.reopen', after=before, timeout=15)
        wait_for(first, 'window.visible=true', after=before, timeout=15)
        before = len(logs())
        first.kill()
        first.wait(timeout=10)
        second = launch()
        wait_for(second, 'workspace.visible', after=before)
        if 'backend.reused' not in logs()[before:]:
            raise RuntimeError('Force-quit/relaunch did not recover the retained service')
        print(json.dumps({'nativeDelegateCallback': True, 'visibleWindow': True,
                          'webviewLoaded': True, 'reopen': True,
                          'forceQuitRelaunch': True, 'isolatedProfile': str(profile)}))
    finally:
        # The saved token belongs exclusively to the temporary test profile.
        token = profile / 'data/.launcher-token'
        if token.exists() and backend_pids:
            try:
                request = urllib.request.Request('http://127.0.0.1:4178/api/shutdown',
                    data=b'', headers={'X-Launcher-Token': token.read_text().strip()}, method='POST')
                opener.open(request, timeout=2).close()
            except Exception:
                pass
        for process in children:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=7)
                except subprocess.TimeoutExpired:
                    process.kill()
        for pid in backend_pids:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
