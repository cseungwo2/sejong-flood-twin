// 헤드리스 크롬으로 트윈 화면 스크린샷 캡처
import fs from 'fs';
const PORT = 9222, URL = 'http://localhost:8765/index.html';
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
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await new Promise(r => setTimeout(r, 8000));
const r = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(process.argv[2] || '/tmp/twin_shot.png', Buffer.from(r.data, 'base64'));
console.log('saved', process.argv[2]);
ws.close(); process.exit(0);
