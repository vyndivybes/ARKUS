// User-initiated local Three.js preview of non-joined CAD assembly primitives.
export function validateSceneParts(parts){
 if(!Array.isArray(parts)||parts.length<1||parts.length>8)throw Error('Preview supports 1–8 parts.');
 return parts.map(p=>{
  if(!p||!['box','cylinder','tube'].includes(p.shape)||!Array.isArray(p.position)||p.position.length!==3)throw Error('Invalid assembly part.');
  const pos=p.position.map(Number);if(pos.some(v=>!Number.isFinite(v)||Math.abs(v)>500))throw Error('Invalid position.');
  const names=p.shape==='box'?['length','width','height']:p.shape==='cylinder'?['radius','height']:['radius','wall','height'];
  const dim={};for(const name of names){const value=Number(p.dimensions?.[name]);if(!Number.isFinite(value)||value<1||value>300)throw Error('Invalid '+name);dim[name]=value;}
  if(p.shape==='tube'&&dim.wall>=dim.radius)throw Error('Tube wall exceeds radius.');
  return {shape:p.shape,position:pos,dimensions:dim};
 });
}
export async function drawCADPreview(canvas,parts){
 const normalized=validateSceneParts(parts);
 const THREE=await import('three');
 const {OrbitControls}=await import('/vendor/OrbitControls.js');
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
 const width=Math.max(300,Math.min(660,canvas.parentElement.clientWidth-20)),height=260;
 renderer.setSize(width,height,false);renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));
 const scene=new THREE.Scene();scene.background=new THREE.Color(0x09141b);
 const camera=new THREE.PerspectiveCamera(45,width/height,.1,5000);
 scene.add(new THREE.AmbientLight(0xffffff,.7));
 const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(300,400,500);scene.add(light);
 const group=new THREE.Group();scene.add(group);
 const materialColors=[0x64dcc5,0xd9ae69,0x8db2de,0xb99cdc,0xbdd69b,0xe4a6a6];
 for(const [index,part] of normalized.entries()){
   const {shape,dimensions:d,position:p}=part;
   let geometry;
   if(shape==='box')geometry=new THREE.BoxGeometry(d.length,d.width,d.height);
   else if(shape==='cylinder')geometry=new THREE.CylinderGeometry(d.radius,d.radius,d.height,40);
   else{
     const outline=new THREE.Shape();outline.absarc(0,0,d.radius,0,Math.PI*2,false);
     const hole=new THREE.Path();hole.absarc(0,0,d.radius-d.wall,0,Math.PI*2,true);outline.holes.push(hole);
     geometry=new THREE.ExtrudeGeometry(outline,{depth:d.height,bevelEnabled:false,curveSegments:40});
   }
   const material=new THREE.MeshStandardMaterial({color:materialColors[index%materialColors.length],metalness:.4,roughness:.3,side:THREE.DoubleSide});
   const mesh=new THREE.Mesh(geometry,material);
   mesh.position.set(...p);
   if(shape==='box'){mesh.position.x+=d.length/2;mesh.position.y+=d.width/2;mesh.position.z+=d.height/2;}
   if(shape==='cylinder'){mesh.rotation.x=Math.PI/2;mesh.position.z+=d.height/2;}
   group.add(mesh);
 }
 const bounds=new THREE.Box3().setFromObject(group);
 const center=bounds.getCenter(new THREE.Vector3());
 const radius=Math.max(15,bounds.getSize(new THREE.Vector3()).length());
 camera.position.copy(center).add(new THREE.Vector3(radius*1.3,radius*.9,radius*1.4));
 const controls=new OrbitControls(camera,canvas);controls.enableDamping=false;controls.target.copy(center);controls.minDistance=5;controls.maxDistance=5000;controls.update();
 const render=()=>renderer.render(scene,camera);
 controls.addEventListener('change',render);render();
 return {close(){controls.dispose();for(const mesh of group.children){mesh.geometry.dispose();mesh.material.dispose();}renderer.dispose();}};
}
