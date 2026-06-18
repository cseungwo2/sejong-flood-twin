// 줌아웃 조감뷰 스크린샷 — 세종 경계 클리핑 확인용
import fs from 'fs';
const PORT = 9222, URL = process.argv[3] || 'http://localhost:8765/index.html';
const base = `http://localhost:${PORT}`;
async function getWsUrl() {
  for (let i = 0; i < 20; i++) {
    try { const r = await fetch(`${base}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' });
      const t = await r.json(); if (t.webSocketDebuggerUrl) return t.webSocketDebuggerUrl; } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
  } throw new Error('no target');
}
const ws = new WebSocket(await getWsUrl());
let id = 0; const pend = new Map();
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p })); return new Promise(r => pend.set(i, r)); };
ws.addEventListener('message', ev => { const d = JSON.parse(ev.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id); } });
await new Promise(r => ws.addEventListener('open', r));
await send('Page.enable'); await send('Input.enable').catch(()=>{});
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 950, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await new Promise(r => setTimeout(r, 8000));
const cx = 700, cy = 475;
// 줌아웃 (휠 다운 여러 번)
for (let i = 0; i < 22; i++) {
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: 240 });
  await new Promise(r => setTimeout(r, 60));
}
// 위에서 내려다보게 좌드래그로 피치 올리기
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
for (let i = 0; i < 12; i++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy + i * 18, button: 'left' }); await new Promise(r => setTimeout(r, 30)); }
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy + 200, button: 'left' });
await new Promise(r => setTimeout(r, 1500));
const r = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(process.argv[2] || '/tmp/twin_wide.png', Buffer.from(r.data, 'base64'));
console.log('saved', process.argv[2]);
ws.close(); process.exit(0);
