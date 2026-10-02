"""Run the APPLICATION tests (tests/tests.json) headlessly.

`run-tests.py` runs tests/*-test.html and says nothing about the pictures. These
are the screen tests — real games and demos run for N frames and compared with a
reference PNG — and they are where a timing change actually shows. Until now they
needed a human in Tools -> Tests, so a change to contention or ULA timing could
only be checked by hand.

    python run-app-tests.py                 # everything enabled in tests.json
    python run-app-tests.py aquaplane 48k   # substrings: id, name, machine, category
    python run-app-tests.py --list
    python run-app-tests.py --json out.json # keep the full result

It serves the tree with serve.py (the documented harness server: ES-module MIME
types, no-cache, and the POST endpoints zxDebug.report() uses), opens
tools/app-tests-harness.html in headless Edge/Chrome, and polls headless/apptests.json
while the run goes. Exits non-zero if any test failed.

Needs the ROMs in roms/ and the media in tests/ — the same files Tools -> Tests needs.
"""

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import quote

ROOT = os.path.dirname(os.path.abspath(__file__))
RESULT = os.path.join(ROOT, 'headless', 'apptests.json')
# A SEPARATE file. They shared one, so a progress post sat where the result should be
# and the driver read it as a finished run with zero tests in it.
PROGRESS = os.path.join(ROOT, 'headless', 'apptests-progress.json')

BROWSERS = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]


def find_browser():
    for p in BROWSERS:
        if os.path.exists(p):
            return p
    for n in ('msedge', 'chromium', 'google-chrome', 'chrome'):
        p = shutil.which(n)
        if p:
            return p
    sys.exit('No Edge/Chrome found - edit BROWSERS in run-app-tests.py')


def free_port(preferred):
    s = socket.socket()
    try:
        s.bind(('127.0.0.1', preferred))
        return preferred
    except OSError:
        s.close()
        s = socket.socket()
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]
    finally:
        s.close()


def wait_for_server(port, secs=20):
    import urllib.request
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            urllib.request.urlopen(f'http://127.0.0.1:{port}/index.html', timeout=1).read(1)
            return True
        except Exception:
            time.sleep(0.2)
    return False


def read_doc(path, kind):
    """The posted document, but only if it is the kind asked for."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            doc = json.load(f)
    except Exception:
        return None
    return doc if doc.get('kind') == kind else None


def read_result():
    return read_doc(RESULT, 'result')


def write_shots(out_dir, failed):
    """What each failing test drew, as <id>.png, beside the reference it missed,
    with an index.html putting the two side by side.

    A pixel count cannot tell a break from a correction. chromatrons' 41.9% was the
    128K artifact colours going from inverted to RIGHT, and academy's 8 pixels are
    one scanline's border starting 4T later -- neither is readable as a number.

    The reference shown is the FAILING STEP's, not the test's first: chromatrons
    fails at step 1, and pairing it with step 0's picture compares two different
    moments and makes a real fix look like nonsense.
    """
    import base64
    os.makedirs(out_dir, exist_ok=True)

    steps = {}
    try:
        with open(os.path.join(ROOT, 'tests', 'tests.json'), 'r', encoding='utf-8') as f:
            doc = json.load(f)
        for t in (doc['tests'] if isinstance(doc, dict) else doc):
            steps[t['id']] = [s.get('screen') for s in t.get('steps', [])]
    except Exception:
        pass

    rows, written = [], 0
    for r in failed:
        shot = r.get('shot')
        if not shot or ',' not in shot:
            continue
        with open(os.path.join(out_dir, r['id'] + '.png'), 'wb') as f:
            f.write(base64.b64decode(shot.split(',', 1)[1]))
        written += 1

        ref_name = None
        screens = steps.get(r['id']) or []
        idx = r.get('step') or 0
        ref = screens[idx] if idx < len(screens) else (screens[0] if screens else None)
        if ref and os.path.exists(os.path.join(ROOT, ref)):
            ref_name = 'ref_' + os.path.basename(ref)
            shutil.copy(os.path.join(ROOT, ref), os.path.join(out_dir, ref_name))
        rows.append((r, ref, ref_name))

    html = ['<!doctype html><meta charset="utf-8"><title>screen diffs</title>',
            '<style>body{background:#14141c;color:#ddd;font:13px monospace;padding:16px}',
            'h2{font-size:15px;margin:22px 0 6px}.p{display:flex;gap:18px;align-items:flex-start}',
            'figure{margin:0}figcaption{opacity:.65;margin-bottom:4px}',
            'img{image-rendering:pixelated;width:352px;border:1px solid #333;background:#000}</style>',
            '<h1 style="font-size:16px">Failing screen tests &mdash; actual vs reference</h1>',
            '<p style="opacity:.7">Left is what the emulator draws now, right is the committed '
            'reference PNG for the step that failed. A big diff is as likely to be a fix as a '
            'break &mdash; look at the picture, and check against real hardware or a known-good '
            'screenshot before deciding.</p>']
    for r, ref, ref_name in rows:
        detail = r.get('error') or f"{r.get('diffPixels')} px ({r.get('diffPercent')}%)"
        html.append(f"<h2>{r['id']} [{r.get('machine','')}] &mdash; {detail}, step "
                    f"{(r.get('step') or 0) + 1}</h2><div class=\"p\">")
        html.append(f"<figure><figcaption>now</figcaption><img src=\"{r['id']}.png\"></figure>")
        if ref_name:
            html.append(f'<figure><figcaption>reference &mdash; {ref}</figcaption>'
                        f'<img src="{ref_name}"></figure>')
        else:
            html.append('<figure><figcaption>no reference on disk</figcaption></figure>')
        html.append('</div>')
    with open(os.path.join(out_dir, 'index.html'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(html))
    return written


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('filters', nargs='*', help='substrings matched against id, name, machine, category')
    ap.add_argument('--list', action='store_true', help='list the tests that would run')
    ap.add_argument('--port', type=int, default=8902)
    ap.add_argument('--timeout', type=int, default=3600,
                    help='seconds for the whole run (the three ctprobe entries are ~80s each)')
    ap.add_argument('--quiet', action='store_true', help='no per-test line while running')
    ap.add_argument('--json', dest='json_out', help='also write the full result here')
    ap.add_argument('--shots', dest='shots_dir',
                    help='write what each FAILING test actually drew, as <id>.png, into this '
                         'folder. A pixel count cannot tell a break from a correction - look '
                         'at the picture')
    args = ap.parse_args()

    if not os.path.isdir(os.path.join(ROOT, 'roms')):
        sys.exit('roms/ is missing — the application tests need the ROM files')

    browser = find_browser()
    port = free_port(args.port)

    os.makedirs(os.path.join(ROOT, 'headless'), exist_ok=True)
    for stale in (RESULT, PROGRESS):
        if os.path.exists(stale):
            os.remove(stale)

    server = subprocess.Popen([sys.executable, os.path.join(ROOT, 'serve.py'), str(port)],
                              cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    udd = tempfile.mkdtemp(prefix='zxm8-apptest-')
    brow = None
    try:
        if not wait_for_server(port):
            sys.exit('serve.py did not come up on port %d' % port)

        qs = []
        if args.filters:
            qs.append('filter=' + quote(','.join(args.filters)))
        if args.list:
            qs.append('list=1')
        url = (f'http://127.0.0.1:{port}/tools/app-tests-harness.html'
               + ('?' + '&'.join(qs) if qs else ''))

        print(f'{os.path.basename(browser)}  |  port {port}')
        print(url)
        print()

        # Headless Chromium sometimes dies during start-up, leaving no result at
        # all. That is indistinguishable from a hung run unless the page gets a
        # chance to say it booted -- so wait for that heartbeat, and relaunch if
        # it never comes. Three bogus "timeouts" and one phantom hang were traced
        # to this, so a silent start-up failure must not look like a verdict.
        # Headless Chromium sometimes dies during start-up, leaving no result at
        # all -- indistinguishable from a hung run. The page now sends a heartbeat
        # the moment it has zxDebug, so a start-up failure is detectable and worth
        # retrying. Three bogus "timeouts" and one phantom hang were this.
        STARTUP_GRACE = 90
        BROWSER_ARGS = [browser, '--headless=new', '--disable-gpu', '--no-first-run',
                        '--no-default-browser-check', '--disable-extensions', '--mute-audio',
                        # The runner yields with setTimeout between frames; a throttled
                        # background renderer turns a 3-minute run into an hour.
                        '--disable-background-timer-throttling',
                        '--disable-renderer-backgrounding',
                        '--disable-backgrounding-occluded-windows',
                        f'--user-data-dir={udd}', url]

        def alive():
            """Has the page said anything at all yet?"""
            return read_doc(PROGRESS, 'progress') is not None or read_result() is not None

        t0 = time.time()
        seen = 0
        result = None
        tries = 0
        booted = False
        while time.time() - t0 < args.timeout:
            if brow is None:
                tries += 1
                if tries > 3:
                    print('the browser failed to start three times running')
                    return 3
                if tries > 1:
                    print(f'  (browser did not start; retry {tries - 1})')
                launched = time.time()
                brow = subprocess.Popen(BROWSER_ARGS, stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL)

            result = read_result()
            if result is not None:
                break
            booted = booted or alive()

            if not args.quiet:
                prog = read_doc(PROGRESS, 'progress')
                data = (prog or {}).get('data') or {}
                done = data.get('done')
                last = data.get('last')
                if done and done > seen and last:
                    seen = done
                    mark = 'ok  ' if last.get('passed') else 'FAIL'
                    extra = ('' if last.get('passed')
                             else '  ' + (last.get('error') or
                                          f"{last.get('diffPixels')} px ({last.get('diffPercent')}%)"))
                    print(f"  {done:>3}/{data.get('total')}  {mark}  "
                          f"{last.get('id','')[:28]:<28} [{last.get('machine','')}]"
                          f"  {last.get('secs')}s{extra}")

            # Gone before it ever spoke, or silent past the grace period: a start-up
            # failure, not a verdict. Kill it and go round again.
            died_early = brow.poll() is not None and not booted
            never_spoke = not booted and (time.time() - launched) > STARTUP_GRACE
            if died_early or never_spoke:
                try:
                    brow.terminate(); brow.wait(timeout=5)
                except Exception:
                    pass
                brow = None
                continue

            if brow.poll() is not None:
                time.sleep(1)
                if read_result() is None:
                    print('the browser exited mid-run without a result')
                    return 3
            time.sleep(0.5)

        result = read_result()
        if result is None:
            prog = read_doc(PROGRESS, 'progress')
            done = ((prog or {}).get('data') or {}).get('done')
            total = ((prog or {}).get('data') or {}).get('total')
            extra = f' (got to {done}/{total})' if done else ''
            print(f'TIMEOUT - no result after {args.timeout}s{extra}. '
                  f'Raise --timeout; ctprobe entries are ~80s each.')
            return 3

        data = result.get('data') or {}
        rows = data.get('results') or []

        if args.list:
            for r in rows:
                print(f"  {r['id']:<28} [{r.get('machine','')}] {r.get('name','')}")
            print(f"\n{len(rows)} tests")
            return 0

        print()
        width = max([len(r['id']) for r in rows] + [10])
        failed = []
        for r in rows:
            if r['passed']:
                print(f"  {r['id']:<{width}}  PASS   {r['secs']:>6}s")
            else:
                failed.append(r)
                detail = r.get('error') or f"{r.get('diffPixels')} px ({r.get('diffPercent')}%)"
                print(f"  {r['id']:<{width}}  FAIL   {r['secs']:>6}s   {detail}")

        print(f"\n{len(rows) - len(failed)} passed, {len(failed)} failed of {len(rows)}")
        if data.get('error'):
            print('HARNESS ERROR: ' + data['error'])
        if failed:
            print('PROBLEM TESTS: ' + ', '.join(r['id'] for r in failed))

        if args.shots_dir and failed:
            written = write_shots(args.shots_dir, failed)
            print(f'{written} screen(s) + index.html written to {args.shots_dir}')

        if args.json_out:
            # The screens are large and already on disk as PNGs; keep them out
            # of the JSON so it stays readable.
            slim = dict(data)
            slim['results'] = [{k: v for k, v in r.items() if k != 'shot'}
                               for r in data.get('results', [])]
            with open(args.json_out, 'w', encoding='utf-8') as f:
                json.dump(slim, f, indent=1)
            print('full result: ' + args.json_out)

        return 1 if (failed or data.get('error')) else 0
    finally:
        for p in (brow, server):
            if p is not None:
                try:
                    p.terminate()
                    p.wait(timeout=5)
                except Exception:
                    try:
                        p.kill()
                    except Exception:
                        pass
        shutil.rmtree(udd, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
