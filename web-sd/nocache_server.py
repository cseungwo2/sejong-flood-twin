# 개발용 무캐시 서버 — System Dynamics(CLD) 편집기 전용 (8766, 트윈과 분리 운영)
import http.server, socketserver

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

# Windows에서 True면 같은 포트에 서버가 중복 바인딩됨(요청 갈라짐) → False로 단일 보장
socketserver.TCPServer.allow_reuse_address = False
try:
    with socketserver.TCPServer(('', 8766), H) as httpd:
        print('SD no-cache server on :8766 (단일)', flush=True)
        httpd.serve_forever()
except OSError as e:
    print('8766 이미 사용 중 — 중복 실행 막음:', e, flush=True)
