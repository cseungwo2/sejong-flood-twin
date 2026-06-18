// 헤드리스 크롬 CDP로 페이지 콘솔/예외/렌더완료 점검
const PORT = 9222, URL = 'http://localhost:8765/index.html';
const base = `http://localhost:${PORT}`;

async function getWsUrl() {
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(`${base}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' });
      const t = await r.json();
      if (t.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('no debugger target');
}

const ws = new WebSocket(await getWsUrl());
let id = 0; const pend = new Map();
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p })); return new Promise(r => pend.set(i, r)); };
const logs = [], errors = [];

ws.addEventListener('message', ev => {
  const d = JSON.parse(ev.data);
  if (d.id && pend.has(d.id)) { pend.get(d.id)(d.result); pend.delete(d.id); return; }
  if (d.method === 'Runtime.consoleAPICalled') {
    const txt = (d.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
    logs.push(`[${d.params.type}] ${txt}`);
    if (d.params.type === 'error') errors.push(txt);
  }
  if (d.method === 'Runtime.exceptionThrown') {
    const e = d.params.exceptionDetails;
    errors.push('EXCEPTION: ' + (e.exception?.description || e.text));
  }
});

await new Promise(r => ws.addEventListener('open', r));
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL });
await new Promise(r => setTimeout(r, 7000));   // 로딩+렌더 대기

const ev = expr => send('Runtime.evaluate', { expression: expr, returnByValue: true }).then(r => r.result?.value);
const loadingHidden = await ev("getComputedStyle(document.getElementById('loading')).display === 'none'");
const lmsg = await ev("document.getElementById('lmsg')?.textContent || ''");
const riverBtns = await ev("document.querySelectorAll('#rivers button').length");
const riverOn = await ev("[...document.querySelectorAll('#rivers button')].map(b=>({t:b.textContent,on:b.classList.contains('on')}))");
const ovrBtns = await ev("document.querySelectorAll('#overlays button').length");

console.log('==== 결과 ====');
console.log('loading 숨김(=main 완료):', loadingHidden);
console.log('lmsg(에러표시):', JSON.stringify(lmsg));
console.log('하천망 버튼 수:', riverBtns, '| 홍수 오버레이 버튼:', ovrBtns);
console.log('하천망 버튼 상태:', JSON.stringify(riverOn, null, 0));
console.log('콘솔 에러 수:', errors.length);
errors.slice(0, 10).forEach(e => console.log('  ❌', e));
console.log('--- 최근 콘솔 로그 ---');
logs.slice(-12).forEach(l => console.log('  ' + l));
ws.close();
process.exit(0);
