// 세종시 침수 디지털트윈 — Three.js 엔진
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import earcut from 'earcut';
import { listScenarios, getScenario } from './sd/scenario.js';

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
  setBar(0.45, 'HAND(하천기준 고도) 로딩…');
  const hbuf = await fetch('./data/hand.bin').then(r=>r.arrayBuffer());
  const hand = new Float32Array(hbuf);            // nx*ny, row 0 = north, 99999=배수 안됨
  return { tmeta, theights, hand, bgeo };
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

function main({ tmeta, theights, hand, bgeo }) {
  const proj = makeProjector(tmeta.bbox);
  const { nx, ny } = tmeta, cell = tmeta.cell_m;
  const zmin = tmeta.zmin, zmax = tmeta.zmax, NODATA = tmeta.nodata;
  // 수직 과장(시각용). 침수심 통계는 실제 미터 사용. URL ?ve=1.5 로 즉석 조절, 기본=실제축척 1.0
  const VE = (()=>{ const q=parseFloat(new URLSearchParams(location.search).get('ve')); return isFinite(q)?q:1.0; })();

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
  const pos=new Float32Array(N*3), col=new Float32Array(N*3), uv=new Float32Array(N*2), muv=new Float32Array(N*2);
  for (let j=0;j<ny;j++) for (let i=0;i<nx;i++){
    const k=(j*nx+i); const [x,z]=nodeXZ(i,j); const h=hAt(i,j);
    pos[k*3]=x; pos[k*3+1]=h*VE; pos[k*3+2]=z;
    const c=elevColor((h-zmin)/Math.max(zmax-zmin,1)); col[k*3]=c[0]; col[k*3+1]=c[1]; col[k*3+2]=c[2];
    const lon=west+(i/(nx-1))*W, lat=north-(j/(ny-1))*Hh; const [mxx,myy]=merc(lon,lat);
    uv[k*2]=(mxx*nT-txmin)/nxT; uv[k*2+1]=(myy*nT-tymin)/nyT;
    muv[k*2]=i/(nx-1); muv[k*2+1]=j/(ny-1);   // 세종 경계 마스크 UV(bbox 선형, v=0 북)
  }
  const idx=[]; for (let j=0;j<ny-1;j++) for (let i=0;i<nx-1;i++){
    const a=j*nx+i,b=a+1,c=a+nx,d=c+1; idx.push(a,c,b, b,c,d);
  }
  const tg=new THREE.BufferGeometry();
  tg.setAttribute('position',new THREE.BufferAttribute(pos,3));
  tg.setAttribute('color',new THREE.BufferAttribute(col,3));
  tg.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  tg.setAttribute('aMaskUv',new THREE.BufferAttribute(muv,2));
  tg.setIndex(idx); tg.computeVertexNormals();
  // 세종시 행정경계 마스크 — 경계 밖 픽셀 discard(지형+위성영상 동시 클리핑)
  const maskTex=new THREE.TextureLoader().load('./data/sejong_mask.png?v=1', ()=>{ maskU.uMaskOn.value=1.0; });
  maskTex.flipY=false; maskTex.generateMipmaps=false; maskTex.minFilter=THREE.LinearFilter; maskTex.magFilter=THREE.LinearFilter;
  const maskU={ uMask:{value:maskTex}, uMaskOn:{value:0.0} };
  const terrainMat=new THREE.MeshLambertMaterial({vertexColors:true});
  terrainMat.onBeforeCompile=(sh)=>{
    sh.uniforms.uMask=maskU.uMask; sh.uniforms.uMaskOn=maskU.uMaskOn;
    sh.vertexShader='attribute vec2 aMaskUv;\nvarying vec2 vMaskUv;\n'+
      sh.vertexShader.replace('void main() {','void main() {\n\tvMaskUv=aMaskUv;');
    sh.fragmentShader='varying vec2 vMaskUv;\nuniform sampler2D uMask;\nuniform float uMaskOn;\n'+
      sh.fragmentShader.replace('void main() {','void main() {\n\tif(uMaskOn>0.5 && texture2D(uMask,vMaskUv).r<0.5) discard;');
  };
  const terrain=new THREE.Mesh(tg,terrainMat); scene.add(terrain);

  // ---- drape satellite imagery (ESRI World Imagery, CORS) ----
  (function drape(){
    const TS=256, cv=document.createElement('canvas'); cv.width=nxT*TS; cv.height=nyT*TS;
    const ctx=cv.getContext('2d'); let done=0; const total=nxT*nyT, tilesDone=()=>done>=total;
    // 지적(LOT)+도로 합성 오버레이 (동일 출처 → 캔버스 오염 없음)
    const ov=new Image(); let ovReady=false;
    ov.onload=()=>{ ovReady=true; maybe(); }; ov.onerror=()=>{ ovReady=true; maybe(); }; ov.src='./data/lot_overlay.png?v=roads3';
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

  // ---- water mesh (HAND 모델: 슬라이더 = 하천 위로 차오른 수심, 하천별로 동시 침수) ----
  // aTH=지형고도(VE), aHAND=가까운 하천보다 높은 정도(VE). 침수심 = uS - aHAND, 수면 = 지형 + max(침수심,0)
  const BIG=1e6;
  const wpos=new Float32Array(N*3), wth=new Float32Array(N), whd=new Float32Array(N);
  for (let j=0;j<ny;j++) for (let i=0;i<nx;i++){
    const k=j*nx+i; const [x,z]=nodeXZ(i,j); const v=theights[k]; const hd=hand[k];
    wpos[k*3]=x; wpos[k*3+1]=0; wpos[k*3+2]=z;
    wth[k]=(v<=NODATA+1)? zmin*VE : v*VE;                       // 지형고도
    whd[k]=(v<=NODATA+1 || hd>=99998)? BIG : hd*VE;             // HAND (배수 안되면 BIG → 영원히 안잠김)
  }
  const wg=new THREE.BufferGeometry();
  wg.setAttribute('position',new THREE.BufferAttribute(wpos,3));
  wg.setAttribute('aTH',new THREE.BufferAttribute(wth,1));
  wg.setAttribute('aHAND',new THREE.BufferAttribute(whd,1));
  wg.setIndex(idx);
  const waterMat=new THREE.ShaderMaterial({
    uniforms:{ uS:{value:0.0}, uDeepRef:{value:8.0*VE} },
    transparent:true, depthWrite:false, side:THREE.DoubleSide,
    polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4,
    vertexShader:`
      attribute float aTH; attribute float aHAND; uniform float uS; varying float vDepth;
      void main(){ float d = uS - aHAND; vDepth = d;
        vec3 p=position; p.y = aTH + max(d, 0.0);     // 잠긴 곳만 지형 위로 수면 상승
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); }`,
    fragmentShader:`
      precision highp float; varying float vDepth; uniform float uDeepRef;
      void main(){ if(vDepth<=0.0) discard;
        float t=clamp(vDepth/uDeepRef,0.0,1.0);
        vec3 shallow=vec3(0.50,0.89,1.0), deep=vec3(0.02,0.13,0.40);
        vec3 c=mix(shallow,deep,t);
        float edge=smoothstep(0.0,0.35,vDepth);   // 얕은 가장자리 부드럽게 페이드(어색함 완화)
        float a=mix(0.42,0.82,t)*edge;
        gl_FragColor=vec4(c,a); }`,
  });
  const water=new THREE.Mesh(wg,waterMat); water.renderOrder=2; scene.add(water);

  // ---- buildings (merged extruded mesh, GPU water-line shading) ----
  setBar(0.6,'건물 입체화…');
  // 건물 위치의 격자 샘플러 — HAND(하천기준 높이)와 지형고도(렌더 지형에 건물 안착용)
  function gridIJ(lon,lat){
    const fx=(lon-tmeta.bbox.west)/W*(nx-1), fy=(tmeta.bbox.north-lat)/Hh*(ny-1);
    return [Math.max(0,Math.min(nx-1,Math.round(fx))), Math.max(0,Math.min(ny-1,Math.round(fy)))];
  }
  function sampleHand(lon,lat){ const [i,j]=gridIJ(lon,lat); const hd=hand[j*nx+i]; return hd>=99998? 1e6 : hd; }
  function sampleTerr(lon,lat){ const [i,j]=gridIJ(lon,lat); const v=theights[j*nx+i]; return v<=NODATA+1? zmin : v; }
  // 건물 용도(USABILITY 건축법 별표1) → 카테고리(도시계획 표준색). 0:미상 1:주거 2:상업·근생 3:공업 4:물류 5:농업 6:공공
  const USE_CAT={'01000':1,'02000':1,'03000':2,'04000':2,'05000':6,'06000':6,'07000':2,'08000':6,'09000':6,'10000':6,'11000':6,'12000':6,'13000':6,'14000':2,'15000':2,'16000':2,'17000':3,'18000':4,'19000':3,'20000':4,'21000':5,'22000':4,'23000':6,'24000':6,'25000':3,'26000':0,'27000':2,'28000':6,'29000':5,'30000':0};
  const CAT_NAME=['용도 미상','주거','상업·근생','공업','창고·물류','농업·동식물','공공·교육'];
  const positions=[], normals=[], gzv=[], drainv=[], usecatv=[]; const bGz=[], bHand=[]; const bcx=[], bcz=[]; let bMinX=1e18,bMaxX=-1e18,bMinZ=1e18,bMaxZ=-1e18;
  function addBuilding(rings, gz, h, drainElev, cat){
    // rings: array of [ [x,z],... ]; ring0 exterior, rest holes (already local meters)
    const gzs=gz*VE, top=(gz+h)*VE, base=(gz-5)*VE;   // base를 지반보다 낮춰 지형에 묻히지 않게
    const dr=drainElev*VE;                            // 이 건물의 하천기준 수면 시작고도(VE)
    // earcut input
    const flat=[]; const holes=[];
    rings.forEach((r,ri)=>{ if(ri>0) holes.push(flat.length/2); for(const p of r){ flat.push(p[0],p[1]); } });
    const tris=earcut(flat, holes.length?holes:null, 2);
    // top cap
    for(let t=0;t<tris.length;t+=3){
      for(const vi of [tris[t],tris[t+1],tris[t+2]]){ positions.push(flat[vi*2], top, flat[vi*2+1]); normals.push(0,1,0); gzv.push(gzs); drainv.push(dr); usecatv.push(cat); }
    }
    // side walls
    rings.forEach(r=>{
      for(let s=0;s<r.length-1;s++){
        const a=r[s], b=r[s+1];
        const dx=b[0]-a[0], dz=b[1]-a[1]; const L=Math.hypot(dx,dz)||1; const nxn=dz/L, nzn=-dx/L;
        const q=[[a[0],base,a[1]],[b[0],base,b[1]],[b[0],top,b[1]], [a[0],base,a[1]],[b[0],top,b[1]],[a[0],top,a[1]]];
        for(const v of q){ positions.push(v[0],v[1],v[2]); normals.push(nxn,0,nzn); gzv.push(gzs); drainv.push(dr); usecatv.push(cat); }
      }
    });
    bGz.push(gz); bHand.push(gz-drainElev);   // 건물 HAND = 지반 - 수면시작고도
  }
  let nb=0;
  for(const f of bgeo.features){
    const g=f.geometry; if(!g) continue;
    const h=+(f.properties.h||3); const cat=USE_CAT[(f.properties.use||'').trim()]||0;
    const polys = g.type==='Polygon' ? [g.coordinates] : g.type==='MultiPolygon' ? g.coordinates : [];
    for(const poly of polys){
      const r0=poly[0]; let slon=0,slat=0; for(const c of r0){ slon+=c[0]; slat+=c[1]; }
      const clon=slon/r0.length, clat=slat/r0.length;
      const ground=sampleTerr(clon,clat);          // 렌더 지형 높이에 안착(박힘/뜸 방지)
      const handB=sampleHand(clon,clat);           // 이 건물 위치의 HAND
      const rings=poly.map(ring=>{ const out=ring.map(c=>{ const [x,n]=proj.fwd(c[0],c[1]); return [x,-n]; });
        // ensure closed
        if(out.length>1){ const a=out[0],b=out[out.length-1]; if(a[0]!==b[0]||a[1]!==b[1]) out.push([a[0],a[1]]); }
        return out; });
      if(rings[0] && rings[0].length>=4){ addBuilding(rings,ground,h, ground-handB, cat);
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
  bg.setAttribute('aDrain',new THREE.Float32BufferAttribute(drainv,1));
  bg.setAttribute('aUseCat',new THREE.Float32BufferAttribute(usecatv,1));
  // 카테고리 색(도시계획 표준): 미상=회색, 주거=노랑, 상업=빨강, 공업=보라, 물류=연보라, 농업=초록, 공공=파랑
  const CAT_COL=[new THREE.Vector3(0.60,0.64,0.69),new THREE.Vector3(1.0,0.85,0.30),new THREE.Vector3(0.91,0.33,0.30),
                 new THREE.Vector3(0.61,0.44,0.71),new THREE.Vector3(0.74,0.64,0.82),new THREE.Vector3(0.50,0.78,0.42),
                 new THREE.Vector3(0.31,0.64,0.88),new THREE.Vector3(0.42,0.79,0.75)];
  const bldMat=new THREE.ShaderMaterial({
    uniforms:{ uS:{value:0.0}, uDeepRef:{value:8.0*VE}, uLight:{value:new THREE.Vector3(-0.6,1,0.4).normalize()},
               uUseMode:{value:0.0}, uPal:{value:CAT_COL} },
    side:THREE.DoubleSide,   // 지붕/벽 삼각형 뒷면 컬링 방지(지붕 안 덮히는 문제 해결)
    vertexShader:`
      attribute float aGz; attribute float aDrain; attribute float aUseCat; uniform float uS;
      varying float vY; varying float vWl; varying float vCat; varying vec3 vN;
      void main(){ vY=position.y; vWl=aDrain+uS; vCat=aUseCat;
        vN=normalize(normalMatrix*normal);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:`
      precision highp float; varying float vY; varying float vWl; varying float vCat; varying vec3 vN;
      uniform float uDeepRef; uniform vec3 uLight; uniform float uUseMode; uniform vec3 uPal[8];
      void main(){ float sh=0.45+0.55*clamp(dot(normalize(vN),uLight),0.0,1.0);
        vec3 dft=vec3(0.78,0.80,0.85);
        vec3 ucol=uPal[int(vCat+0.5)];
        vec3 base=mix(dft, ucol, uUseMode)*sh;     // 용도색 토글
        if(vY<vWl){ float d=clamp((vWl-vY)/uDeepRef,0.0,1.0);
          vec3 wcol=mix(vec3(0.35,0.75,0.95),vec3(0.05,0.20,0.55),d);
          base=mix(base, wcol*sh, 0.78); }
        gl_FragColor=vec4(base,1.0); }`,
  });
  const buildings=new THREE.Mesh(bg,bldMat); scene.add(buildings);
  console.log('buildings:',nb,'verts:',positions.length/3);

  // ---- stats helpers (HAND 기준) ----
  // 셀/건물의 HAND(가까운 하천보다 높은 정도, m). 배수 안되는 값(99999)은 제외.
  const handValid=[]; for(let k=0;k<N;k++){ const v=theights[k], hd=hand[k]; if(v>NODATA+1 && hd<99998) handValid.push(hd); }
  const handSorted=Float32Array.from(handValid).sort();
  const handBsorted=Float32Array.from(bHand.filter(x=>x<99998)).sort();
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

  // ---- slider ---- 슬라이더 = 하천 수면이 평소보다 차오른 높이(m). 국가/지방/소하천 동시 적용
  const wl=$('#wl');
  wl.min=0; wl.max=15; wl.step=0.05;   // 0~15m (극한 대비), 0.05m 미세조정
  const qwl=parseFloat(new URLSearchParams(location.search).get('wl'));
  wl.value=isFinite(qwl)?Math.min(qwl,+wl.max):0;
  $('#lg-max').textContent = '8+';

  let targetS=0, dispS=0;
  function applyS(S){                 // 실제 적용(수위 S에서 셰이더·통계 갱신)
    waterMat.uniforms.uS.value=S*VE; bldMat.uniforms.uS.value=S*VE;
    $('#wl-val').textContent=S.toFixed(1);
    $('#s-wl').textContent='하천 +'+S.toFixed(1)+' m';
    const nCell=lowerCount(handSorted,S); const areaKm2=nCell*cellArea/1e6;
    const nB=lowerCount(handBsorted,S);
    const maxD=nCell>0 ? (S - handSorted[0]) : 0;
    $('#s-bld').textContent=nB.toLocaleString()+' 동';
    $('#s-depth').textContent=maxD>0?maxD.toFixed(1)+' m':'–';
    $('#s-area').textContent=areaKm2.toFixed(2)+' km²';
  }
  function update(){ targetS=+wl.value; }   // 목표 수위만 갱신 → 루프에서 부드럽게 수렴(갑자기 띵 방지)
  wl.addEventListener('input',update);
  applyS(0);

  // presets
  const presets=[['평상시',0],['0.5 m',0.5],['1 m',1],['3 m',3],['6 m',6],['10 m',10]];
  const pc=$('#presets');
  presets.forEach(([lab,v])=>{ const b=document.createElement('button'); b.textContent=lab;
    b.onclick=()=>{ wl.value=Math.min(v,+wl.max); update(); }; pc.appendChild(b); });

  // ---- SD 시나리오 타임라인 ----
  const scnSel=$('#scn-sel'), scnPlay=$('#scn-play'), scnTime=$('#scn-time'), scnTL=$('#scn-tlabel');
  let activeScn=null, len=0, tpos=0, playing=false, lastT=0, speed=1;
  const lerpA=(a,i)=>{ if(!a||!a.length) return 0; const k=Math.max(0,Math.min(a.length-1,i));
    const lo=Math.floor(k), hi=Math.min(a.length-1,lo+1); return a[lo]+(a[hi]-a[lo])*(k-lo); };

  function refreshScnList(sel){
    const names=Object.keys(listScenarios());
    scnSel.innerHTML='<option value="">— 수동 조작 —</option>'+
      names.map(n=>`<option value="${n.replace(/"/g,'&quot;')}">${n}</option>`).join('');
    if(sel) scnSel.value=sel;
  }
  function showRisk(rk){
    const wrap=$('#risk-wrap');
    if(rk==null||isNaN(rk)){ wrap.style.display='none'; return; }
    wrap.style.display='block';
    const pct=Math.max(0,Math.min(1,rk))*100;
    const fill=$('#risk-fill'); fill.style.width=pct.toFixed(0)+'%';
    const col= rk<0.33?'#46e3b1': rk<0.66?'#ffd24a':'#ff5e5e';
    fill.style.background=col;
    $('#risk-val').textContent=rk.toFixed(2); $('#risk-val').style.color=col;
    $('#risk-lvl').textContent= rk<0.33?'안전':rk<0.66?'주의':'위험';
  }
  function applyScn(){
    if(!activeScn) return;
    const depth=lerpA(activeScn.waterLevel,tpos);
    wl.value=Math.min(Math.max(depth,0),+wl.max); update();
    showRisk(activeScn.risk&&activeScn.risk.length? lerpA(activeScn.risk,tpos): null);
    scnTime.value=tpos;
    const t=lerpA(activeScn.t,tpos), tEnd=activeScn.t[activeScn.t.length-1];
    scnTL.textContent='t '+t.toFixed(0)+' / '+tEnd;
  }
  function activate(scn){
    activeScn=scn; len=scn.t.length; tpos=0; speed=(len-1)/12||1;
    scnTime.min=0; scnTime.max=len-1; scnTime.step=0.05; scnTime.disabled=false;
    wl.disabled=true; applyScn();
  }
  function deactivate(){
    activeScn=null; playing=false; scnPlay.textContent='▶';
    scnTime.disabled=true; scnTime.value=0; wl.disabled=false;
    showRisk(null); scnTL.textContent='t –';
  }
  function tick(now){
    if(!playing) return;
    if(lastT){ tpos+=(now-lastT)/1000*speed;
      if(tpos>=len-1){ tpos=len-1; playing=false; scnPlay.textContent='▶'; }
      applyScn(); }
    lastT=now; if(playing) requestAnimationFrame(tick);
  }
  scnSel.addEventListener('change',()=>{ const n=scnSel.value;
    if(!n){ deactivate(); return; } const s=getScenario(n); if(s) activate(s); else deactivate(); });
  scnPlay.addEventListener('click',()=>{ if(!activeScn) return;
    playing=!playing; scnPlay.textContent=playing?'❚❚':'▶';
    if(playing){ if(tpos>=len-1) tpos=0; lastT=0; requestAnimationFrame(tick); } });
  scnTime.addEventListener('input',()=>{ if(!activeScn) return;
    playing=false; scnPlay.textContent='▶'; tpos=+scnTime.value; applyScn(); });

  refreshScnList();
  // 편집기(다른 탭)에서 시나리오 저장 시 목록 자동 갱신
  addEventListener('storage', e=>{ if(e.key==='redilab-scenarios') refreshScnList(scnSel.value); });
  // URL ?scenario=NAME → 자동 선택/재생 (localStorage 우선, 없으면 파일 폴백)
  (async()=>{
    const q=new URLSearchParams(location.search).get('scenario'); if(!q) return;
    let scn=getScenario(q);
    if(!scn){ try{ scn=await fetch('./data/scenarios/'+encodeURIComponent(q)+'.json').then(r=>r.ok?r.json():null);}catch{} }
    if(scn){ if(![...scnSel.options].some(o=>o.value===q)){ const o=document.createElement('option'); o.value=q; o.textContent=q; scnSel.appendChild(o);}
      scnSel.value=q; activate(scn);
      playing=true; scnPlay.textContent='❚❚'; lastT=0; requestAnimationFrame(tick); }
  })();

  // ---- hover tooltip (building depth) ----
  const ray=new THREE.Raycaster(); const mouse=new THREE.Vector2(); const tip=$('#tip');
  addEventListener('pointermove',e=>{
    mouse.x=(e.clientX/innerWidth)*2-1; mouse.y=-(e.clientY/innerHeight)*2+1;
    ray.setFromCamera(mouse,camera); const hit=ray.intersectObject(buildings,false)[0];
    if(hit){ const at=hit.object.geometry.attributes, fa=hit.face.a;
      const ag=at.aGz.array[fa], adr=at.aDrain.array[fa];
      const cat=at.aUseCat?(at.aUseCat.array[fa]|0):0;
      const base=ag/VE, d=(waterMat.uniforms.uS.value - ag + adr)/VE;
      tip.style.display='block'; tip.style.left=(e.clientX+12)+'px'; tip.style.top=(e.clientY+12)+'px';
      const dep = d>0 ? `침수 ${d.toFixed(1)}m 잠김` : `안 잠김`;
      tip.textContent= `${CAT_NAME[cat]||'용도 미상'} · ${dep} · 지반 ${base.toFixed(0)}m`;
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
             ['river_500','500년 빈도 국가하천 범람',0xff5e5e],
             ['urban_30','30년 빈도 도시침수',0xff5c8a],['urban_50','50년 빈도 도시침수',0xe5383b],
             ['urban_80','80년 빈도 도시침수',0xb5179e],['urban_100','100년 빈도 도시침수',0x9d0208],
             ['urban_500','500년 빈도 도시침수',0x6a040f]];
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
    const m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color,transparent:true,opacity:0.6,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4}));
    m.renderOrder=3; scene.add(m); ovrMesh[key]=m; btn.textContent=orig;
  }
  const ob=$('#overlays');
  OVR.forEach(([k,lab,c])=>{ const b=document.createElement('button'); b.textContent=lab;
    b.style.setProperty('--dot','#'+c.toString(16).padStart(6,'0')); b.onclick=()=>toggleOverlay(k,b,c).catch(e=>{b.textContent=lab;console.error(e);}); ob.appendChild(b); });
  const qovr=new URLSearchParams(location.search).get('ovr');
  if(qovr){ const it=OVR.find(o=>o[0]===qovr); if(it){ const btn=[...ob.children].find(x=>x.textContent===it[1]); toggleOverlay(it[0],btn,it[2]); } }

  // ---- 하천망 · 등급별 기본 수심 평상시 수면(반투명 물색 + 가장자리선, z-fighting 방지) ----
  const RIVER_COLOR={'국가하천':0x1f86d0,'지방하천':0x49b0e6,'소하천':0x8fe3ea};
  const RIVERS=[['rivers','하천구역 (국가 2.5m·지방 1.5m)',0x49b0e6],['streams','소하천구역 (0.7m)',0x8fe3ea]];
  const rvCache={}, rvMesh={};
  async function toggleRiver(key,btn){
    if(rvMesh[key]){ const grp=rvMesh[key]; scene.remove(grp); grp.traverse(o=>{o.geometry&&o.geometry.dispose(); o.material&&o.material.dispose();}); delete rvMesh[key]; btn.classList.remove('on'); return; }
    btn.classList.add('on'); const orig=btn.textContent; btn.textContent='…';
    let gj=rvCache[key]; if(!gj){ gj=await fetch(`./data/rivers/${key}.geojson`).then(r=>r.json()); rvCache[key]=gj; }
    const pos=[], col=[], idx=[], lpos=[], lcol=[]; let off=0; const c=new THREE.Color(), e=new THREE.Color();
    for(const f of gj.features){ const g=f.geometry; if(!g) continue;
      c.setHex(RIVER_COLOR[f.properties&&f.properties.grade]||0x8fe3ea); e.copy(c).multiplyScalar(0.45);
      const polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
      for(const poly of polys){ const flat=[], holes=[], vy=[];
        poly.forEach((ring,ri)=>{ if(ri>0) holes.push(flat.length/2);
          const base=flat.length/2, cnt=ring.length;
          for(const cc of ring){ const [x,n]=proj.fwd(cc[0],cc[1]); flat.push(x,-n); vy.push(hAtLonLat(cc[0],cc[1])*VE+0.5); }
          for(let v=0;v<cnt;v++){ const a=base+v, b=base+((v+1)%cnt);   // 닫힌 가장자리선
            lpos.push(flat[a*2],vy[a],flat[a*2+1], flat[b*2],vy[b],flat[b*2+1]);
            lcol.push(e.r,e.g,e.b, e.r,e.g,e.b); }
        });
        const tris=earcut(flat, holes.length?holes:null, 2);
        for(let v=0;v<vy.length;v++){ pos.push(flat[v*2], vy[v], flat[v*2+1]); col.push(c.r,c.g,c.b); }
        for(const t of tris) idx.push(off+t); off+=vy.length;
      }
    }
    const grp=new THREE.Group();
    const fgeo=new THREE.BufferGeometry();
    fgeo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    fgeo.setAttribute('color',new THREE.Float32BufferAttribute(col,3)); fgeo.setIndex(idx);
    const fmat=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:0.62,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4});
    const fill=new THREE.Mesh(fgeo,fmat); fill.renderOrder=4; grp.add(fill);
    const lgeo=new THREE.BufferGeometry();
    lgeo.setAttribute('position',new THREE.Float32BufferAttribute(lpos,3));
    lgeo.setAttribute('color',new THREE.Float32BufferAttribute(lcol,3));
    const lmat=new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:0.5,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-6,polygonOffsetUnits:-6});
    const lines=new THREE.LineSegments(lgeo,lmat); lines.renderOrder=5; grp.add(lines);
    scene.add(grp); rvMesh[key]=grp; btn.textContent=orig;
  }
  const rb=$('#rivers');
  RIVERS.forEach(([k,lab,c])=>{ const b=document.createElement('button'); b.textContent=lab;
    b.style.setProperty('--dot','#'+c.toString(16).padStart(6,'0'));
    b.onclick=()=>toggleRiver(k,b).catch(e=>{b.textContent=lab;console.error(e);}); rb.appendChild(b);
    toggleRiver(k,b).catch(e=>console.error(e)); });   // 기본 ON

  // ---- 이름 라벨(읍면동·하천) CSS2D 텍스트, 토글 on/off ----
  const labelRenderer=new CSS2DRenderer();
  labelRenderer.setSize(innerWidth,innerHeight);   // width/height 설정 — 아래서 cssText로 덮어쓰면 안됨(라벨 잘림)
  { const el=labelRenderer.domElement; el.style.position='absolute'; el.style.top='0'; el.style.left='0'; el.style.pointerEvents='none'; }
  $('#app').appendChild(labelRenderer.domElement);
  const emdGroup=new THREE.Group(), rivGroup=new THREE.Group();
  scene.add(emdGroup,rivGroup);
  const labelState={emd:false, riv:false};   // CSS2DRenderer가 그룹 가시성 무시 → 라벨 개별 visible로 제어
  const LBL_COLOR={'국가하천':'#7fd0ff','지방하천':'#9ad6ff','소하천':'#bdeef2'};
  function mkLabel(text,color,size,weight){
    const d=document.createElement('div'); d.textContent=text;
    d.style.cssText=`font:${weight} ${size}px/1.1 system-ui,sans-serif;color:${color};white-space:nowrap;`+
      'text-shadow:0 1px 2px #000,0 0 5px rgba(0,0,0,.9);pointer-events:none;';
    return new CSS2DObject(d);
  }
  fetch('./data/labels.json').then(r=>r.json()).then(L=>{
    for(const e of (L.emd||[])){ const o=mkLabel(e.name,'#ffe9a8',14,'700');
      const [x,n]=proj.fwd(e.lon,e.lat); o.position.set(x, hAtLonLat(e.lon,e.lat)*VE+6, -n); o.visible=labelState.emd; emdGroup.add(o); }
    for(const r of (L.rivers||[])){ const o=mkLabel(r.name, LBL_COLOR[r.grade]||'#bdeef2',12,'600');
      const [x,n]=proj.fwd(r.lon,r.lat); o.position.set(x, hAtLonLat(r.lon,r.lat)*VE+2, -n); o.visible=labelState.riv; rivGroup.add(o); }
  }).catch(e=>console.error('labels',e));
  const lb=$('#labels');
  [['읍면동 이름','emd',emdGroup,'#ffe9a8'],['하천 이름','riv',rivGroup,'#9ad6ff']].forEach(([lab,key,grp,c])=>{
    const b=document.createElement('button'); b.textContent=lab; b.style.setProperty('--dot',c);
    b.onclick=()=>{ labelState[key]=!labelState[key]; grp.children.forEach(o=>o.visible=labelState[key]); b.classList.toggle('on',labelState[key]); };
    lb.appendChild(b); });

  // ---- 교량·고가도로 (OSM, 양끝 지형고 직선연결 → 도로에 이어지고 강/계곡 위로 부상) ----
  let bridgeMesh=null, bridgeData=null;
  async function toggleBridges(btn){
    if(bridgeMesh){ scene.remove(bridgeMesh); bridgeMesh.geometry.dispose(); bridgeMesh.material.dispose(); bridgeMesh=null; btn.classList.remove('on'); return; }
    btn.classList.add('on'); const orig=btn.textContent; btn.textContent='…';
    if(!bridgeData) bridgeData=await fetch('./data/bridges.json').then(r=>r.json());
    const pos=[], nor=[], idx=[]; let off=0;
    for(const br of bridgeData.bridges){
      const cs=br.coords; if(cs.length<2) continue; const hw=(br.w||8)*0.5;
      const wpts=cs.map(c=>{ const [x,n]=proj.fwd(c[0],c[1]); return [x,-n]; });
      let total=0; const dist=[0];
      for(let i=1;i<wpts.length;i++){ total+=Math.hypot(wpts[i][0]-wpts[i-1][0],wpts[i][1]-wpts[i-1][1]); dist.push(total); }
      const e0=sampleTerr(cs[0][0],cs[0][1]), e1=sampleTerr(cs[cs.length-1][0],cs[cs.length-1][1]);
      for(let i=0;i<wpts.length;i++){
        const f=total?dist[i]/total:0, y=(e0+(e1-e0)*f+1.0)*VE;   // 양끝 도로면 직선연결(+1m 노면)
        const a=wpts[Math.max(0,i-1)], b=wpts[Math.min(wpts.length-1,i+1)];
        let dx=b[0]-a[0], dz=b[1]-a[1]; const L=Math.hypot(dx,dz)||1; dx/=L; dz/=L;
        const px=-dz*hw, pz=dx*hw;
        pos.push(wpts[i][0]+px,y,wpts[i][1]+pz, wpts[i][0]-px,y,wpts[i][1]-pz); nor.push(0,1,0,0,1,0);
      }
      for(let i=0;i<wpts.length-1;i++){ const a=off+i*2; idx.push(a,a+1,a+2, a+1,a+3,a+2); }
      off+=wpts.length*2;
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3)); g.setIndex(idx);
    bridgeMesh=new THREE.Mesh(g,new THREE.MeshLambertMaterial({color:0xa6adb5,side:THREE.DoubleSide}));
    scene.add(bridgeMesh); btn.textContent=orig;
  }
  const bbtn=document.createElement('button'); bbtn.textContent='교량·고가도로'; bbtn.style.setProperty('--dot','#c2cad3');
  bbtn.onclick=()=>toggleBridges(bbtn).catch(e=>{bbtn.textContent='교량·고가도로';console.error(e);});
  $('#bridges').appendChild(bbtn);
  toggleBridges(bbtn).catch(e=>console.error(e));   // 기본 ON

  // 건물 용도별 색 토글(기본 OFF) + 범례
  const ubtn=document.createElement('button'); ubtn.textContent='건물 용도별 색'; ubtn.style.setProperty('--dot','#ffd84d');
  ubtn.onclick=()=>{ const on=bldMat.uniforms.uUseMode.value<0.5; bldMat.uniforms.uUseMode.value=on?1.0:0.0; ubtn.classList.toggle('on',on); };
  $('#buildinguse').appendChild(ubtn);
  const ul=$('#uselegend'); if(ul){ ul.style.cssText='display:flex;flex-wrap:wrap;gap:3px 9px;margin-top:7px;';
    [[1,'주거'],[2,'상업·근생'],[3,'공업'],[4,'창고·물류'],[5,'농업'],[6,'공공·교육']].forEach(([cat,nm])=>{
      const c=CAT_COL[cat], s=document.createElement('span');
      s.style.cssText='display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--muted);';
      s.innerHTML=`<i style="width:9px;height:9px;border-radius:2px;display:inline-block;background:rgb(${(c.x*255)|0},${(c.y*255)|0},${(c.z*255)|0})"></i>${nm}`;
      ul.appendChild(s); }); }

  update();
  $('#loading').style.display='none';

  addEventListener('resize',()=>{ camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth,innerHeight); labelRenderer.setSize(innerWidth,innerHeight); });
  (function loop(){ requestAnimationFrame(loop); controls.update();
    // 수위 목표치로 부드럽게 수렴(스무스)
    if(Math.abs(dispS-targetS)>0.002){ dispS+=(targetS-dispS)*0.12; applyS(dispS); }
    else if(dispS!==targetS){ dispS=targetS; applyS(dispS); }
    renderer.render(scene,camera);
    // 라벨: 둘 다 꺼지면 컨테이너 숨김(껐을 때 화면에 얼어붙는 버그 수정)
    const anyOn=labelState.emd||labelState.riv;
    labelRenderer.domElement.style.display=anyOn?'':'none';
    if(anyOn) labelRenderer.render(scene,camera); })();
}

loadAll().then(main).catch(e=>{ console.error(e); $('#lmsg').textContent='오류: '+e.message; });
