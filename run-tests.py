#!/usr/bin/env python3
"""Run the browser test suites headlessly and print one table.

    python run-tests.py                 # every suite
    python run-tests.py asm disk        # only suites whose name contains asm or disk
    python run-tests.py --all           # include the suites skipped by default
    python run-tests.py --list          # show what would run

Exit code is the number of failing suites, so it can gate a commit.

There is no Node on this machine, so the suites are HTML pages driven with
headless Edge/Chrome: each page runs its asserts on load and writes the result
into the DOM, and --dump-dom prints that DOM once the page settles. Every run
gets a fresh --user-data-dir, because Chromium caches ES modules aggressively
and a stale module silently tests the previous version of the code.
"""

import argparse
import http.server
import os
import re
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading
import time

ROOT = os.path.dirname(os.path.abspath(__file__))

# fuse-test never terminates under headless (it drives a long CPU conformance
# run); its 6 known failures are stale test data, not emulator bugs. pristine
# needs a reference disk that may not be present, and skips itself if absent.
SKIP_BY_DEFAULT = {'fuse-test'}

BROWSERS = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    '/usr/bin/chromium', '/usr/bin/google-chrome',
]

# Suites report differently; try each shape in turn.
PATTERNS = [
    # <div class="pass">/<div class="fail"> entries (most suites)
    None,
    re.compile(r'Pass:\s*(\d+)\s*\|?\s*.*?Fail:\s*(\d+)', re.S),
    re.compile(r'(\d+)\s+passed,\s*(\d+)\s+failed'),
    re.compile(r'Passed:\s*(\d+).*?Failed:\s*(\d+)', re.S),
]


def find_browser():
    for b in BROWSERS:
        if os.path.exists(b):
            return b
    found = shutil.which('chromium') or shutil.which('google-chrome') or shutil.which('msedge')
    if found:
        return found
    sys.exit('No Edge/Chrome found - edit BROWSERS in run-tests.py')


def serve(port):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=ROOT, **kw)

        def log_message(self, *a):
            pass

    httpd = socketserver.ThreadingTCPServer(('127.0.0.1', port), Handler)
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def parse(dom):
    """(passed, failed) from a suite's dumped DOM, or None if it didn't report."""
    p = len(re.findall(r'<div class="pass">', dom))
    f = len(re.findall(r'<div class="fail">', dom))
    if p or f:
        return p, f
    text = re.sub(r'<[^>]+>', ' ', dom)
    for pat in PATTERNS[1:]:
        m = pat.search(text)
        if m:
            return int(m.group(1)), int(m.group(2))
    return None


def failures(dom, limit=5):
    names = re.findall(r'<div class="fail">([^<]*)</div>', dom)
    return [n.strip() for n in names[:limit]]


def run_suite(browser, port, name, timeout):
    udd = tempfile.mkdtemp(prefix='zxm8-test-')
    try:
        cmd = [browser, '--headless=new', '--disable-gpu', '--no-first-run',
               '--no-default-browser-check', '--disable-extensions',
               # Suites click through the real app, and the first click starts
               # its audio -- which would then play the test run at full speed.
               '--mute-audio',
               f'--user-data-dir={udd}', '--virtual-time-budget=300000',
               '--dump-dom', f'http://127.0.0.1:{port}/tests/{name}.html']
        t0 = time.time()
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                                 encoding='utf-8', errors='replace')
            dom = out.stdout or ''
        except subprocess.TimeoutExpired:
            return {'name': name, 'status': 'TIMEOUT', 'secs': time.time() - t0}
        secs = time.time() - t0
        counts = parse(dom)
        if counts is None:
            return {'name': name, 'status': 'NO RESULT', 'secs': secs}
        p, f = counts
        return {'name': name, 'status': 'ok' if f == 0 else 'FAIL',
                'passed': p, 'failed': f, 'secs': secs, 'fails': failures(dom)}
    finally:
        shutil.rmtree(udd, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('filters', nargs='*', help='substrings; a suite runs if it matches any')
    ap.add_argument('--all', action='store_true', help='include suites skipped by default')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--port', type=int, default=8901)
    ap.add_argument('--timeout', type=int, default=300, help='seconds per suite')
    args = ap.parse_args()

    suites = sorted(f[:-5] for f in os.listdir(os.path.join(ROOT, 'tests'))
                    if f.endswith('-test.html') and not f.startswith('_'))
    if args.filters:
        suites = [s for s in suites if any(x in s for x in args.filters)]
    skipped = []
    if not args.all:
        skipped = [s for s in suites if s in SKIP_BY_DEFAULT]
        suites = [s for s in suites if s not in SKIP_BY_DEFAULT]

    if args.list:
        print('\n'.join(suites))
        return 0
    if not suites:
        print('no suites matched')
        return 1

    browser = find_browser()
    httpd = serve(args.port)
    print(f'{len(suites)} suites  |  {os.path.basename(browser)}  |  port {args.port}\n')

    results = []
    try:
        for name in suites:
            print(f'  {name:<26} ', end='', flush=True)
            r = run_suite(browser, args.port, name, args.timeout)
            results.append(r)
            if r['status'] == 'ok':
                print(f"{r['passed']:>5} passed          {r['secs']:5.1f}s")
            elif r['status'] == 'FAIL':
                print(f"{r['passed']:>5} passed  {r['failed']:>3} FAILED  {r['secs']:5.1f}s")
                for f in r['fails']:
                    print(f'        - {f}')
            else:
                print(f"{r['status']:>21}  {r['secs']:5.1f}s")
    finally:
        httpd.shutdown()

    total_p = sum(r.get('passed', 0) for r in results)
    total_f = sum(r.get('failed', 0) for r in results)
    bad = [r for r in results if r['status'] != 'ok']
    print(f"\n{total_p} passed, {total_f} failed across {len(results)} suites")
    if skipped:
        print(f"skipped (use --all): {', '.join(skipped)}")
    if bad:
        print('PROBLEM SUITES: ' + ', '.join(f"{r['name']} ({r['status']})" for r in bad))
    else:
        print('all green')
    return len(bad)


if __name__ == '__main__':
    sys.exit(main())
