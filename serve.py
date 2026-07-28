"""Simple HTTP server with correct MIME types for ES modules.

Usage: python serve.py [port]
Default port: 8000

Windows Registry may override .js MIME type to text/plain,
which prevents ES module loading. This script forces text/javascript
and adds no-cache headers to avoid stale content issues.

It also accepts results from a headless run:

    POST /result            -> writes headless/result.json
    POST /progress          -> writes headless/progress.json (overwritten each time)
    POST /result?name=foo   -> writes headless/foo.json

A page driven by Edge --dump-dom can only report at process exit, so a long run
(an RZX replay, a full execution map) has no way to hand back progress or a final
answer. Posting to these endpoints gives a driver a file to read while the run is
still going. See docs/automation.md.
"""

import http.server
import json
import mimetypes
import os
import re
import sys
from urllib.parse import urlparse, parse_qs

# Force correct MIME types BEFORE the server starts.
# On Windows, mimetypes.init() reads the Registry and may set .js to text/plain.
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('text/javascript', '.mjs')
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('application/json', '.json')
mimetypes.add_type('application/wasm', '.wasm')

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
RESULT_DIR = 'headless'
SAFE_NAME = re.compile(r'^[A-Za-z0-9._-]{1,64}$')
MAX_BODY = 64 * 1024 * 1024


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def guess_type(self, path):
        # Force .js to text/javascript regardless of Windows Registry
        if path.endswith('.js') or path.endswith('.mjs'):
            return 'text/javascript'
        return super().guess_type(path)

    def do_POST(self):
        url = urlparse(self.path)
        route = url.path.rstrip('/')
        if route not in ('/result', '/progress'):
            self.send_error(404, 'Only /result and /progress accept POST')
            return

        length = int(self.headers.get('Content-Length') or 0)
        if length > MAX_BODY:
            self.send_error(413, 'Body too large')
            return
        body = self.rfile.read(length)

        name = (parse_qs(url.query).get('name') or [route.lstrip('/')])[0]
        if not SAFE_NAME.match(name):
            self.send_error(400, 'Bad name (use letters, digits, . _ -)')
            return
        if not name.endswith('.json'):
            name += '.json'

        os.makedirs(RESULT_DIR, exist_ok=True)
        path = os.path.join(RESULT_DIR, name)
        # Write via a temp file so a reader never sees a half-written result
        tmp = path + '.tmp'
        with open(tmp, 'wb') as fh:
            fh.write(body)
        os.replace(tmp, path)

        if route == '/result':
            print(f'  -> {path} ({len(body)} bytes)')

        reply = json.dumps({'ok': True, 'path': path.replace(os.sep, '/'),
                            'bytes': len(body)}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(reply)))
        self.end_headers()
        self.wfile.write(reply)

    def log_message(self, fmt, *args):
        # Keep POSTs visible, drop the per-asset GET noise
        if args and str(args[0]).startswith('POST'):
            super().log_message(fmt, *args)


print(f'Serving on http://localhost:{PORT}')
print(f'MIME type for .js: {mimetypes.guess_type("test.js")[0]}')
print(f'Headless results: POST /result or /progress -> ./{RESULT_DIR}/')
http.server.HTTPServer(('', PORT), Handler).serve_forever()
