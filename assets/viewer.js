import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
const host=document.getElementById('model-view'),status=document.getElementById('model-status');
const css=getComputedStyle(document.documentElement),colour=name=>css.getPropertyValue(name).trim();
const scene=new THREE.Scene();scene.background=new THREE.Color(colour('--floor'));
const camera=new THREE.PerspectiveCamera(36,1,.01,30);camera.position.set(1.9,1.45,2.7);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.domElement.setAttribute('aria-label','Orbitable neutral human rig. Camera controls are available below.');renderer.domElement.setAttribute('role','img');host.append(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,.95,0);controls.minDistance=2.2;controls.maxDistance=7;controls.maxPolarAngle=Math.PI*.86;controls.enablePan=false;controls.update();controls.saveState();
scene.add(new THREE.HemisphereLight(colour('--surface'),colour('--jade'),2.5));const light=new THREE.DirectionalLight(colour('--surface'),3);light.position.set(3,5,4);scene.add(light);
const jointMaterial=new THREE.MeshStandardMaterial({color:colour('--jade'),roughness:.8});
const boneMaterial=new THREE.MeshStandardMaterial({color:colour('--muted'),roughness:.85});
const handMaterial=new THREE.MeshStandardMaterial({color:colour('--accent'),roughness:.9});
const root=new THREE.Bone();root.name='pelvis';root.position.y=.94;scene.add(root);
function ball(parent,r=.047,material=jointMaterial){const mesh=new THREE.Mesh(new THREE.SphereGeometry(r,16,12),material);parent.add(mesh);return mesh;}
ball(root,.075);
function joint(name,parent,position,r=.045){const bone=new THREE.Bone();bone.name=name;bone.position.set(...position);parent.add(bone);ball(bone,r);const end=new THREE.Vector3(...position);const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.028,.028,end.length(),12),boneMaterial);mesh.position.copy(end).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),end.normalize());parent.add(mesh);return bone;}
const spine=joint('spine',root,[0,.23,0]),chest=joint('chest',spine,[0,.23,0]);
const neck=joint('neck',chest,[0,.13,0]);const head=joint('head',neck,[0,.15,0],.115);head.children.find(c=>c.isMesh).scale.set(.85,1.2,.9);
const elbows=[];
for(const [side,sign] of [['left',1],['right',-1]]){
  const shoulder=joint(`${side}_shoulder`,chest,[sign*.24,0,0]);
  const elbow=joint(`${side}_elbow`,shoulder,[sign*.15,-.29,0]);elbows.push(elbow);
  const wrist=joint(`${side}_wrist`,elbow,[sign*.1,-.26,0],.033);
  const hand=ball(wrist,.07,handMaterial);hand.position.set(sign*.02,-.075,.015);hand.scale.set(.55,1.2,.38);
  const thumb=ball(wrist,.025,handMaterial);thumb.position.set(-sign*.025,-.05,.045);
  const hip=joint(`${side}_hip`,root,[sign*.13,-.04,0]);const knee=joint(`${side}_knee`,hip,[sign*.015,-.42,0]);const ankle=joint(`${side}_ankle`,knee,[0,-.4,0],.036);
  const foot=new THREE.Mesh(new THREE.BoxGeometry(.115,.065,.24),handMaterial);foot.position.set(0,-.045,.07);ankle.add(foot);
}
const base=new THREE.Mesh(new THREE.CylinderGeometry(.8,.8,.02,64),new THREE.MeshStandardMaterial({color:colour('--bg'),roughness:1}));base.position.y=.0;scene.add(base);
const grid=new THREE.PolarGridHelper(.75,8,3,64,colour('--border'),colour('--border'));grid.position.y=.012;scene.add(grid);
let visible=true,frame=0;
function render(){frame=0;if(visible)renderer.render(scene,camera);}
function requestRender(){if(!frame)frame=requestAnimationFrame(render);}
controls.addEventListener('change',requestRender);
function resize(){const {width,height}=host.getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();requestRender();}
new ResizeObserver(resize).observe(host);new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)requestRender();}).observe(host);
function orbit(angle){const offset=camera.position.clone().sub(controls.target);offset.applyAxisAngle(new THREE.Vector3(0,1,0),angle);camera.position.copy(controls.target).add(offset);controls.update();requestRender();}
function zoom(factor){const offset=camera.position.clone().sub(controls.target);offset.setLength(THREE.MathUtils.clamp(offset.length()*factor,controls.minDistance,controls.maxDistance));camera.position.copy(controls.target).add(offset);controls.update();requestRender();}
document.getElementById('orbit-left').onclick=()=>orbit(-Math.PI/8);document.getElementById('orbit-right').onclick=()=>orbit(Math.PI/8);document.getElementById('zoom-in').onclick=()=>zoom(.85);document.getElementById('zoom-out').onclick=()=>zoom(1.15);
document.getElementById('reset-view').onclick=()=>{controls.reset();requestRender();};
document.getElementById('elbow-angle').oninput=e=>{const angle=Number(e.target.value);for(const elbow of elbows)elbow.rotation.x=-THREE.MathUtils.degToRad(angle);document.getElementById('joint-value').textContent=`${angle}°`;requestRender();};
renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();status.hidden=false;status.textContent='The 3D graphics context was interrupted. Reload to restore the viewer.';});
status.hidden=true;resize();
