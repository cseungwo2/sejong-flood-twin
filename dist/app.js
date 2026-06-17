// 세종시 침수 디지털트윈 — Three.js 엔진
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import earcut from 'earcut';

const $ = s => document.querySelector(s);
const setBar = (p, msg) => { $('#lbar').style.width = (p*100|0)+'%'; if (msg) $('#lmsg').textContent = msg; };

// ---------- load data ----------
async function loadAll() {
  setBar(0.05, '지형 메타 로딩…');
  const tmeta = await fetch('./data/terrain_meta.json').then(r=>r.json());
  setBar(0.15, '지형 고도 로딩…');
  const tbuf = await fetch('./data/terrain.bin').then(r=>r.arrayBuffer());
  const theights = new Float32Array(tbuf);            // nx*ny, row 0 = north
  setBar(0.35, '건물 데이터 로딩…');
  const bgeo = await fetch('./data/buildings.geojson').then(r=>r.json());
  return { tmeta, theights, bgeo };
}

// 4326 -> local ENU meters, origin = bbox center
function makeProjector(bbox) {
  const lat0 = (bbox.north + bbox.south)/2, lon0 = (bbox.west + bbox.east)/2;
  const mLat = 111320, mLon = 111320*Math.cos(lat0*Math.PI/180);
  return {
    lat0, lon0,
    fwd: (lon,lat) => [ (lon-lon0)*mLon, (lat-lat0)*mLat ],   // [east, north] meters
  };
}

// elevation -> RGB colormap (green -> tan -> brown -> white)
function elevColor(t) { // t in 0..1
  const stops = [[0.20,[0.27,0.45,0.27]],[0.35,[0.45,0.55,0.30]],[0.55,[0.60,0.55,0.35]],
                 [0.78,[0.50,0.40,0.30]],[1.0,[0.92,0.92,0.95]]];
  let p=stops[0][1];
  for (let i=0;i<stops.length;i++){ if (t<=stops[i][0]){ const a=i?stops[i-1]:stops[0]; const b=stops[i];
    const f=(t-(i?a[0]:0))/((b[0]-(i?a[0]:0))||1); p=[0,1,2].map(k=>a[1][k]+(b[1][k]-a[1][k])*f); break; } p=stops[i][1]; }
  return p;
}

function main({ tmeta, theights, bgeo }) {
  const proj = makeProjector(tmeta.bbox);
  const { nx, ny } = tmeta, cell = tmeta.cell_m;
  const zmin = tmeta.zmin, zmax = tmeta.zmax, NODATA = tmeta.nodata;
  const VE = 2.5;   // 수직 과장(시각용). 침수심 통계는 실제 미터 사용

  // ---- scene ----
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setSize(innerWidth, innerHeight);
  $('#app').appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 5, 40000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.maxPolarAngle = Math.PI*0.495;

  scene.add(new THREE.HemisphereLight(0xbcd4f0, 0x33404d, 0.9));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.1); sun.position.set(-0.6,1,0.4); scene.add(sun);

  // ---- terrain geometry (grid) ----
  // node (i col, j row); row 0 north. local meters via bbox edges.
  const W = tmeta.bbox.east - tmeta.bbox.west, Hh = tmeta.bbox.north - tmeta.bbox.south;
  function nodeXZ(i,j){
    const lon = tmeta.bbox.west + (i/(nx-1))*W;
    const lat = tmeta.bbox.north - (j/(ny-1))*Hh;
    const [x,n] = proj.fwd(lon,lat); return [x,-n];   // world: x east, z = -north
  }
  const hAt = (i,j)=>{ const v=theights[j*nx+i]; return (v<=NODATA+1)? zmin : v; };

  // web-mercator tile frame for imagery drape
  const west=tmeta.bbox.west, north=tmeta.bbox.north;
  const merc=(lon,lat)=>{ const x=(lon+180)/360; const s=Math.sin(lat*Math.PI/180);
    return [x, 0.5-Math.log((1+s)/(1-s))/(4*Math.PI)]; };
  const Z=14, nT=2**Z;
  const [mx0,my0]=merc(tmeta.bbox.west,tmeta.bbox.north), [mx1,my1]=merc(tmeta.bbox.east,tmeta.bbox.south);
  const txmin=Math.floor(mx0*nT), txmax=Math.floor(mx1*nT), tymin=Math.floor(my0*nT), tymax=Math.floor(my1*nT);
  const nxT=txmax-txmin+1, nyT=tymax-tymin+1;

  const N = nx*ny;
  const pos=new Float32Array(N*3), col=new Float32Array(N*3), uv=new Float32Array(N*2);
  for (let j=0;j<ny;j++) for (let i=0;i<nx;i++){
    const k=(j*nx+i); const [x,z]=nodeXZ(i,j); const h=hAt(i,j);
    pos[k*3]=x; pos[k*3+1]=h*VE; pos[k*3+2]=z;
    const c=elevColor((h-zmin)/Math.max(zmax-zmin,1)); col[k*3]=c[0]; col[k*3+1]=c[1]; col[k*3+2]=c[2];
    const lon=west+(i/(nx-1))*W, lat=north-(j/(ny-1))*Hh; const [mxx,myy]=merc(lon,lat);
    uv[k*2]=(mxx*nT-txmin)/nxT; uv[k*2+1]=(myy*nT-tymin)/nyT;
  }
  const idx=[]; for (let j=0;j<ny-1;j++) for (let i=0;i<nx-1;i++){
    const a=j*nx+i,b=a+1,c=a+nx,d=c+1; idx.push(a,c,b, b,c,d);
  }
  const tg=new THREE.BufferGeometry();
  tg.setAttribute('position',new THREE.BufferAttribute(pos,3));
  tg.setAttribute('color',new THREE.BufferAttribute(col,3));
  tg.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  tg.setIndex(idx); tg.computeVertexNormals();
  const terrainMat=new THREE.MeshLambertMaterial({vertexColors:true});
  const terrain=new THREE.Mesh(tg,terrainMat); scene.add(terrain);

  // ---- drape satellite imagery (ESRI World Imagery, CORS) ----
  (function drape(){
    const TS=256, cv=document.createElement('canvas'); cv.width=nxT*TS; cv.height=nyT*TS;
    const ctx=cv.getContext('2d'); let done=0; const total=nxT*nyT, tilesDone=()=>done>=total;
    // 지적(LOT)+도로 합성 오버레이 (동일 출처 → 캔버스 오염 없음)
    const ov=new Image(); let ovReady=false;
    ov.onload=()=>{ ovReady=true; maybe(); }; ov.onerror=()=>{ ovReady=true; maybe(); }; ov.src='./data/lot_overlay.png';
    for(let tx=txmin;tx<=txmax;tx++) for(let ty=tymin;ty<=tymax;ty++){
      const im=new Image(); im.crossOrigin='anonymous'; const px=(tx-txmin)*TS, py=(ty-tymin)*TS;
      im.onload=()=>{ ctx.drawImage(im,px,py); if(++done>=total) maybe(); };
      im.onerror=()=>{ if(++done>=total) maybe(); };
      im.src=`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${ty}/${tx}`;
    }
    let applied=false;
    function maybe(){ if(tilesDone() && ovReady && !applied) apply(); }
    function apply(){ applied=true; try{
      if(ov.width){   // bbox에 맞춰 지적/도로 오버레이 합성
        const pxW=(mx0*nT-txmin)/nxT*cv.width, pxE=(mx1*nT-txmin)/nxT*cv.width;
        const pyN=(my0*nT-tymin)/nyT*cv.height, pyS=(my1*nT-tymin)/nyT*cv.height;
        ctx.drawImage(ov,0,0,ov.width,ov.height, pxW,pyN, pxE-pxW, pyS-pyN);
      }
      const tex=new THREE.CanvasTexture(cv); tex.flipY=false; tex.colorSpace=THREE.SRGBColorSpace;
      tex.anisotropy=renderer.capabilities.getMaxAnisotropy();
      terrainMat.map=tex; terrainMat.vertexColors=false; terrainMat.color.set(0xffffff); terrainMat.needsUpdate=true;
    }catch(e){ console.warn('drape failed (CORS/offline) — 표고색 유지',e); } }
  })();

  // ---- water mesh (same grid, GPU clip by terrain height) ----
  const wpos=new Float32Array(N*3), wth=new Float32Array(N);
  for (let j=0;j<ny;j++) for (let i=0;i<nx;i++){
    const k=j*nx+i; const [x,z]=nodeXZ(i,j); const v=theights[j*nx+i];
    wpos[k*3]=x; wpos[k*3+1]=0; wpos[k*3+2]=z;
    wth[k]=(v<=NODATA+1)? 1e6 : v*VE;   // nodata -> never flooded; VE-scaled
  }
  const wg=new THREE.BufferGeometry();
  wg.setAttribute('position',new THREE.BufferAttribute(wpos,3));
  wg.setAttribute('aTH',new THREE.BufferAttribute(wth,1));
  wg.setIndex(idx);
  const waterMat=new THREE.ShaderMaterial({
    uniforms:{ uW:{value:zmin}, uDeepRef:{value:8.0} },
    transparent:true, depthWrite:false, side:THREE.DoubleSide,
    vertexShader:`
      attribute float aTH; uniform float uW; varying float vDepth; varying vec3 vW;
      void main(){ vDepth = uW - aTH; vec3 p=position; p.y=uW; vW=p;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); }`,
    fragmentShader:`
      precision highp float; varying float vDepth; varying vec3 vW; uniform float uDeepRef;
      void main(){ if(vDepth<=0.02) discard;
        float t=clamp(vDepth/uDeepRef,0.0,1.0);
        vec3 shallow=vec3(0.50,0.89,1.0), deep=vec3(0.02,0.13,0.40);
        vec3 c=mix(shallow,deep,t);
        float a=mix(0.45,0.80,t);
        gl_FragColor=vec4(c,a); }`,
  });
  const water=new THREE.Mesh(wg,waterMat); water.renderOrder=2; scene.add(water);

  // ---- buildings (merged extruded mesh, GPU water-line shading) ----
  setBar(0.6,'건물 입체화…');
  const positions=[], normals=[], gzv=[]; const bGz=[]; const bcx=[], bcz=[]; let bMinX=1e18,bMaxX=-1e18,bMinZ=1e18,bMaxZ=-1e18;
  function addBuilding(rings, gz, h){
    // rings: array of [ [x,z],... ]; ring0 exterior, rest holes (already local meters)
    const gzs=gz*VE, top=(gz+h)*VE, base=(gz-5)*VE;   // base를 지반보다 낮춰 지형에 묻히지 않게
    // earcut input
    const flat=[]; const holes=[];
    rings.forEach((r,ri)=>{ if(ri>0) holes.push(flat.length/2); for(const p of r){ flat.push(p[0],p[1]); } });
    const tris=earcut(flat, holes.length?holes:null, 2);
    // top cap
    for(let t=0;t<tris.length;t+=3){
      for(const vi of [tris[t],tris[t+1],tris[t+2]]){ positions.push(flat[vi*2], top, flat[vi*2+1]); normals.push(0,1,0); gzv.push(gzs); }
    }
    // side walls
    rings.forEach(r=>{
      for(let s=0;s<r.length-1;s++){
        const a=r[s], b=r[s+1];
        const dx=b[0]-a[0], dz=b[1]-a[1]; const L=Math.hypot(dx,dz)||1; const nxn=dz/L, nzn=-dx/L;
        const q=[[a[0],base,a[1]],[b[0],base,b[1]],[b[0],top,b[1]], [a[0],base,a[1]],[b[0],top,b[1]],[a[0],top,a[1]]];
        for(const v of q){ positions.push(v[0],v[1],v[2]); normals.push(nxn,0,nzn); gzv.push(gzs); }
      }
    });
    bGz.push(gz);   // 통계용은 실제 미터
  }
  let nb=0;
  for(const f of bgeo.features){
    const g=f.geometry; if(!g) continue;
    const gz=+(f.properties.gz||zmin); const h=+(f.properties.h||3);
    const polys = g.type==='Polygon' ? [g.coordinates] : g.type==='MultiPolygon' ? g.coordinates : [];
    for(const poly of polys){
      const rings=poly.map(ring=>{ const out=ring.map(c=>{ const [x,n]=proj.fwd(c[0],c[1]); return [x,-n]; });
        // ensure closed
        if(out.length>1){ const a=out[0],b=out[out.length-1]; if(a[0]!==b[0]||a[1]!==b[1]) out.push([a[0],a[1]]); }
        return out; });
      if(rings[0] && rings[0].length>=4){ addBuilding(rings,gz,h);
        let sx=0,sz=0; for(const p of rings[0]){ sx+=p[0]; sz+=p[1];
          bMinX=Math.min(bMinX,p[0]); bMaxX=Math.max(bMaxX,p[0]); bMinZ=Math.min(bMinZ,p[1]); bMaxZ=Math.max(bMaxZ,p[1]); }
        bcx.push(sx/rings[0].length); bcz.push(sz/rings[0].length);
      }
    }
    nb++;
  }
  const bg=new THREE.BufferGeometry();
  bg.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  bg.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
  bg.setAttribute('aGz',new THREE.Float32BufferAttribute(gzv,1));
  const bldMat=new THREE.ShaderMaterial({
    uniforms:{ uW:{value:zmin}, uDeepRef:{value:8.0}, uLight:{value:new THREE.Vector3(-0.6,1,0.4).normalize()} },
    vertexShader:`
      attribute float aGz; uniform float uW; varying float vY; varying vec3 vN;
      void main(){ vY=position.y; vN=normalize(normalMatrix*normal);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:`
      precision highp float; varying float vY; varying vec3 vN; uniform float uW; uniform float uDeepRef; uniform vec3 uLight;
      void main(){ float sh=0.45+0.55*clamp(dot(normalize(vN),uLight),0.0,1.0);
        vec3 base=vec3(0.78,0.80,0.85)*sh;
        if(vY<uW){ float d=clamp((uW-vY)/uDeepRef,0.0,1.0);
          vec3 wcol=mix(vec3(0.35,0.75,0.95),vec3(0.05,0.20,0.55),d);
          base=mix(base, wcol*sh, 0.78); }
        gl_FragColor=vec4(base,1.0); }`,
  });
  const buildings=new THREE.Mesh(bg,bldMat); scene.add(buildings);
  console.log('buildings:',nb,'verts:',positions.length/3);

  // ---- stats helpers ----
  const gzSorted=Float32Array.from(bGz).sort();           // building base elevations
  const thValid=[]; for(let k=0;k<N;k++){ const v=theights[k]; if(v>NODATA+1) thValid.push(v); }
  const thSorted=Float32Array.from(thValid).sort();
  const cellArea=cell*cell;
  const lowerCount=(arr,W)=>{ let lo=0,hi=arr.length; while(lo<hi){const m=(lo+hi)>>1; if(arr[m]<W)lo=m+1; else hi=m;} return lo; };

  // ---- camera framing ----
  // 가장 건물이 밀집한 도심(세종 신도시)로 카메라 포커싱
  const G=80, gw=(bMaxX-bMinX)||1, gh=(bMaxZ-bMinZ)||1;
  const grid=new Int32Array(G*G); let best=0,bi=0;
  for(let n=0;n<bcx.length;n++){ const gx=Math.min(G-1,Math.max(0,Math.floor((bcx[n]-bMinX)/gw*G)));
    const gj=Math.min(G-1,Math.max(0,Math.floor((bcz[n]-bMinZ)/gh*G))); const id=gj*G+gx;
    if(++grid[id]>best){best=grid[id];bi=id;} }
  const fx=bMinX+((bi%G)+0.5)/G*gw, fz=bMinZ+(Math.floor(bi/G)+0.5)/G*gh;
  const view=parseFloat(new URLSearchParams(location.search).get('view'))||900;
  controls.target.set(fx, zmin*VE, fz);
  camera.position.set(fx+view*0.2, zmin*VE+view*0.75, fz+view*0.6);
  controls.update();
  console.log('focus cell', fx|0, fz|0, 'count', best);

  // ---- slider ----
  const wl=$('#wl');
  // 기준수위 EL0 = 시가지 최저 지반(강변). 슬라이더 = 그 위로 차오른 침수심(m)
  const floor=gzSorted[0], ceil=floor + 30;
  wl.min=0; wl.max=+(ceil-floor).toFixed(1); wl.step=0.1;
  const qwl=parseFloat(new URLSearchParams(location.search).get('wl'));
  wl.value=isFinite(qwl)?Math.min(qwl,+wl.max):0;
  $('#lg-max').textContent = '8+';

  function update(){
    const depth=+wl.value;            // 슬라이더 = 기준수위(최저지반) 위로 차오른 높이
    const W=floor+depth;
    waterMat.uniforms.uW.value=W*VE; bldMat.uniforms.uW.value=W*VE;
    waterMat.uniforms.uDeepRef.value=8.0*VE; bldMat.uniforms.uDeepRef.value=8.0*VE;
    $('#wl-val').textContent=depth.toFixed(1);
    $('#s-wl').textContent='EL '+W.toFixed(1)+' m';
    const nB=lowerCount(gzSorted,W);
    const maxD=nB>0 ? (W-gzSorted[0]) : 0;
    const nCell=lowerCount(thSorted,W); const areaKm2=nCell*cellArea/1e6;
    $('#s-bld').textContent=nB.toLocaleString()+' 동';
    $('#s-depth').textContent=maxD>0?maxD.toFixed(1)+' m':'–';
    $('#s-area').textContent=areaKm2.toFixed(2)+' km²';
  }
  wl.addEventListener('input',update);

  // presets
  const presets=[['평상시',0],['1 m',1],['2 m',2],['3 m',3],['5 m',5],['10 m',10]];
  const pc=$('#presets');
  presets.forEach(([lab,v])=>{ const b=document.createElement('button'); b.textContent=lab;
    b.onclick=()=>{ wl.value=Math.min(v,+wl.max); update(); }; pc.appendChild(b); });

  // ---- hover tooltip (building depth) ----
  const ray=new THREE.Raycaster(); const mouse=new THREE.Vector2(); const tip=$('#tip');
  addEventListener('pointermove',e=>{
    mouse.x=(e.clientX/innerWidth)*2-1; mouse.y=-(e.clientY/innerHeight)*2+1;
    ray.setFromCamera(mouse,camera); const hit=ray.intersectObject(buildings,false)[0];
    if(hit){ const Wv=waterMat.uniforms.uW.value; const base=hit.object.geometry.attributes.aGz.array[hit.face.a]/VE;
      const d=(Wv/VE)-base; tip.style.display='block'; tip.style.left=(e.clientX+12)+'px'; tip.style.top=(e.clientY+12)+'px';
      tip.textContent= d>0 ? `이 건물 침수심 ≈ ${d.toFixed(1)} m (지반 EL ${base.toFixed(1)})` : `미침수 (지반 EL ${base.toFixed(1)})`;
    } else tip.style.display='none';
  });

  // ---- official flood-map overlays (lazy) ----
  function hAtLonLat(lon,lat){
    const fx=(lon-tmeta.bbox.west)/W*(nx-1), fy=(tmeta.bbox.north-lat)/Hh*(ny-1);
    let i=Math.max(0,Math.min(nx-2,Math.floor(fx))), j=Math.max(0,Math.min(ny-2,Math.floor(fy)));
    const tx=fx-i, ty=fy-j, gg=(ii,jj)=>{const v=theights[jj*nx+ii]; return v<=NODATA+1?zmin:v;};
    const a=gg(i,j)*(1-tx)+gg(i+1,j)*tx, b=gg(i,j+1)*(1-tx)+gg(i+1,j+1)*tx; return a*(1-ty)+b*ty;
  }
  const OVR=[['river_100','100년 빈도 국가하천 범람',0xffd24a],['river_200','200년 빈도 국가하천 범람',0xff9e3d],
             ['river_500','500년 빈도 국가하천 범람',0xff5e5e],['river_max','기왕최대 하천범람',0xc060ff],
             ['urban_max','기왕최대 도시침수',0x43c6ff]];
  const ovrCache={}, ovrMesh={};
  async function toggleOverlay(key,btn,color){
    if(ovrMesh[key]){ scene.remove(ovrMesh[key]); ovrMesh[key].geometry.dispose(); delete ovrMesh[key]; btn.classList.remove('on'); return; }
    btn.classList.add('on'); const orig=btn.textContent; btn.textContent='…';
    let gj=ovrCache[key]; if(!gj){ gj=await fetch(`./data/flood/${key}.geojson`).then(r=>r.json()); ovrCache[key]=gj; }
    const pos=[], idx=[]; let off=0;
    for(const f of gj.features){ const g=f.geometry; if(!g) continue;
      const polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
      for(const poly of polys){ const flat=[], holes=[], vy=[];
        poly.forEach((ring,ri)=>{ if(ri>0) holes.push(flat.length/2);
          for(const c of ring){ const [x,n]=proj.fwd(c[0],c[1]); flat.push(x,-n); vy.push(hAtLonLat(c[0],c[1])*VE+1.5); } });
        const tris=earcut(flat, holes.length?holes:null, 2);
        for(let v=0;v<vy.length;v++){ pos.push(flat[v*2], vy[v], flat[v*2+1]); }
        for(const t of tris) idx.push(off+t); off+=vy.length;
      }
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); geo.setIndex(idx);
    const m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.42,depthWrite:false,side:THREE.DoubleSide}));
    m.renderOrder=3; scene.add(m); ovrMesh[key]=m; btn.textContent=orig;
  }
  const ob=$('#overlays');
  OVR.forEach(([k,lab,c])=>{ const b=document.createElement('button'); b.textContent=lab;
    b.style.setProperty('--dot','#'+c.toString(16).padStart(6,'0')); b.onclick=()=>toggleOverlay(k,b,c).catch(e=>{b.textContent=lab;console.error(e);}); ob.appendChild(b); });
  const qovr=new URLSearchParams(location.search).get('ovr');
  if(qovr){ const it=OVR.find(o=>o[0]===qovr); if(it){ const btn=[...ob.children].find(x=>x.textContent===it[1]); toggleOverlay(it[0],btn,it[2]); } }

  update();
  $('#loading').style.display='none';

  addEventListener('resize',()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth,innerHeight); });
  (function loop(){ requestAnimationFrame(loop); controls.update(); renderer.render(scene,camera); })();
}

loadAll().then(main).catch(e=>{ console.error(e); $('#lmsg').textContent='오류: '+e.message; });
