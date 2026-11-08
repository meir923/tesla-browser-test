/* Standalone concept prototype. Real OSM geometry and OSRM route; simulated driving and reports. */
'use strict';
const $ = id => document.getElementById(id);
const RAD = Math.PI/180, SPEED = 10.5, START = 530, DURATION = 24;
const CHASE = Object.freeze({zoom:19.18,pitch:76,maxPitch:85,verticalFov:45,carScreenWidth:.09});
// Presentation camera: physical 4.7m model, with an independent close-up ego view.
// This intentionally treats the ego as an FSD-style glyph, not a surveyed-scale map object.
const worldScaleCar = new URLSearchParams(location.search).has('worldscale');
let lastRouteUpdate=-Infinity;
let map, carLayer, path, cumulative, route, virtualTime = 0, ready=false, recording=false;
const distance = (a,b) => {const dlat=(b[1]-a[1])*RAD,dlon=(b[0]-a[0])*RAD;return 6371000*2*Math.asin(Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a[1]*RAD)*Math.cos(b[1]*RAD)*Math.sin(dlon/2)**2))};
const bearing=(a,b)=>Math.atan2(Math.sin((b[0]-a[0])*RAD)*Math.cos(b[1]*RAD),Math.cos(a[1]*RAD)*Math.sin(b[1]*RAD)-Math.sin(a[1]*RAD)*Math.cos(b[1]*RAD)*Math.cos((b[0]-a[0])*RAD))/RAD;
function at(d){d=Math.min(Math.max(d,0),cumulative.at(-1)-.01);let i=1;while(cumulative[i]<d)i++;const f=(d-cumulative[i-1])/(cumulative[i]-cumulative[i-1]);return [path[i-1][0]+(path[i][0]-path[i-1][0])*f,path[i-1][1]+(path[i][1]-path[i-1][1])*f]}
const headingAt=d=>bearing(at(d-12),at(d+18));
const angleDelta=(a,b)=>((b-a+540)%360)-180;
// Arc-distance filtering is independent of frame rate, seeks and capture order.
// A trailing weighted 20m heading window removes OSRM segment-heading chatter.
function chaseHeading(d){
 const reference=headingAt(d);let sum=0,weights=0;
 for(let i=0;i<=10;i++){const w=11-i;sum+=angleDelta(reference,headingAt(d-i*2))*w;weights+=w}
 return reference+sum/weights;
}
function smoothPosition(d){
 // C1 Hermite interpolation in a short arc-length window removes polygonal GPS-like corners.
 const step=2, d0=Math.floor(d/step)*step,u=(d-d0)/step;
 const p0=at(d0),p1=at(d0+step),before=at(d0-step),after=at(d0+2*step);
 const h00=2*u*u*u-3*u*u+1,h10=u*u*u-2*u*u+u,h01=-2*u*u*u+3*u*u,h11=u*u*u-u*u;
 return p0.map((v,i)=>h00*v+h10*(p1[i]-before[i])*.5+h01*p1[i]+h11*(after[i]-v)*.5);
}
function cameraOptions(d){
 const h=map?.getContainer().clientHeight||900;
 return {center:smoothPosition(d),zoom:CHASE.zoom,pitch:CHASE.pitch,bearing:chaseHeading(d),
  padding:{top:h*.35,bottom:0,left:0,right:0}};
}
const feature=(geometry,properties={})=>({type:'Feature',properties,geometry});
const line=coords=>feature({type:'LineString',coordinates:coords});
function slicePath(d){let i=1;while(cumulative[i]<d && i<cumulative.length-1)i++;return [at(d),...path.slice(i)]}
const reports=[{d:START+395,title:'משטרה',icon:'♧',confirmed:3,type:'police'},{d:START+570,title:'עבודות בכביש',icon:'⚒',confirmed:5,type:'works'},{d:START+760,title:'מפגע',icon:'△',confirmed:2,type:'hazard'}];
function makeStyle(base){
 base.name='Derekh — monochrome night';base.light={anchor:'viewport',color:'#ffffff',intensity:.32,position:[1.35,210,30]};
 base.layers=base.layers.filter(l=>l.type!=='raster' && !(l.type==='symbol' && !l.id.startsWith('highway-name-')) && !/rail|hatching|pattern|aeroway/.test(l.id));
 for(const l of base.layers){
  l.paint ||= {};
  if(l.type==='background')l.paint={'background-color':'#1b2026'};
  if(l.type==='fill'){
   let color='#20262c';if(/water/.test(l.id))color='#1d2d39';else if(/park|wood|grass|landcover|landuse/.test(l.id))color='#222d2b';else if(/building/.test(l.id))color='#444a50';else if(/road/.test(l.id))color='#30373e';
   l.paint={'fill-color':color,'fill-opacity':1};
  }
  if(l.type==='line'){
   const casing=/casing/.test(l.id);l.paint['line-color']=/water/.test(l.id)?'#263c49':casing?'#555f68':/path/.test(l.id)?'#35443f':'#343d46';l.paint['line-opacity']=1;
   delete l.paint['line-pattern'];
   if(l['source-layer']==='transportation'){
    l.paint['line-width']=['interpolate',['linear'],['zoom'],13,casing?1.8:1.2,17,casing?10:8,20,casing?38:35];
    if(/service|path|track/.test(l.id))l.paint['line-width']=['interpolate',['linear'],['zoom'],13,0.3,17,casing?4:2,20,casing?16:13];
   }
  }
  if(l.type==='symbol'){
   l.minzoom=16;l.layout['text-field']=['coalesce',['get','name:he'],['get','name']];
   l.layout['text-size']=12;l.layout['text-font']=['Noto Sans Regular'];l.layout['text-max-angle']=25;l.layout['symbol-spacing']=440;
   l.paint={'text-color':'#a6b1be','text-halo-color':'#18212b','text-halo-width':2,'text-opacity':.8};
   delete l.layout['icon-image'];
  }
  if(l.type==='fill-extrusion'){
   l.paint={'fill-extrusion-height':['coalesce',['get','render_height'],['get','height'],12],
   'fill-extrusion-base':['coalesce',['get','render_min_height'],0],
   'fill-extrusion-color':['interpolate',['linear'],['coalesce',['get','render_height'],12],0,'#bcc1c7',20,'#c6cbd0',80,'#d1d5da',180,'#e0e3e6'],
   'fill-extrusion-opacity':1,'fill-extrusion-vertical-gradient':true};
  }
 }
 return base;
}
function makeCarLayer(){
 const mat=(c,r=.5,m=.12)=>new THREE.MeshStandardMaterial({color:c,roughness:r,metalness:m});
 const white=mat('#f2f4f7',.28),trim=mat('#192029',.55),glass=mat('#111e2d',.15,.28),rim=mat('#b7c0ca',.3,.55),rubber=mat('#11141a',.95,0);
 const car=new THREE.Group(),scene=new THREE.Scene();
 function add(mesh,x=0,y=0,z=0){mesh.position.set(x,y,z);car.add(mesh);return mesh}
 const box=(w,l,h,x,y,z,m)=>add(new THREE.Mesh(new THREE.BoxGeometry(w,l,h),m),x,y,z);
 function rounded(w,l,h,r,x,y,z,m){
  const sh=new THREE.Shape(),a=-w/2,b=-l/2;
  sh.moveTo(a+r,b);sh.lineTo(a+w-r,b);sh.quadraticCurveTo(a+w,b,a+w,b+r);sh.lineTo(a+w,b+l-r);sh.quadraticCurveTo(a+w,b+l,a+w-r,b+l);sh.lineTo(a+r,b+l);sh.quadraticCurveTo(a,b+l,a,b+l-r);sh.lineTo(a,b+r);sh.quadraticCurveTo(a,b,a+r,b);
  const g=new THREE.ExtrudeGeometry(sh,{depth:h,bevelEnabled:true,bevelThickness:.035,bevelSize:.035,bevelSegments:2,steps:1,curveSegments:5});g.translate(0,0,-h/2);return add(new THREE.Mesh(g,m),x,y,z);
 }
 // Body extrema: y +/-2.35m including bumper bevels. No enlarged world model.
 rounded(1.83,4.63,.43,.25,0,0,.65,white);
 rounded(1.76,4.39,.18,.2,0,-.02,.36,trim);
 rounded(1.73,1.12,.12,.16,0,1.47,.93,white);
 rounded(1.73,.78,.12,.13,0,-1.72,.94,white);
 // Correct outward-facing windshield/window normals and a smoothly sloping greenhouse.
 const v=new Float32Array([-.83,-1.32,.88,.83,-1.32,.88,.83,1.12,.88,-.83,1.12,.88,-.65,-.77,1.48,.65,-.77,1.48,.65,.53,1.48,-.65,.53,1.48]);
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(v,3));g.setIndex([0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7,4,5,6,4,6,7]);g.computeVertexNormals();add(new THREE.Mesh(g,glass));
 rounded(1.28,1.21,.035,.13,0,-.13,1.50,white);
 // Window pillars and sill trim, flush handles, door seams and wing mirrors.
 for(const x of [-1,1]){
  box(.035,2.16,.045,x*.848,-.1,.90,trim);
  box(.035,.09,.43,x*.766,-.12,1.14,trim);
  rounded(.15,.32,.11,.04,x*.99,.53,1.04,white);
  for(const y of [-.9,.78])box(.018,.19,.035,x*.929,y,.84,rim);
  const seam=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x*.927,-.07,.44),new THREE.Vector3(x*.927,-.07,.88)]);
  car.add(new THREE.Line(seam,new THREE.LineBasicMaterial({color:'#8b95a0',transparent:true,opacity:.40})));
 }
 for(const x of [-.91,.91])for(const y of [-1.43,1.43]){
  const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.335,.335,.205,24),rubber);wheel.rotation.z=Math.PI/2;add(wheel,x,y,.345);
  const hub=new THREE.Mesh(new THREE.CylinderGeometry(.225,.225,.212,20),rim);hub.rotation.z=Math.PI/2;add(hub,x,y,.345);
  const darkHub=new THREE.Mesh(new THREE.CylinderGeometry(.17,.17,.216,20),trim);darkHub.rotation.z=Math.PI/2;add(darkHub,x,y,.345);
  for(let i=0;i<5;i++){const angle=i*Math.PI*2/5,spoke=box(.015,.038,.205,x+Math.sign(x)*.111,y+Math.sin(angle)*.103,.345+Math.cos(angle)*.103,rim);spoke.rotation.x=-angle}
 }
 const led=new THREE.MeshBasicMaterial({color:'#ecf7ff'}),red=new THREE.MeshBasicMaterial({color:'#ed4d56'});
 for(const x of [-.59,.59]){
  rounded(.47,.045,.08,.018,x,2.322,.77,led);
  rounded(.54,.045,.08,.018,x,-2.322,.77,red);
 }
 box(1.12,.035,.10,0,-2.32,.87,red);box(.47,.03,.16,0,-2.33,.49,trim);box(.66,.04,.08,0,2.32,.49,trim);
 scene.add(car);scene.add(new THREE.HemisphereLight(0xffffff,0x465265,1.7));const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.position.set(-7,-6,12);scene.add(sun);
 // One small radial alpha texture, reused by the soft contact shadow and blue ground glow.
 const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const c=canvas.getContext('2d'),grad=c.createRadialGradient(32,32,1,32,32,32);grad.addColorStop(0,'#ffffffdd');grad.addColorStop(.45,'#ffffff99');grad.addColorStop(1,'#ffffff00');c.fillStyle=grad;c.fillRect(0,0,64,64);
 const tex=new THREE.CanvasTexture(canvas);
 function ground(w,l,color,opacity,z){const o=new THREE.Mesh(new THREE.PlaneGeometry(w,l),new THREE.MeshBasicMaterial({color,map:tex,transparent:true,opacity,depthWrite:false}));o.position.z=z;scene.add(o)}
 ground(3.1,5.9,'#03070b',.55,.02);ground(3.8,6.3,'#4296ff',.15,.01);
 const projection=new THREE.Matrix4(),local=new THREE.Matrix4(),translation=new THREE.Matrix4(),scale=new THREE.Matrix4(),rotation=new THREE.Matrix4();
 return {id:'ego-car',type:'custom',renderingMode:'3d',position:at(START),heading:chaseHeading(START),
 onAdd(m,gl){
  this.camera=new THREE.Camera();this.closeCamera=new THREE.PerspectiveCamera(40,1,.1,100);
  this.renderer=new THREE.WebGLRenderer({canvas:m.getCanvas(),context:gl,antialias:true});this.renderer.autoClear=false;this.map=m;
 },
 render(gl,matrix){
  const r=this.renderer;r.resetState();
  if(worldScaleCar){
   const mc=maplibregl.MercatorCoordinate.fromLngLat(this.position,0),s=mc.meterInMercatorCoordinateUnits();
   local.copy(translation.makeTranslation(mc.x,mc.y,mc.z)).multiply(scale.makeScale(s,-s,s)).multiply(rotation.makeRotationZ(-this.heading*RAD));
   this.camera.projectionMatrix.copy(projection.fromArray(matrix)).multiply(local);car.rotation.z=0;r.render(scene,this.camera);
  }else{
   // Dedicated ego presentation camera keeps a true-sized 4.7m model legible (~9% VW)
   // without pretending it has the same survey scale as the surrounding map.
   const width=this.map.getContainer().clientWidth,height=this.map.getContainer().clientHeight,p=this.map.project(this.position);
   const vw=Math.min(width*.34,560),vh=Math.min(height*.50,480),camera=this.closeCamera;
   camera.aspect=vw/vh;camera.updateProjectionMatrix();
   const dist=(1.94*vh)/(2*Math.tan(camera.fov*RAD/2)*width*CHASE.carScreenWidth);
   const angle=(90-CHASE.pitch+6)*RAD;camera.position.set(0,-dist*Math.cos(angle),.68+dist*Math.sin(angle));camera.up.set(0,0,1);camera.lookAt(0,0,.68);
   car.rotation.z=-angleDelta(this.map.getBearing(),this.heading)*RAD;
   const ratio=gl.drawingBufferWidth/width;
   r.setViewport((p.x-vw/2)*ratio,(height-p.y-vh/2)*ratio,vw*ratio,vh*ratio);
   r.clearDepth();r.render(scene,camera);
   r.setViewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight);
  }
  r.resetState();
 }
 };
}
function draw(t){if(!ready)return;virtualTime=t;const d=START+Math.min(t,70)*SPEED;
 carLayer.position=smoothPosition(d);carLayer.heading=chaseHeading(d);
 map.jumpTo(cameraOptions(d));
 // Worker GeoJSON updates are capped at 8Hz; map/car movement remains every frame.
 if(t<lastRouteUpdate || t-lastRouteUpdate>=.125){map.getSource('active-route').setData(line(slicePath(d)));lastRouteUpdate=t}
 const remain=Math.max(0,cumulative.at(-1)-d);$('distanceValue').textContent=remain>=1000?(remain/1000).toFixed(1)+' ק״מ':Math.round(remain/10)*10+' מ׳';
 $('minutesValue').textContent=Math.max(1,Math.ceil(remain/SPEED/60))+' דק׳';$('etaValue').textContent='12:'+String(8+Math.ceil(remain/SPEED/60)).padStart(2,'0');$('speedValue').textContent=Math.round(38+Math.sin(t*.45)*1.2);
 const lastTurn=route.legs.flatMap(l=>l.steps).find(s=>s.maneuver.type==='end of road');
 const td=lastTurn?Math.max(0,cumulative.at(-1)-40-d):remain;
 $('turnDistance').textContent=Math.round(td/10)*10+' מ׳';$('turnName').textContent='שמאלה ל'+(lastTurn?.name || 'כיכר הבימה');
 const alert=reports.find(r=>r.d>d) || reports.at(-1),ad=Math.max(0,Math.round((alert.d-d)/10)*10);
 $('alertTitle').textContent=alert.title+' דווחה בעוד '+ad+' מ׳';$('alertDetail').textContent='הדגמה · אושר ע״י '+alert.confirmed+' נהגים';$('alertIcon').textContent=alert.icon;
 map.triggerRepaint();if(recording)paintCapture();
}
let last=null,startTime=null,paused=false;
function animate(now){if(!paused && ready){if(startTime===null)startTime=now;let t=(now-startTime)/1000;draw(t%60)}last=now;requestAnimationFrame(animate)}
async function boot(){
 const [base,data]=await Promise.all([fetch('./base-style.json').then(r=>r.json()),fetch('./route.json').then(r=>r.json())]);route=data.routes[0];path=route.geometry.coordinates;cumulative=[0];for(let i=1;i<path.length;i++)cumulative.push(cumulative[i-1]+distance(path[i-1],path[i]));
 map=new maplibregl.Map({container:'map',style:makeStyle(base),...cameraOptions(START),antialias:true,preserveDrawingBuffer:true,attributionControl:true,fadeDuration:0,maxPitch:CHASE.maxPitch,interactive:true});window.demoMap=map;
 // MapLibre 4.7 lacks the public FOV setter; guarded enhancement on newer runtimes.
 if(typeof map.setVerticalFieldOfView==='function')map.setVerticalFieldOfView(CHASE.verticalFov);
 map.on('error',e=>console.warn('map',e.error?.message));
 await new Promise(resolve=>map.once('load',resolve));
 map.addSource('active-route',{type:'geojson',data:line(slicePath(START))});
 const before=map.getStyle().layers.find(l=>l.type==='fill-extrusion')?.id;
 // Optional and data-led: no invented lane counts when the tile schema omits them.
 map.addLayer({id:'mapped-lane-divider',type:'line',source:'openmaptiles','source-layer':'transportation',minzoom:18,
  filter:['all',['in',['get','class'],['literal',['primary','secondary','tertiary','trunk','motorway']]],['>=',['to-number',['get','lanes'],0],2]],
  layout:{'line-cap':'butt','line-join':'round'},paint:{'line-color':'#cad0d5','line-opacity':.30,'line-width':1.1,'line-dasharray':[5,8],
   'line-offset':['interpolate',['linear'],['zoom'],18,4,20,12]}},before);
 for(const l of [{id:'route-glow-wide',color:'#1676ff',width:21,blur:10,opacity:.25},{id:'route-glow',color:'#2683ff',width:12,blur:5,opacity:.55},{id:'route-ribbon',color:'#318bff',width:6,blur:0,opacity:1},{id:'route-highlight',color:'#90c5ff',width:1.3,blur:.4,opacity:.9}])map.addLayer({id:l.id,type:'line',source:'active-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':l.color,'line-width':l.width,'line-blur':l.blur,'line-opacity':l.opacity}},before);
 carLayer=makeCarLayer();map.addLayer(carLayer);
 for(const r of reports){const el=document.createElement('div');el.className='pin'+(r.type==='police'?' blue':'');el.innerHTML='<span class="pin-label">דיווח הדגמה</span>'+r.icon;r.marker=new maplibregl.Marker({element:el,anchor:'bottom',offset:[0,-12]}).setLngLat(at(r.d)).addTo(map)}
 // Hebrew glyphs are rendered natively in the HUD; the map's road text uses OSM local names.
 $('loading').style.display='none';ready=true;window.demoReady=true;window.renderDemoFrame=t=>{paused=true;draw(t);return new Promise(r=>map.once('render',r))};
 requestAnimationFrame(animate);if(new URLSearchParams(location.search).has('record'))setTimeout(recordDemo,5500);
}
$('report').onclick=()=>{$('reportMenu').style.display=$('reportMenu').style.display==='flex'?'none':'flex'};
for(const b of document.querySelectorAll('[data-report]'))b.onclick=()=>{$('reportMenu').style.display='none';$('notice').textContent='הדגמה בלבד · דיווח '+b.dataset.report+' לא נשלח';$('notice').style.display='block';setTimeout(()=>$('notice').style.display='none',2800)};
/* Canvas-native HUD for an actual in-browser recording, not AI footage.
   The display uses HTML for accessibility; the export redraws the same HUD over the live WebGL canvas. */
let capture,ctx;
function roundRect(x,y,w,h,r=20,color='#111821f2'){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#ffffff17';ctx.lineWidth=1;ctx.stroke()}
function text(s,x,y,size=20,color='#f5f7fa',weight=500,align='right'){ctx.font=`${weight} ${size}px Heebo,Arial`;ctx.fillStyle=color;ctx.textAlign=align;ctx.direction='rtl';ctx.fillText(s,x,y)}
function paintCapture(){if(!ctx)return;const W=1600,H=900;ctx.clearRect(0,0,W,H);ctx.drawImage(map.getCanvas(),0,0,W,H);
 const grad=ctx.createLinearGradient(0,0,0,H);grad.addColorStop(0,'#10151d88');grad.addColorStop(.25,'#10151d00');grad.addColorStop(.7,'#10151d00');grad.addColorStop(1,'#10151d55');ctx.fillStyle=grad;ctx.fillRect(0,0,W,H);
 // Marker DOM does not appear in a canvas capture: place its screen-projected equivalent.
 for(const r of reports){const p=map.project(at(r.d)),sx=p.x/map.getCanvas().clientWidth*W,sy=p.y/map.getCanvas().clientHeight*H;
  if(sx>20 && sx<W-20 && sy>70 && sy<H-120){roundRect(sx-23,sy-64,46,46,12,'#202b39');text(r.icon,sx,sy-33,25,'#eabe72',500,'center');text('הדגמה',sx,sy-73,11,'#a2b3c5',400,'center')}
 }
 text('דרך',1510,65,29,'#f5f7fa',800);text('ניווט קהילתי · ישראל',1510,87,13,'#91a0b0');roundRect(1130,38,185,28,7,'#a278341d');text('הדגמה · נתוני קהילה מדומים',1305,58,11,'#e0bd78');
 roundRect(1192,110,368,177);text('↰',1528,186,66,'white',500);text($('turnDistance').textContent,1455,164,37,'#f5f7fa',700);text($('turnName').textContent,1455,204,20);text('ממשיכים בשדרות רוטשילד',1455,243,13,'#8e9dac');
 roundRect(1192,310,368,92);text($('alertIcon').textContent,1527,365,28,'#efbd6a');text($('alertTitle').textContent,1480,345,18);text($('alertDetail').textContent,1480,373,13,'#95a5b6');
 roundRect(40,38,305,49,12);text('תל אביב–יפו · שדרות רוטשילד',325,70,15,'#c5cfda');
 roundRect(40,615,124,124,22);text($('speedValue').textContent,102,690,58,'#f5f7fa',600,'center');text('קמ״ש',102,716,13,'#9cabb9',400,'center');ctx.beginPath();ctx.arc(211,676,25,0,Math.PI*2);ctx.fillStyle='white';ctx.fill();ctx.lineWidth=5;ctx.strokeStyle='#e9645d';ctx.stroke();text('50',211,684,22,'#252a30',700,'center');
 roundRect(40,763,1520,103);text('כיכר הבימה',1500,805,21,'#f5f7fa',600);text('תל אביב–יפו · מסלול הדגמה',1500,833,13,'#93a2b3');
 for(const [x,val,label] of [[970,$('etaValue').textContent,'הגעה משוערת'],[800,$('minutesValue').textContent,'זמן נסיעה'],[620,$('distanceValue').textContent,'נותרו ליעד']]){text(val,x,804,26,'#f5f7fa',600);text(label,x,832,12,'#96a4b4')}
 roundRect(67,786,208,55,13,'#24416c77');text('דיווח קהילתי  ⚑',254,821,19,'#d6e7ff');text('© OpenStreetMap contributors · OpenFreeMap · OSRM | נסיעה ודיווחי קהילה מדומים',1560,888,10,'#8a98a8');
}
async function recordDemo(){
 if(recording||!ready)return;await document.fonts.ready;paused=true;draw(0);await new Promise(r=>setTimeout(r,1400));
 capture=document.createElement('canvas');capture.width=1600;capture.height=900;ctx=capture.getContext('2d');recording=true;
 const stream=capture.captureStream(30);const types=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];const mimeType=types.find(t=>MediaRecorder.isTypeSupported(t));const rec=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:14000000});const chunks=[];
 rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};rec.onstop=()=>{const blob=new Blob(chunks,{type:mimeType}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='nav-demo.webm';a.click();recording=false;$('record').textContent='ההקלטה מוכנה';window.recordingDone=true};
 paintCapture();rec.start(1000);const begin=performance.now();$('record').textContent='מקליט…';function step(){const t=(performance.now()-begin)/1000;draw(Math.min(t,DURATION));if(t<DURATION)requestAnimationFrame(step);else rec.stop()}requestAnimationFrame(step);
}
$('record').onclick=recordDemo;
boot().catch(e=>{$('loading').innerHTML='<div>טעינת המפה נכשלה. נדרש חיבור לאינטרנט.<br><small>'+e.message+'</small></div>';console.error(e)});
