/* Standalone concept prototype. Real OSM geometry and OSRM route; simulated driving and reports. */
'use strict';
const $ = id => document.getElementById(id);
const RAD = Math.PI/180, SPEED = 10.5, START = 530, DURATION = 24;
let map, carLayer, path, cumulative, route, virtualTime = 0, ready=false, recording=false;
const distance = (a,b) => {const dlat=(b[1]-a[1])*RAD,dlon=(b[0]-a[0])*RAD;return 6371000*2*Math.asin(Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a[1]*RAD)*Math.cos(b[1]*RAD)*Math.sin(dlon/2)**2))};
const bearing=(a,b)=>Math.atan2(Math.sin((b[0]-a[0])*RAD)*Math.cos(b[1]*RAD),Math.cos(a[1]*RAD)*Math.sin(b[1]*RAD)-Math.sin(a[1]*RAD)*Math.cos(b[1]*RAD)*Math.cos((b[0]-a[0])*RAD))/RAD;
function at(d){d=Math.min(Math.max(d,0),cumulative.at(-1)-.01);let i=1;while(cumulative[i]<d)i++;const f=(d-cumulative[i-1])/(cumulative[i]-cumulative[i-1]);return [path[i-1][0]+(path[i][0]-path[i-1][0])*f,path[i-1][1]+(path[i][1]-path[i-1][1])*f]}
const headingAt=d=>bearing(at(d-8),at(d+18));
const feature=(geometry,properties={})=>({type:'Feature',properties,geometry});
const line=coords=>feature({type:'LineString',coordinates:coords});
function slicePath(d){let i=1;while(cumulative[i]<d && i<cumulative.length-1)i++;return [at(d),...path.slice(i)]}
const reports=[{d:START+395,title:'משטרה',icon:'♧',confirmed:3,type:'police'},{d:START+570,title:'עבודות בכביש',icon:'⚒',confirmed:5,type:'works'},{d:START+760,title:'מפגע',icon:'△',confirmed:2,type:'hazard'}];
function makeStyle(base){
 base.name='Derekh — monochrome night';base.light={anchor:'viewport',color:'#ffffff',intensity:.42,position:[1.25,205,37]};
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
   'fill-extrusion-color':['interpolate',['linear'],['coalesce',['get','render_height'],12],0,'#a5abb2',20,'#b2b8bf',80,'#c2c8cf',180,'#d3d8dd'],
   'fill-extrusion-opacity':1,'fill-extrusion-vertical-gradient':true};
  }
 }
 return base;
}
function makeCarLayer(){
 const material=(c,roughness=.6)=>new THREE.MeshStandardMaterial({color:c,roughness,metalness:.15});
 const white=material('#f2f4f6',.28),black=material('#131b24'),glass=material('#223344',.2),chrome=material('#737c87',.24),rubber=material('#0d1015',.96);
 const car=new THREE.Group();
 const box=(x,y,z,pos,mat)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(x,y,z),mat);m.position.set(...pos);car.add(m);return m};
 box(1.89,4.6,.47,[0,0,.7],white);box(1.8,4.15,.22,[0,-.02,.37],black);box(1.8,.72,.15,[0,1.74,1.01],white);box(1.78,.65,.16,[0,-1.79,1.02],white);
 // Sloping greenhouse. Local +Y is the nose. Geometry is in real metres.
 const v=new Float32Array([-.86,-1.35,.92, .86,-1.35,.92, .86,1.25,.92, -.86,1.25,.92, -.66,-.78,1.55, .66,-.78,1.55, .66,.58,1.55, -.66,.58,1.55]);
 const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.BufferAttribute(v,3));geom.setIndex([0,4,5,0,5,1, 1,5,6,1,6,2, 2,6,7,2,7,3, 3,7,4,3,4,0, 4,7,6,4,6,5]);geom.computeVertexNormals();const cabin=new THREE.Mesh(geom,glass);car.add(cabin);
 box(1.36,1.1,.04,[0,-.1,1.57],white);
 box(.035,2.2,.48,[-.86,-.05,1.13],black);box(.035,2.2,.48,[.86,-.05,1.13],black);
 for(const x of [-.95,.95])for(const y of [-1.43,1.43]){const tire=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,.23,20),rubber);tire.rotation.z=Math.PI/2;tire.position.set(x,y,.39);car.add(tire);const hub=new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,.235,16),chrome);hub.rotation.z=Math.PI/2;hub.position.copy(tire.position);car.add(hub)}
 const light=new THREE.MeshBasicMaterial({color:'#e6f6ff'}),red=new THREE.MeshBasicMaterial({color:'#ef5455'});
 box(.55,.035,.10,[-.56,2.31,.82],light);box(.55,.035,.10,[.56,2.31,.82],light);box(.6,.035,.10,[-.56,-2.31,.79],red);box(.6,.035,.10,[.56,-2.31,.79],red);
 box(.23,.27,.12,[-1.03,.5,1.12],white);box(.23,.27,.12,[1.03,.5,1.12],white);
 // Slightly larger than exact scale to remain legible on a 1600px in-car screen.
 car.scale.setScalar(1.8);
 const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x3d4858,2.1));const sun=new THREE.DirectionalLight(0xffffff,2.4);sun.position.set(-70,-30,110);scene.add(sun);scene.add(car);
 const shadow=new THREE.Mesh(new THREE.PlaneGeometry(4.8,9.4),new THREE.MeshBasicMaterial({color:'#090d12',transparent:true,opacity:.26,depthWrite:false}));shadow.position.z=.05;scene.add(shadow);
 return {id:'ego-car',type:'custom',renderingMode:'3d',position:at(START),heading:headingAt(START),
 onAdd(m,gl){this.camera=new THREE.Camera();this.renderer=new THREE.WebGLRenderer({canvas:m.getCanvas(),context:gl,antialias:true});this.renderer.autoClear=false;this.map=m},
 render(gl,matrix){const mc=maplibregl.MercatorCoordinate.fromLngLat(this.position,0),s=mc.meterInMercatorCoordinateUnits();
 // Reflection in Y changes east/north-up scene into Mercator east/south/down.
 const local=new THREE.Matrix4().makeTranslation(mc.x,mc.y,mc.z).scale(new THREE.Vector3(s,-s,s)).multiply(new THREE.Matrix4().makeRotationZ(-this.heading*RAD));
 this.camera.projectionMatrix=new THREE.Matrix4().fromArray(matrix).multiply(local);this.renderer.resetState();this.renderer.render(scene,this.camera)}
 };
}
function draw(t){if(!ready)return;virtualTime=t;const d=START+Math.min(t,70)*SPEED;
 carLayer.position=at(d);carLayer.heading=headingAt(d);const cameraHeading=headingAt(d+7);
 map.jumpTo({center:at(d+72),zoom:18.05,pitch:65,bearing:cameraHeading,padding:{top:40,right:0,bottom:0,left:0}});
 map.getSource('active-route').setData(line(slicePath(d)));
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
 map=new maplibregl.Map({container:'map',style:makeStyle(base),center:at(START+72),zoom:18.05,pitch:65,bearing:headingAt(START),antialias:true,preserveDrawingBuffer:true,attributionControl:true,fadeDuration:0,maxPitch:75,interactive:true});window.demoMap=map;
 map.on('error',e=>console.warn('map',e.error?.message));
 await new Promise(resolve=>map.once('load',resolve));
 map.addSource('active-route',{type:'geojson',data:line(slicePath(START))});
 const before=map.getStyle().layers.find(l=>l.type==='fill-extrusion')?.id;
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
