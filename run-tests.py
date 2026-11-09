#!/usr/bin/env python3
"""Run the browser test suites headlessly and print one table.

    python run-tests.py                 # every suite
    python run-tests.py asm disk        # only suites whose name contains asm or disk
    python run-tests.py --all           # include the suites skipped by default
    python run-tests.py --list          # show what would run

Exit code is the number of failing suites, so it can gate a commit.

There is no Node on this machine, so the suites are HTML pages driven with
headless Edge/Chrome: each page runs its asserts on load and writes the result
into the DOM, and --dump-dom prints that DOM. Every run gets a fresh
--user-data-dir, because Chromium caches ES modules aggressively and a stale
module silently tests the previous version of the code.

--dump-dom prints the DOM when the document's LOAD EVENT fires, which is long
before an async suite has finished, so the runner has to hold that event open.
It used to buy the time with --virtual-time-budget, and that is where the
intermittent "NO RESULT" came from: virtual time is the wrong clock. It runs
while the real page waits, so a suite's own "poll up to 10 seconds for the app
to come up" could expire in a blink, and the DOM was dumped either half-written
(NO RESULT) or holding nothing but that suite's own abort line. Raising the
budget made it fail every time, which is what identified it.

So there is no virtual time here. The runner serves the suite pages itself and
splices a small script into each (HOLD_JS), which loads an <img> whose request
this server holds open -- that delays the load event in real time -- and
releases it once the suite has gone quiet. Quiet is counted in ticks rather
than wall-clock, so a suite running 700 emulator frames in a synchronous loop
cannot be mistaken for a finished one. The same script turns an uncaught error
or an unhandled rejection into a visible failure line: a suite that died
half-way used to report however many asserts it had reached, which reads as a
shorter suite rather than a broken one.
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
from urllib.parse import urlparse, parse_qs

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

# Ticks of quiet before a suite is called finished. A suite that drives the real
# app in an iframe gets far longer: it can be waiting on work inside the iframe
# -- a machine rebuild, a ROM fetch, the auto-loader -- which is driven by the
# iframe's own timers and so is invisible to the watcher in the parent page.
QUIET_TICKS = 12
QUIET_TICKS_IFRAME = 80

MARKER = 'ZXM8-RUNNER'

HOLD_JS = r"""
(function () {
    // Spliced in by run-tests.py. See the module docstring there: this holds the
    // document's load event -- when --dump-dom prints the DOM -- until the suite
    // has actually finished, in real time rather than Chromium's virtual time.
    var ID = '__ID__', NEED = __NEED__, GAP = 50;
    var _st = window.setTimeout, _ct = window.clearTimeout;

    var img = document.createElement('img');
    img.style.display = 'none';
    img.src = '/__zxm8_hold__?id=' + ID;
    (document.head || document.documentElement).appendChild(img);

    // What the suite is still waiting for, as far as it can be seen from here:
    // its own timers (every wait()/until() is one) and its own fetches.
    var pending = Object.create(null), net = 0;
    window.setTimeout = function (fn, ms) {
        if (typeof fn !== 'function') return _st.apply(window, arguments);
        var args = [].slice.call(arguments, 2), id;
        id = _st(function () { delete pending[id]; fn.apply(window, args); }, ms);
        pending[id] = 1;
        return id;
    };
    window.clearTimeout = function (id) { delete pending[id]; return _ct.call(window, id); };
    function waiting() { for (var k in pending) return true; return false; }

    var _fetch = window.fetch;
    if (_fetch) {
        window.fetch = function () {
            net++;
            var p = _fetch.apply(window, arguments);
            return p.then(function (r) { net--; return r; },
                          function (e) { net--; throw e; });
        };
    }
    var _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
        net++;
        this.addEventListener('loadend', function () { net--; }, { once: true });
        return _send.apply(this, arguments);
    };

    var dirty = true;
    new MutationObserver(function () { dirty = true; }).observe(
        document.documentElement, { childList: true, subtree: true, characterData: true });

    // A suite that dies half-way used to report however many asserts it had
    // reached, which reads as a shorter suite rather than a broken one.
    function died(what) {
        var d = document.createElement('div');
        d.className = 'fail';
        d.textContent = '__MARKER__: ' + what;
        (document.body || document.documentElement).appendChild(d);
    }
    window.addEventListener('error', function (e) {
        died('uncaught ' + ((e.error && e.error.stack) || e.message || e.type));
    });
    window.addEventListener('unhandledrejection', function (e) {
        died('unhandled rejection ' + ((e.reason && e.reason.stack) || e.reason));
    });

    var released = false;
    function release() {
        if (released) return;
        released = true;
        new Image().src = '/__zxm8_release__?id=' + ID;
    }

    // Has the suite written a result yet? Until it has, a quiet page is one that
    // has not started -- the app in an iframe is still coming up, a module is
    // still being imported -- and releasing then would dump an empty page.
    var seen = false;
    function reported() {
        if (seen) return true;
        if (document.querySelector('div.pass, div.fail')) return (seen = true);
        var t = (document.body && document.body.textContent) || '';
        if (/Pass:\s*\d+[\s\S]{0,200}?Fail:\s*\d+/.test(t) ||
            /\d+\s+passed,\s*\d+\s+failed/.test(t) ||
            /Passed:\s*\d+[\s\S]{0,200}?Failed:\s*\d+/.test(t)) return (seen = true);
        return false;
    }

    // Quiet is counted in TICKS, not in wall-clock. A suite that runs 700 frames
    // in a synchronous loop blocks this thread, so no tick happens and the count
    // cannot drift forward while it is working.
    var idle = 0;
    function tick() {
        if (dirty || waiting() || net || !reported()) { idle = 0; dirty = false; }
        else idle++;
        if (idle >= NEED) return release();
        _st(tick, GAP);
    }
    _st(tick, GAP);
})();
"""


def find_browser():
    for b in BROWSERS:
        if os.path.exists(b):
            return b
    found = shutil.which('chromium') or shutil.which('google-chrome') or shutil.which('msedge')
    if found:
        return found
    sys.exit('No Edge/Chrome found - edit BROWSERS in run-tests.py')


class Holds:
    """The load-event gate for each suite page, one threading.Event per id."""

    def __init__(self):
        self.lock = threading.Lock()
        self.gates = {}
        self.cap = 300

    def gate(self, tid):
        with self.lock:
            ev = self.gates.get(tid)
            if ev is None:
                ev = self.gates[tid] = threading.Event()
            return ev

    def released(self, tid):
        with self.lock:
            ev = self.gates.get(tid)
            return bool(ev and ev.is_set())

    def drop(self, tid):
        """Let go of a page's gate: the browser for it has gone."""
        with self.lock:
            ev = self.gates.pop(tid, None)
        if ev:
            ev.set()


HOLDS = Holds()

# A 1x1 transparent GIF: what the holding <img> finally gets.
PIXEL = bytes.fromhex('47494638396101000100800000000000ffffff21f90401000000002c000000'
                      '000100010000020144003b')

SUITE_PAGE = re.compile(r'^/tests/([A-Za-z0-9_.-]+-test)\.html$')
HEAD_OPEN = re.compile(r'<head[^>]*>', re.I)


def serve(port):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=ROOT, **kw)

        def log_message(self, *a):
            pass

        def handle_one_request(self):
            # Chromium drops its connections the moment --dump-dom has printed,
            # which is a torn-off socket, not a problem worth a traceback.
            try:
                super().handle_one_request()
            except (ConnectionError, OSError):
                self.close_connection = True

        def guess_type(self, path):
            # Windows' registry can map .js to text/plain, which blocks ES modules.
            if path.endswith('.js') or path.endswith('.mjs'):
                return 'text/javascript'
            return super().guess_type(path)

        def do_GET(self):
            url = urlparse(self.path)
            tid = (parse_qs(url.query).get('id') or [''])[0]
            if url.path == '/__zxm8_hold__':
                HOLDS.gate(tid).wait(timeout=HOLDS.cap)
                self.send_response(200)
                self.send_header('Content-Type', 'image/gif')
                self.send_header('Content-Length', str(len(PIXEL)))
                self.end_headers()
                self.wfile.write(PIXEL)
                return
            if url.path == '/__zxm8_release__':
                HOLDS.gate(tid).set()
                self.send_response(204)
                self.end_headers()
                return
            m = SUITE_PAGE.match(url.path)
            if m:
                return self.send_suite(m.group(1))
            return super().do_GET()

        def send_suite(self, name):
            try:
                with open(os.path.join(ROOT, 'tests', name + '.html'),
                          encoding='utf-8') as fh:
                    page = fh.read()
            except OSError:
                self.send_error(404)
                return
            need = QUIET_TICKS_IFRAME if '<iframe' in page else QUIET_TICKS
            js = (HOLD_JS.replace('__ID__', name)
                         .replace('__NEED__', str(need))
                         .replace('__MARKER__', MARKER))
            tag = '<script>' + js + '</script>\n'
            m = HEAD_OPEN.search(page)
            # First thing in the head, so the suite's own scripts see the patched
            # setTimeout rather than the other way round.
            page = page[:m.end()] + tag + page[m.end():] if m else tag + page
            body = page.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

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


def attempt(browser, port, name, timeout):
    udd = tempfile.mkdtemp(prefix='zxm8-test-')
    try:
        cmd = [browser, '--headless=new', '--disable-gpu', '--no-first-run',
               '--no-default-browser-check', '--disable-extensions',
               # Suites click through the real app, and the first click starts
               # its audio -- which would then play the test run at full speed.
               '--mute-audio',
               f'--user-data-dir={udd}',
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
        # The page releases the gate when it goes quiet; if it never did, the
        # dump is of a suite still running (or stuck), whatever it counted.
        quiet = HOLDS.released(name)
        if counts is None:
            return {'name': name, 'status': 'NO RESULT', 'secs': secs, 'quiet': quiet}
        p, f = counts
        status = 'ok' if f == 0 else 'FAIL'
        if not quiet:
            status = 'NOT QUIET'
        return {'name': name, 'status': status, 'passed': p, 'failed': f,
                'secs': secs, 'fails': failures(dom), 'quiet': quiet}
    finally:
        HOLDS.drop(name)
        shutil.rmtree(udd, ignore_errors=True)


def run_suite(browser, port, name, timeout, retries):
    """A suite, re-run if it did not report at all. The flake this replaced is
    gone, but a browser that fails to start is not the suite's verdict."""
    for i in range(retries + 1):
        r = attempt(browser, port, name, timeout)
        if r['status'] not in ('NO RESULT', 'TIMEOUT') or i == retries:
            r['tries'] = i + 1
            return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('filters', nargs='*', help='substrings; a suite runs if it matches any')
    ap.add_argument('--all', action='store_true', help='include suites skipped by default')
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--port', type=int, default=8901)
    ap.add_argument('--timeout', type=int, default=300, help='seconds per suite')
    ap.add_argument('--retries', type=int, default=1,
                    help='re-runs of a suite that reported nothing at all')
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
    HOLDS.cap = args.timeout
    httpd = serve(args.port)
    print(f'{len(suites)} suites  |  {os.path.basename(browser)}  |  port {args.port}\n')

    results = []
    try:
        for name in suites:
            print(f'  {name:<26} ', end='', flush=True)
            r = run_suite(browser, args.port, name, args.timeout, args.retries)
            results.append(r)
            again = f"  (try {r['tries']})" if r.get('tries', 1) > 1 else ''
            if r['status'] == 'ok':
                print(f"{r['passed']:>5} passed          {r['secs']:5.1f}s{again}")
            elif r['status'] in ('FAIL', 'NOT QUIET'):
                tail = 'FAILED' if r['status'] == 'FAIL' else 'NOT QUIET'
                print(f"{r['passed']:>5} passed  {r['failed']:>3} {tail}  {r['secs']:5.1f}s{again}")
                for f in r['fails']:
                    print(f'        - {f}')
            else:
                print(f"{r['status']:>21}  {r['secs']:5.1f}s{again}")
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
    retried = [r['name'] for r in results if r.get('tries', 1) > 1]
    if retried:
        print('re-run (reported nothing first time): ' + ', '.join(retried))
    return len(bad)


if __name__ == '__main__':
    sys.exit(main())
