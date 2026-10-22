"""Локальный сервер для разработки: отдаёт файлы без кеширования.

Запуск из корня проекта:  python tools/serve.py  (потом открыть http://localhost:8765)
"""
import http.server
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class NoCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript',
                      '.yaml': 'text/yaml; charset=utf-8', '.css': 'text/css'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), NoCache) as httpd:
        print(f'http://localhost:{PORT}')
        httpd.serve_forever()
