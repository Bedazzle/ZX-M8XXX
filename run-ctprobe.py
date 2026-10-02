"""Run unreal-ng's contention probe and print how many values we get wrong.

ctprobe measures, to a single clock tick, how long code takes when it touches the
memory the ULA is reading, and compares every measurement with a real machine. It is
the only instrument that sees WHERE INSIDE AN INSTRUCTION a wait falls, which no
screen test can. Until now its verdict on us came from a report in someone else's
tree; this makes it a number we measure here.

    python run-ctprobe.py                       # 48k
    python run-ctprobe.py 48k 128k pentagon
    python run-ctprobe.py --tap path/to/ctprobe.tap

The probe lives in tests/ctprobe.zip, with its sources, licence and credits beside it
in the same archive (GPL v3 - engine by Jan Bobrowski, adjusted by Patrik Rak). --tap
accepts that zip, a bare ctprobe.tap, or $CTPROBE_TAP pointing at either.

Each machine takes about three minutes of EMULATED time (~15000 frames), which is
well under a minute here. Lower is better and 0 is the goal; the count only means
anything against the same probe build.
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
RESULT = os.path.join(ROOT, 'headless', 'ctprobe.json')
# Separate, so a progress post cannot be mistaken for a finished run.
PROGRESS = os.path.join(ROOT, 'headless', 'ctprobe-progress.json')


def read_doc(path, kind):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            doc = json.load(f)
    except Exception:
        return None
    return doc if doc.get('kind') == kind else None

# From ctprobe.sym. Overridable because a rebuilt probe moves them.
SYM_DONE = '0x8CB0'
SYM_FAILS = '0x8CB1'

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
    sys.exit('No Edge/Chrome found - edit BROWSERS in run-ctprobe.py')


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


def find_tap(explicit):
    for cand in (explicit, os.environ.get('CTPROBE_TAP'),
                 os.path.join(ROOT, 'tests', 'ctprobe.zip'),
                 os.path.join(ROOT, 'tests', 'ctprobe.tap')):
        if cand and os.path.exists(cand):
            return os.path.abspath(cand)
    return None


def extract(archive, member, dest_dir):
    """Pull one file out of the zip. The probe ships zipped, like every other test
    medium here, so nothing has to be unpacked into the tree by hand."""
    import zipfile
    with zipfile.ZipFile(archive) as z:
        names = z.namelist()
        if member not in names:
            hit = [n for n in names if n.endswith('/' + member) or n == member]
            if not hit:
                sys.exit(f'{archive} has no {member} (it holds: {", ".join(names)})')
            member = hit[0]
        out = os.path.join(dest_dir, os.path.basename(member))
        with z.open(member) as src, open(out, 'wb') as dst:
            shutil.copyfileobj(src, dst)
        return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('machines', nargs='*', default=None,
                    help='48k 128k +2 +2a +3 pentagon scorpion (default: 48k)')
    ap.add_argument('--tap', help='path to ctprobe.tap (or $CTPROBE_TAP, or tests/ctprobe.tap)')
    ap.add_argument('--trd', action='store_true', help='the file is a .trd, boot it from TR-DOS')
    ap.add_argument('--port', type=int, default=8920)
    ap.add_argument('--timeout', type=int, default=1800)
    ap.add_argument('--max-frames', type=int, default=30000)
    ap.add_argument('--poll', type=int, default=250,
                    help='frames between DONE checks; lower pins the finish point more exactly')
    ap.add_argument('--done-addr', default=SYM_DONE)
    ap.add_argument('--fails-addr', default=SYM_FAILS)
    ap.add_argument('--json', dest='json_out')
    ap.add_argument('--dump-dir', help='write <machine>.bin (START..PROBEEND) for '
                                       'ctprobe-compare.py, which names the checks that differ')
    ap.add_argument('--start-addr', default='0x8CA0')     # START in ctprobe.sym
    ap.add_argument('--end-addr', default='0xB1C4')       # PROBEEND
    args = ap.parse_args()

    machines = args.machines or ['48k']

    tap = find_tap(args.tap)
    if not tap:
        sys.exit('ctprobe not found. Pass --tap <ctprobe.tap>, set $CTPROBE_TAP, or put it in '
                 'tests/. It is GPL and not vendored here - see the note at the top of this file.')

    browser = find_browser()
    port = free_port(args.port)
    os.makedirs(os.path.join(ROOT, 'headless'), exist_ok=True)
    for stale in (RESULT, PROGRESS):
        if os.path.exists(stale):
            os.remove(stale)

    # Served from a folder of its own so nothing has to be copied into the tree.
    serve_dir = os.path.join(ROOT, 'headless', 'ctprobe-media')
    os.makedirs(serve_dir, exist_ok=True)
    if tap.lower().endswith('.zip'):
        local = extract(tap, 'ctprobe.tap', serve_dir)
    else:
        local = os.path.join(serve_dir, os.path.basename(tap))
        if os.path.abspath(tap) != os.path.abspath(local):
            shutil.copy(tap, local)
    tap_url = '/headless/ctprobe-media/' + os.path.basename(local)

    server = subprocess.Popen([sys.executable, os.path.join(ROOT, 'serve.py'), str(port)],
                              cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    udd = tempfile.mkdtemp(prefix='zxm8-ctprobe-')
    brow = None
    try:
        if not wait_for_server(port):
            sys.exit('serve.py did not come up on port %d' % port)

        qs = [f'machines={quote(",".join(machines))}', f'tap={quote(tap_url)}',
              f'done={quote(args.done_addr)}', f'fails={quote(args.fails_addr)}',
              f'max={args.max_frames}', f'poll={args.poll}']
        if args.dump_dir:
            qs.append(f'from={quote(args.start_addr)}')
            qs.append(f'to={quote(args.end_addr)}')
        if args.trd:
            qs.append('kind=trd')
        url = f'http://127.0.0.1:{port}/tools/ctprobe-harness.html?' + '&'.join(qs)

        print(f'{os.path.basename(browser)}  |  port {port}  |  {os.path.basename(tap)}')
        print(f'machines: {", ".join(machines)}')
        print()

        # Headless Chromium sometimes dies during start-up with no result at all,
        # which reads exactly like a hung run. The page sends a heartbeat as soon
        # as it has zxDebug, so a start-up failure is detectable and retried.
        STARTUP_GRACE = 90
        BROWSER_ARGS = [browser, '--headless=new', '--disable-gpu', '--no-first-run',
                        '--no-default-browser-check', '--disable-extensions', '--mute-audio',
                        '--disable-background-timer-throttling',
                        '--disable-renderer-backgrounding',
                        '--disable-backgrounding-occluded-windows',
                        f'--user-data-dir={udd}', url]

        def alive():
            return (read_doc(PROGRESS, 'progress') is not None
                    or read_doc(RESULT, 'result') is not None)

        t0 = time.time()
        shown = set()
        tries = 0
        booted = False
        launched = t0
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

            doc = read_doc(RESULT, 'result')
            if doc is not None:
                break
            booted = booted or alive()
            data = (read_doc(PROGRESS, 'progress') or {}).get('data') or {}
            last = data.get('last')
            if last and last.get('machine') not in shown:
                shown.add(last['machine'])
                print(f"  {last['machine']:<10} done={last.get('done')} "
                      f"fails={last.get('fails')}")
            elif data.get('frames') and data.get('machine'):
                key = (data['machine'], data['frames'] // 5000)
                if key not in shown:
                    shown.add(key)
                    print(f"  {data['machine']:<10} ... {data['frames']} frames")

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
                if read_doc(RESULT, 'result') is None:
                    print('the browser exited mid-run without a result')
                    return 3
            time.sleep(0.5)

        doc = read_doc(RESULT, 'result')
        if doc is None:
            print('TIMEOUT - no result after %ds (each machine is ~80s)' % args.timeout)
            return 3
        data = doc.get('data') or {}

        rows = data.get('results') or []
        print()
        print('  %-10s %-7s %-8s %s' % ('machine', 'done', 'wrong', 'frames'))
        print('  ' + '-' * 40)
        bad = 0
        for r in rows:
            if r.get('error'):
                print('  %-10s %-7s %-8s %s' % (r['machine'], '-', 'ERROR', r['error'][:40]))
                bad += 1
                continue
            if r.get('done') != 1:
                print('  %-10s %-7s %-8s %s  (did not finish)'
                      % (r['machine'], r.get('done'), '?', r.get('frames')))
                bad += 1
                continue
            print('  %-10s %-7s %-8s %s'
                  % (r['machine'], r.get('done'), r.get('fails'), r.get('frames')))
            if r.get('fails'):
                bad += 1
        print()
        total = sum((r.get('fails') or 0) for r in rows if r.get('done') == 1)
        print(f'{total} wrong value(s) in total across {len(rows)} machine(s)'
              + ('  - all as expected' if total == 0 and not bad else ''))
        if data.get('error'):
            print('HARNESS ERROR: ' + data['error'])

        if args.dump_dir:
            import base64
            os.makedirs(args.dump_dir, exist_ok=True)
            for r in rows:
                if not r.get('dump'):
                    continue
                p = os.path.join(args.dump_dir, r['machine'] + '.bin')
                with open(p, 'wb') as f:
                    f.write(base64.b64decode(r['dump']))
                print(f"  dump: {p}  (load at {hex(r.get('dumpFrom', 0))})")
            # The breakdown script travels in the same zip; put it beside the dumps
            # so the documented command works without unpacking anything by hand.
            # It reads ctprobe.sym from its OWN directory, so that goes too.
            cmp_py = os.path.join(args.dump_dir, 'ctprobe-compare.py')
            if tap.lower().endswith('.zip'):
                try:
                    for member in ('ctprobe-compare.py', 'ctprobe.sym'):
                        if not os.path.exists(os.path.join(args.dump_dir, member)):
                            extract(tap, member, args.dump_dir)
                except SystemExit:
                    cmp_py = None
            if cmp_py and os.path.exists(cmp_py):
                for r in rows:
                    if r.get('dump'):
                        print(f'  which checks differ:  python "{cmp_py}" '
                              f'"{os.path.join(args.dump_dir, r["machine"] + ".bin")}"')
                        break

        if args.json_out:
            slim = dict(data)
            slim['results'] = [{k: v for k, v in r.items() if k not in ('screen', 'dump')}
                               for r in rows]
            with open(args.json_out, 'w', encoding='utf-8') as f:
                json.dump(slim, f, indent=1)
            print('full result: ' + args.json_out)

        return 1 if bad else 0
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
