/* Real OSM route/buildings, simulated FSD-inspired street visualization. Not vehicle perception. */
'use strict';
const $=id=>document.getElementById(id),RAD=Math.PI/180,START=530,SPEED=10.5,DURATION=24,LANE=3.3;
const FSD={height:2.35,behind:7.8,fov:52,lookAhead:43,lookHeight:1.1,roadWidth:9.9};
let renderer,scene,camera,ego,path,cumulative,route,origin,streetData,ready=false,recording=false,virtualTime=0,shadowTexture;
let capture,ctx,paused=false,startTime=null,last=null;
const traffic=[],reportSprites=[],blueSegments=[];
const reports=[{d:START+65,title:'משטרה',icon:'♧',confirmed:3,type:'police'},{d:START+150,title:'מפגע',icon:'△',confirmed:2,type:'hazard'},{d:START+245,title:'עבודות בכביש',icon:'⚒',confirmed:5,type:'works'}];
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const angleDelta=(a,b)=>((b-a+540)%360)-180;
function xy(p){return new THREE.Vector3((p[0]-origin[0])*111320*Math.cos(origin[1]*RAD),(p[1]-origin[1])*110540,0)}
function at(d){d=clamp(d,0,cumulative.at(-1)-.001);let lo=0,hi=cumulative.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(cumulative[m]>d)hi=m;else lo=m}const f=(d-cumulative[lo])/(cumulative[hi]-cumulative[lo]);return path[lo].clone().lerp(path[hi],f)}
function position(d){const step=2,d0=Math.floor(d/step)*step,u=(d-d0)/step,p0=at(d0),p1=at(d0+step),a=at(d0-step),b=at(d0+2*step);return p0.multiplyScalar(2*u*u*u-3*u*u+1).add(p1.clone().multiplyScalar(-2*u*u*u+3*u*u)).add(p1.sub(a).multiplyScalar((u*u*u-2*u*u+u)*.5)).add(b.sub(at(d0)).multiplyScalar((u*u*u-u*u)*.5))}
function tangent(d,window=3){return position(d+window).sub(position(d-window)).normalize()}
function heading(d){const v=tangent(d,7);return Math.atan2(v.x,v.y)}
function frameAt(d,offset=0,z=0){const p=position(d),t=tangent(d);return p.add(new THREE.Vector3(t.y,-t.x,0).multiplyScalar(offset)).setZ(z)}
function cameraFrame(d){const p=position(d),forward=tangent(d,12);return {position:p.clone().addScaledVector(forward,-FSD.behind).setZ(FSD.height),target:p.clone().addScaledVector(forward,FSD.lookAhead).setZ(FSD.lookHeight)}}
function ribbon(start,end,left,right,z,material,step=1.5){
 const points=[],normal=[],uv=[];const segments=Math.max(1,Math.ceil((end-start)/step));
 for(let i=0;i<segments;i++){
  const a=start+(end-start)*i/segments,b=start+(end-start)*(i+1)/segments;
  const p=[frameAt(a,left,z),frameAt(a,right,z),frameAt(b,left,z),frameAt(b,right,z)];
  for(const k of [0,1,2,2,1,3]){points.push(p[k].x,p[k].y,p[k].z);normal.push(0,0,1);uv.push((k%2),k<2?i:i+1)}
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));const m=new THREE.Mesh(g,material);scene.add(m);return m;
}
const basicCache=new Map();
function basic(color,opacity=1){const key=color+opacity;if(!basicCache.has(key))basicCache.set(key,new THREE.MeshBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:opacity>=1,side:THREE.DoubleSide}));return basicCache.get(key)}
function placeBox(w,l,h,p,angle,material){const m=new THREE.Mesh(new THREE.BoxGeometry(w,l,h),material);m.position.copy(p);m.rotation.z=-angle;scene.add(m);return m}
function makeRoad(){
 const length=cumulative.at(-1),asphalt=new THREE.MeshLambertMaterial({color:'#161b22',side:THREE.DoubleSide}),edge=basic('#c8d1da',.88),faint=basic('#a9b9ca',.065),dash=basic('#d9e1e8',.85),curb=new THREE.MeshLambertMaterial({color:'#49515a'});
 ribbon(0,length,-4.95,4.95,.01,asphalt);
 for(const o of [-4.88,4.88]){ribbon(0,length,o-.055,o+.055,.035,edge);ribbon(0,length,o-.12,o+.12,.031,faint)}
 for(const o of [-1.65,1.65])for(let d=0;d<length;d+=9){ribbon(d,Math.min(d+3,length),o-.055,o+.055,.04,dash);ribbon(d,Math.min(d+3,length),o-.12,o+.12,.037,faint)}
 for(const o of [-5.16,5.16]){ribbon(0,length,o-.14,o+.14,.16,curb);ribbon(0,length,o-.25,o+.25,.013,basic('#252b32'))}
 // Faint real side-road geometry. Main road/lanes are procedural, not lane-survey data.
 const sideVertices=[];
 for(const r of streetData.roads){if(['path','track','rail','transit'].includes(r.class))continue;
  const vs=r.coordinates.map(xy);if(vs.length<2)continue;
  for(let i=1;i<vs.length;i++)sideVertices.push(vs[i-1].x,vs[i-1].y,-.015,vs[i].x,vs[i].y,-.015);
 }
 const sideGeometry=new THREE.BufferGeometry();sideGeometry.setAttribute('position',new THREE.Float32BufferAttribute(sideVertices,3));scene.add(new THREE.LineSegments(sideGeometry,new THREE.LineBasicMaterial({color:'#46515d',transparent:true,opacity:.18})));
 for(const c of streetData.intersections){
  const center=position(c.d),angle=c.heading*RAD;
  placeBox(6.6,42,.018,center.clone().setZ(.012),angle,asphalt);
  // Simulated crosswalks at real cross-street locations, no claim of surveyed markings.
  for(const station of [c.d-7,c.d+7])for(let offset=-4.4;offset<4.5;offset+=1.0)placeBox(.55,2.5,.018,frameAt(station,offset,.055),heading(station),basic('#bec8d2',.76));
  ribbon(c.d-10,c.d-9.7,-1.55,4.75,.057,basic('#cbd4dc',.8));
  const mast=frameAt(c.d-8,5.5,.0),pole=new THREE.MeshLambertMaterial({color:'#69737e'});
  placeBox(.12,.12,4.6,mast.clone().setZ(2.3),0,pole);const sig=placeBox(.45,.24,1.13,mast.clone().setZ(4.20),heading(c.d),new THREE.MeshLambertMaterial({color:'#10151b'}));
  for(let k=0;k<3;k++){const bulb=new THREE.Mesh(new THREE.SphereGeometry(.115,10,8),basic(k===2?'#67e4b0':'#28353a'));bulb.position.copy(mast).setZ(4.53-k*.32);scene.add(bulb)}
 }
 // Dynamic ego-lane path uses an actual road-width strip in the same perspective.
 const blueMat=new THREE.MeshBasicMaterial({color:'#2584ff',transparent:true,opacity:.40,depthWrite:false,side:THREE.DoubleSide});
 for(let i=0;i<85;i++){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(18),3));g.setAttribute('normal',new THREE.Float32BufferAttribute([0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1],3));const m=new THREE.Mesh(g,blueMat);m.frustumCulled=false;scene.add(m);blueSegments.push(m)}
}
function updateBlue(d){
 for(let i=0;i<blueSegments.length;i++){
  const a=d+2.8+i,b=a+1,w=.89;const p=[frameAt(a,-w,.065),frameAt(a,w,.065),frameAt(b,-w,.065),frameAt(b,w,.065)],arr=blueSegments[i].geometry.attributes.position.array;
  let n=0;for(const k of [0,1,2,2,1,3]){arr[n++]=p[k].x;arr[n++]=p[k].y;arr[n++]=p[k].z}blueSegments[i].geometry.attributes.position.needsUpdate=true;
 }
}
function makeBuildings(){
 const pos=[],norm=[],color=[];
 for(const b of streetData.buildings){if(b.ring.length<4)continue;const vertices=b.ring.slice(0,-1).map(xy);const shape=new THREE.Shape(vertices.map(p=>new THREE.Vector2(p.x,p.y)));let g=new THREE.ExtrudeGeometry(shape,{depth:clamp(Number(b.height)||12,5,90),bevelEnabled:false,steps:1,curveSegments:1});if(g.index)g=g.toNonIndexed();const a=g.attributes.position.array,n=g.attributes.normal.array;for(let i=0;i<a.length;i++)pos.push(a[i]);for(let i=0;i<n.length;i++)norm.push(n[i]);
  const tone=.48+Math.min(Number(b.height)||12,40)/400;for(let i=0;i<a.length/3;i++)color.push(tone,tone*1.035,tone*1.08);g.dispose();
 }
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(norm,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(color,3));geo.computeBoundingSphere();scene.add(new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide})));
}
function makeVehicle(bodyColor="#f2f4f7"){
 const mat=(c,r=.5,m=.12)=>new THREE.MeshStandardMaterial({color:c,roughness:r,metalness:m});
 const white=mat(bodyColor,.28),trim=mat('#192029',.55),glass=mat('#111e2d',.15,.28),rim=mat('#b7c0ca',.3,.55),rubber=mat('#11141a',.95,0);
 const car=new THREE.Group(),scene=new THREE.Group();
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
 car.scale.z=1.10;scene.add(car);
 // One small radial alpha texture, reused by the soft contact shadow and blue ground glow.
 const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const c=canvas.getContext('2d'),grad=c.createRadialGradient(32,32,1,32,32,32);grad.addColorStop(0,'#ffffffdd');grad.addColorStop(.45,'#ffffff99');grad.addColorStop(1,'#ffffff00');c.fillStyle=grad;c.fillRect(0,0,64,64);
 const tex=shadowTexture||(shadowTexture=new THREE.CanvasTexture(canvas));
 function ground(w,l,color,opacity,z){const o=new THREE.Mesh(new THREE.PlaneGeometry(w,l),new THREE.MeshBasicMaterial({color,map:tex,transparent:true,opacity,depthWrite:false}));o.position.z=z;scene.add(o)}
 ground(3.1,5.9,'#03070b',.55,.02);ground(3.8,6.3,'#4296ff',.15,.01);

 return scene;
}
function makeAlert(r){
 const c=document.createElement('canvas');c.width=c.height=192;const x=c.getContext('2d');x.fillStyle='#111923';x.strokeStyle=r.type==='police'?'#8aa9d1':'#d8bd8b';x.lineWidth=5;x.beginPath();x.roundRect(22,20,148,148,28);x.fill();x.stroke();x.fillStyle=r.type==='police'?'#bbd4f6':'#efd2a0';x.font='82px Arial';x.textAlign='center';x.fillText(r.icon,96,127);const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthTest:true,fog:true}));sprite.position.copy(frameAt(r.d,4.1,3.2));sprite.scale.set(2.6,2.6,1);scene.add(sprite);reportSprites.push(sprite);
}
function mergeStatic(){
 const groups=new Map();scene.updateMatrixWorld(true);
 for(const object of [...scene.children]){
  if(!object.isMesh||blueSegments.includes(object)||Array.isArray(object.material))continue;
  const material=object.material;let record=groups.get(material.uuid);if(!record){record={material,position:[],normal:[],uv:[],color:[],colored:!!object.geometry.attributes.color};groups.set(material.uuid,record)}
  let g=object.geometry.clone();if(g.index)g=g.toNonIndexed();g.applyMatrix4(object.matrixWorld);
  const count=g.attributes.position.count;
  for(const key of ['position','normal','uv','color']){const source=g.attributes[key];if(source)for(const value of source.array)record[key].push(value);else if(key==='normal')for(let i=0;i<count;i++)record.normal.push(0,0,1)}
  scene.remove(object);g.dispose();object.geometry.dispose();
 }
 for(const data of groups.values()){
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(data.position,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(data.normal,3));if(data.uv.length===data.position.length/3*2)g.setAttribute('uv',new THREE.Float32BufferAttribute(data.uv,2));if(data.colored)g.setAttribute('color',new THREE.Float32BufferAttribute(data.color,3));g.computeBoundingSphere();scene.add(new THREE.Mesh(g,data.material));
 }
}
function updateHUD(t,d){
 const remaining=Math.max(0,cumulative.at(-1)-d),td=Math.max(0,remaining-40),next=route.legs.flatMap(l=>l.steps).find(s=>s.maneuver.type==='end of road');
 $('turnDistance').textContent=Math.round(td/10)*10+' מ׳';$('turnName').textContent='שמאלה ל'+(next?.name||'כיכר הבימה');$('speedValue').textContent=Math.round(SPEED*3.6+Math.sin(t*.4));$('minutesValue').textContent=Math.max(1,Math.ceil(remaining/SPEED/60))+' דק׳';$('distanceValue').textContent=Math.round(remaining/10)*10+' מ׳';$('etaValue').textContent='12:30';
 const r=reports.find(r=>r.d>d)||reports.at(-1),ahead=Math.max(0,Math.round((r.d-d)/5)*5);$('alertTitle').textContent=r.title+' · בעוד '+ahead+' מ׳';$('alertDetail').textContent='הדגמה · אושר ע״י '+r.confirmed+' נהגים';$('alertIcon').textContent=r.icon;
}
function draw(t){
 if(!ready)return;virtualTime=t;const d=START+Math.min(t,60)*SPEED;
 ego.position.copy(position(d));ego.rotation.z=-heading(d);
 const c=cameraFrame(d);camera.position.copy(c.position);camera.up.set(0,0,1);camera.lookAt(c.target);
 for(const item of traffic){let station=item.start+item.speed*t;if(item.speed<0 && station<d-25)station=d+85+((t*3)%35);item.mesh.position.copy(frameAt(station,item.lane,0));item.mesh.rotation.z=-heading(station)+(item.speed<0?Math.PI:0)}
 updateBlue(d);updateHUD(t,d);renderer.render(scene,camera);if(recording)paintCapture();
}
function animate(now){if(ready&&!paused){if(startTime===null)startTime=now;draw(((now-startTime)/1000)%60)}last=now;requestAnimationFrame(animate)}
async function boot(){
 const [r,data]=await Promise.all([fetch('./route.json').then(r=>r.json()),fetch('./street-data.json').then(r=>r.json())]);route=r.routes[0];origin=route.geometry.coordinates[0];path=route.geometry.coordinates.map(xy);streetData=data;cumulative=[0];for(let i=1;i<path.length;i++)cumulative.push(cumulative[i-1]+path[i].distanceTo(path[i-1]));
 scene=new THREE.Scene();scene.background=new THREE.Color('#080b10');scene.fog=new THREE.Fog('#080b10',35,125);
 scene.add(new THREE.HemisphereLight(0xe7efff,0x151d29,1.05));const sun=new THREE.DirectionalLight(0xffffff,1.2);sun.position.set(-20,-15,45);scene.add(sun);
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(5000,5000),new THREE.MeshBasicMaterial({color:'#0d1117'}));ground.position.z=-.06;scene.add(ground);
 camera=new THREE.PerspectiveCamera(FSD.fov,innerWidth/innerHeight,.1,240);camera.up.set(0,0,1);
 renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setSize(innerWidth,innerHeight);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.outputColorSpace=THREE.SRGBColorSpace;$('map').appendChild(renderer.domElement);
 makeRoad();makeBuildings();mergeStatic();ego=makeVehicle();scene.add(ego);
 for(const item of [{start:START+26,speed:11.2,lane:LANE,color:'#9ea7b2'},{start:START+54,speed:10.0,lane:0,color:'#c6cbd2'},{start:START+84,speed:-9,lane:-LANE,color:'#c6cbd2'},{start:START+142,speed:-10,lane:-LANE,color:'#7c8793'}]){item.mesh=makeVehicle(item.color);scene.add(item.mesh);traffic.push(item)}
 reports.forEach(makeAlert);ready=true;window.demoReady=true;window.demoScene=scene;window.demoCamera=camera;window.demoRenderer=renderer;
 window.renderDemoFrame=async t=>{paused=true;draw(t);return true};window.fsdStats={cameraHeight:FSD.height,cameraBehind:FSD.behind,laneWidth:LANE,lanes:3,carLength:4.7,buildings:streetData.buildings.length,roadLayouts:'illustrative',objects:'simulated'};
 $('loading').style.display='none';draw(0);requestAnimationFrame(animate);if(new URLSearchParams(location.search).has('record'))setTimeout(recordDemo,1800);
 addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);draw(virtualTime)});
}
$('report').onclick=()=>{$('reportMenu').style.display=$('reportMenu').style.display==='flex'?'none':'flex'};
for(const b of document.querySelectorAll('[data-report]'))b.onclick=()=>{$('reportMenu').style.display='none';$('notice').textContent='הדגמה בלבד · דיווח '+b.dataset.report+' לא נשלח';$('notice').style.display='block';setTimeout(()=>$('notice').style.display='none',2400)};
function roundRect(x,y,w,h,r=16,color='#101720ef'){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=color;ctx.fill();ctx.strokeStyle='#ffffff17';ctx.lineWidth=1;ctx.stroke()}
function text(s,x,y,size=20,color='#f5f7fa',weight=500,align='right'){ctx.font=`${weight} ${size}px Heebo,Arial`;ctx.fillStyle=color;ctx.textAlign=align;ctx.direction='rtl';ctx.fillText(s,x,y)}
function paintCapture(){
 if(!ctx)return;ctx.clearRect(0,0,1600,900);ctx.drawImage(renderer.domElement,0,0,1600,900);
 text('דרך',1540,48,24,'#f5f7fa',800);text('תצוגת הדגמה · לא מידע מחיישני הרכב',1540,71,12,'#94a1af');
 roundRect(1250,99,310,113);text('↰',1535,160,48);text($('turnDistance').textContent,1470,140,27,'#f5f7fa',700);text($('turnName').textContent,1470,174,18);text('שדרות רוטשילד · תל אביב',1470,197,11,'#91a0b1');
 roundRect(1250,228,310,65);text($('alertTitle').textContent,1537,255,16);text($('alertDetail').textContent,1537,279,11,'#bba77e');
 roundRect(35,35,293,40,10);text('תל אביב · נתיבים ותנועה מדומים',310,61,13,'#a0afbf');
 roundRect(35,675,110,114,18);text($('speedValue').textContent,90,742,52,'#f5f7fa',600,'center');text('קמ״ש',90,769,12,'#8e9aaa',400,'center');ctx.beginPath();ctx.arc(184,735,23,0,Math.PI*2);ctx.fillStyle='white';ctx.fill();ctx.strokeStyle='#d96565';ctx.lineWidth=4;ctx.stroke();text('50',184,742,21,'#26303b',700,'center');
 roundRect(35,811,1530,66,17);text('כיכר הבימה',1529,840,19,'#f5f7fa',600);text('מסלול אמיתי · הדמיית נסיעה',1529,862,11,'#8c9aab');
 text($('distanceValue').textContent+'   ·   '+$('minutesValue').textContent+'   ·   הגעה '+$('etaValue').textContent,1000,851,21,'#dce3eb');roundRect(60,826,180,38,10,'#284c7c66');text('דיווח קהילתי  ⚑',222,852,16,'#d0e3ff');
 text('© OpenStreetMap contributors · OpenFreeMap · OSRM | תנועה, נתיבים, מעברי חציה ודיווחי קהילה הם הדמיה',1560,895,9,'#7b8796');
}
async function recordDemo(){
 if(!ready||recording)return;await document.fonts.ready;paused=true;draw(0);await new Promise(r=>setTimeout(r,500));capture=document.createElement('canvas');capture.width=1600;capture.height=900;ctx=capture.getContext('2d');recording=true;
 const mimeType=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));const recorder=new MediaRecorder(capture.captureStream(30),{mimeType,videoBitsPerSecond:16000000}),chunks=[];
 recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};recorder.onstop=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(chunks,{type:mimeType}));a.download='nav-demo.webm';a.click();recording=false;window.recordingDone=true;$('record').textContent='ההקלטה מוכנה'};
 paintCapture();recorder.start(1000);$('record').textContent='מקליט…';const start=performance.now();function frame(){const t=Math.min((performance.now()-start)/1000,DURATION);draw(t);if(t<DURATION)requestAnimationFrame(frame);else recorder.stop()}requestAnimationFrame(frame);
}
$('record').onclick=recordDemo;
boot().catch(e=>{console.error(e);$('loading').textContent='טעינת ההדגמה נכשלה: '+e.message});
