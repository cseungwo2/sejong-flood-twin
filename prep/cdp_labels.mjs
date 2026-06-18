// 라벨 토글 켜고 CSS2D 라벨이 뜨는지 + 콘솔 에러 점검 + 스크린샷
import fs from 'fs';
const PORT=9222, URL='http://localhost:8765/index.html';
async function wsUrl(){ for(let i=0;i<20;i++){ try{ const r=await fetch(`http://localhost:${PORT}/json/new?${encodeURIComponent(URL)}`,{method:'PUT'}); const t=await r.json(); if(t.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;}catch(e){} await new Promise(r=>setTimeout(r,300)); } throw new Error('no target'); }
const ws=new WebSocket(await wsUrl()); let id=0; const pend=new Map(); const errors=[];
const send=(m,p={})=>{const i=++id; ws.send(JSON.stringify({id:i,method:m,params:p})); return new Promise(r=>pend.set(i,r));};
ws.addEventListener('message',ev=>{ const d=JSON.parse(ev.data);
  if(d.id&&pend.has(d.id)){pend.get(d.id)(d.result);pend.delete(d.id);return;}
  if(d.method==='Runtime.consoleAPICalled'&&d.params.type==='error') errors.push((d.params.args||[]).map(a=>a.value??a.description??'').join(' '));
  if(d.method==='Runtime.exceptionThrown') errors.push('EXC: '+(d.params.exceptionDetails.exception?.description||d.params.exceptionDetails.text));
});
await new Promise(r=>ws.addEventListener('open',r));
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride',{width:1400,height:950,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:URL});
await new Promise(r=>setTimeout(r,8000));
const ev=expr=>send('Runtime.evaluate',{expression:expr,returnByValue:true}).then(r=>r.result?.value);
// 라벨 버튼 두 개 클릭(켜기)
await ev("document.querySelectorAll('#labels button').forEach(b=>b.click())");
await new Promise(r=>setTimeout(r,1500));
const btns=await ev("[...document.querySelectorAll('#labels button')].map(b=>({t:b.textContent,on:b.classList.contains('on')}))");
const nLabelDiv=await ev("document.querySelectorAll('#app div[style*=\\\"text-shadow\\\"]').length");
const sampleTexts=await ev("[...document.querySelectorAll('#app div[style*=\\\"text-shadow\\\"]')].slice(0,8).map(d=>d.textContent)");
console.log('라벨 버튼:', JSON.stringify(btns));
console.log('렌더된 라벨 div 수:', nLabelDiv);
console.log('라벨 예:', JSON.stringify(sampleTexts));
console.log('콘솔 에러:', errors.length); errors.slice(0,6).forEach(e=>console.log('  ❌',e));
const shot=await send('Page.captureScreenshot',{format:'png'});
fs.writeFileSync(process.argv[2]||'/tmp/twin_labels.png',Buffer.from(shot.data,'base64'));
console.log('saved', process.argv[2]);
ws.close(); process.exit(0);
