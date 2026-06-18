// 읍면동 라벨 버튼만 클릭 후 라벨이 뜨는지 디버그
const PORT=9222, URL='http://localhost:8765/index.html';
async function wsUrl(){ for(let i=0;i<20;i++){ try{ const r=await fetch(`http://localhost:${PORT}/json/new?${encodeURIComponent(URL)}`,{method:'PUT'}); const t=await r.json(); if(t.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;}catch(e){} await new Promise(r=>setTimeout(r,300)); } throw new Error('no target'); }
const ws=new WebSocket(await wsUrl()); let id=0; const pend=new Map(); const errs=[];
const send=(m,p={})=>{const i=++id; ws.send(JSON.stringify({id:i,method:m,params:p})); return new Promise(r=>pend.set(i,r));};
ws.addEventListener('message',ev=>{ const d=JSON.parse(ev.data);
  if(d.id&&pend.has(d.id)){pend.get(d.id)(d.result);pend.delete(d.id);return;}
  if(d.method==='Runtime.consoleAPICalled'&&d.params.type==='error') errs.push((d.params.args||[]).map(a=>a.value??a.description??'').join(' '));
  if(d.method==='Runtime.exceptionThrown') errs.push('EXC:'+(d.params.exceptionDetails.exception?.description||d.params.exceptionDetails.text)); });
await new Promise(r=>ws.addEventListener('open',r));
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate',{url:URL}); await new Promise(r=>setTimeout(r,8000));
const ev=expr=>send('Runtime.evaluate',{expression:expr,returnByValue:true}).then(r=>r.result?.value);
console.log('labels.json fetch:', await ev("fetch('./data/labels.json').then(r=>r.json()).then(j=>'emd='+j.emd.length+' riv='+j.rivers.length).catch(e=>'ERR '+e)").then(v=>v));
const btns=await ev("[...document.querySelectorAll('#labels button')].map(b=>b.textContent)");
console.log('라벨 버튼들:', JSON.stringify(btns));
// 읍면동 버튼(첫번째) 클릭
await ev("[...document.querySelectorAll('#labels button')].find(b=>b.textContent.includes('읍면동'))?.click()");
await new Promise(r=>setTimeout(r,1500));
const onState=await ev("[...document.querySelectorAll('#labels button')].map(b=>({t:b.textContent,on:b.classList.contains('on')}))");
console.log('클릭 후 상태:', JSON.stringify(onState));
const allLbl=await ev("document.querySelectorAll('#app div[style*=\\\"text-shadow\\\"]').length");
const emdSample=await ev("[...document.querySelectorAll('#app div[style*=\\\"text-shadow\\\"]')].map(d=>d.textContent).slice(0,12)");
const contDisp=await ev("(()=>{const c=document.querySelector('#app > div:last-child'); return c?getComputedStyle(c).display:'?';})()");
console.log('라벨 div 수:', allLbl, '| 예:', JSON.stringify(emdSample));
console.log('콘솔 에러:', errs.length); errs.slice(0,5).forEach(e=>console.log('  ❌',e));
ws.close(); process.exit(0);
