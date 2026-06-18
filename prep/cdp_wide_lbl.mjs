// 줌아웃 + 라벨 켜고 스크린샷 + 화면 안 라벨 수 카운트
import fs from 'fs';
const PORT=9222, PAGE='http://localhost:8765/index.html';
async function wsUrl(){ for(let i=0;i<20;i++){ try{ const r=await fetch(`http://localhost:${PORT}/json/new?${encodeURIComponent(PAGE)}`,{method:'PUT'}); const t=await r.json(); if(t.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;}catch(e){} await new Promise(r=>setTimeout(r,300)); } throw new Error('no target'); }
const ws=new WebSocket(await wsUrl()); let id=0; const pend=new Map();
const send=(m,p={})=>{const i=++id; ws.send(JSON.stringify({id:i,method:m,params:p})); return new Promise(r=>pend.set(i,r));};
ws.addEventListener('message',ev=>{ const d=JSON.parse(ev.data); if(d.id&&pend.has(d.id)){pend.get(d.id)(d.result);pend.delete(d.id);} });
await new Promise(r=>ws.addEventListener('open',r));
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride',{width:1400,height:950,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:PAGE}); await new Promise(r=>setTimeout(r,8000));
const ev=x=>send('Runtime.evaluate',{expression:x,returnByValue:true}).then(r=>r.result?.value);
await ev(`document.querySelectorAll('#labels button').forEach(b=>b.click())`);
// 줌아웃
for(let i=0;i<18;i++){ await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:700,y:475,deltaX:0,deltaY:250}); await new Promise(r=>setTimeout(r,50)); }
await new Promise(r=>setTimeout(r,1200));
const inView=await ev(`(()=>{const ls=[...document.querySelectorAll('#app div[style*=text-shadow]')].filter(d=>getComputedStyle(d).display!=='none');
  const iv=ls.filter(d=>{const r=d.getBoundingClientRect();return r.x>=0&&r.x<1400&&r.y>=0&&r.y<950&&r.width>0});
  return 'display!=none='+ls.length+' | 화면안='+iv.length+' | 예:'+JSON.stringify(iv.slice(0,8).map(d=>d.textContent));})()`);
console.log(inView);
const r=await send('Page.captureScreenshot',{format:'png'});
fs.writeFileSync(process.argv[2]||'/tmp/twin_wlbl.png',Buffer.from(r.data,'base64'));
console.log('saved', process.argv[2]); ws.close(); process.exit(0);
