// 라벨이 화면에 안 보이는 원인 정밀 진단
const PORT=9222, PAGE='http://localhost:8765/index.html';
async function wsUrl(){ for(let i=0;i<20;i++){ try{ const r=await fetch(`http://localhost:${PORT}/json/new?${encodeURIComponent(PAGE)}`,{method:'PUT'}); const t=await r.json(); if(t.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;}catch(e){} await new Promise(r=>setTimeout(r,300)); } throw new Error('no target'); }
const ws=new WebSocket(await wsUrl()); let id=0; const pend=new Map();
const send=(m,p={})=>{const i=++id; ws.send(JSON.stringify({id:i,method:m,params:p})); return new Promise(r=>pend.set(i,r));};
ws.addEventListener('message',ev=>{ const d=JSON.parse(ev.data); if(d.id&&pend.has(d.id)){pend.get(d.id)(d.result);pend.delete(d.id);} });
await new Promise(r=>ws.addEventListener('open',r));
await send('Page.enable'); await send('Page.navigate',{url:PAGE}); await new Promise(r=>setTimeout(r,8000));
const ev=x=>send('Runtime.evaluate',{expression:x,returnByValue:true}).then(r=>r.result?.value);
await ev(`[...document.querySelectorAll('#labels button')].find(b=>b.textContent.includes('읍면동')).click()`);
await new Promise(r=>setTimeout(r,1200));
const out=await ev(`(()=>{
  const lbls=[...document.querySelectorAll('#app div[style*=text-shadow]')];
  if(!lbls.length) return 'NO LABEL DIVS';
  const c=lbls[0].parentElement;
  const cs=getComputedStyle(c);
  const cv=document.querySelector('#app canvas');
  const cvs=cv?getComputedStyle(cv):{};
  const vis=lbls.filter(d=>getComputedStyle(d).display!=='none');
  const r=vis.length?vis[0].getBoundingClientRect():lbls[0].getBoundingClientRect();
  const dcs=getComputedStyle(vis[0]||lbls[0]);
  return JSON.stringify({
    divs:lbls.length, visibleDivs:vis.length,
    container:c.offsetWidth+'x'+c.offsetHeight+' overflow='+cs.overflow+' pos='+cs.position+' z='+cs.zIndex,
    canvas_z:cvs.zIndex+' pos='+cvs.position,
    label0:{txt:(vis[0]||lbls[0]).textContent, display:dcs.display, transform:dcs.transform.slice(0,40),
            rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width)]}
  });
})()`);
console.log(out);
ws.close(); process.exit(0);
