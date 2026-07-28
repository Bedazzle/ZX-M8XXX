"""M8XXX static server + POST result-sink for long RZX-replay coverage runs.

Serves the M8XXX dir (ES-module MIME fixed) and accepts:
  POST /_sink  -> writes body to SINK_COV  (full accumulated coverage JSON)
  POST /_prog  -> writes body to SINK_PROG (tiny status line, overwrite)

Usage: python mapserve.py <port> <out_dir>
"""
import http.server, mimetypes, sys, os, time

mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('text/javascript', '.mjs')
mimetypes.add_type('application/json', '.json')
mimetypes.add_type('application/wasm', '.wasm')

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8137
OUT  = sys.argv[2] if len(sys.argv) > 2 else '.'
SINK_COV  = os.path.join(OUT, 'coverage.json')
SINK_PROG = os.path.join(OUT, 'progress.txt')

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()
    def guess_type(self, path):
        if path.endswith('.js') or path.endswith('.mjs'):
            return 'text/javascript'
        return super().guess_type(path)
    def _read_body(self):
        n = int(self.headers.get('Content-Length', 0))
        return self.rfile.read(n)
    def do_POST(self):
        body = self._read_body()
        if self.path.startswith('/_sink/'):
            name = self.path[len('/_sink/'):].strip('/').replace('..','')
            with open(os.path.join(OUT, f'coverage_{name}.json'), 'wb') as f: f.write(body)
        elif self.path.startswith('/_sink'):
            with open(SINK_COV, 'wb') as f: f.write(body)
        elif self.path.startswith('/_prog'):
            with open(SINK_PROG, 'wb') as f: f.write(body)
        else:
            self.send_response(404); self.end_headers(); return
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(b'ok')
    def log_message(self, *a): pass

print(f'mapserve on :{PORT}  out={OUT}', flush=True)
http.server.HTTPServer(('', PORT), H).serve_forever()
