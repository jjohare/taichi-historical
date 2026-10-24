// The procedural fallback rig and the authored GLB avatar, behind one Rig interface (design §4).
// Rest data is captured once per rig: {local, world, position}, all as plain arrays.
import * as THREE from 'three';
import {GLTFLoader} from '../vendor/GLTFLoader.js';

const SKELETON_VISIBLE = /palm|finger|thumb|shoe|Head/;

function makeRig(kind, group, extras = {}) {
  group.updateMatrixWorld(true);
  const bones = new Map(), rest = new Map(), meshes = [], lagNodes = [], lagObjects = new Map(), scratch = new THREE.Quaternion();
  group.traverse(object => {
    if (object.isBone) {
      bones.set(object.name, object);
      rest.set(object.name, {local: object.quaternion.toArray(), world: object.getWorldQuaternion(scratch).toArray(), position: object.position.toArray()});
    }
    if (object.isMesh) meshes.push(object);
    const {name, hinge_axis: h, max_degrees: max, inward_degrees: inward, drop} = object.userData; // PE-60: GLTFLoader strips ':' from object.name
    if (name?.startsWith('lag:') && bones.has(object.parent?.name) && h?.join() === '1,0,0' && max > 0) {
      lagObjects.set(name, object);
      lagNodes.push({node: name, parent: object.parent.name, maxDegrees: max, inwardDegrees: inward ?? max, drop: drop === true, restLocal: object.quaternion.toArray()});
    }
  });
  const skeleton = extras.skeleton;
  // Joint marker: a child of the selected bone, so it follows every pose change with no per-frame bookkeeping.
  // depthTest is off so it is never hidden inside the mesh; the meshes list above predates it, so skeleton mode ignores it.
  const marker = new THREE.Mesh(new THREE.SphereGeometry(.06, 16, 12), new THREE.MeshBasicMaterial({color: extras.accent, depthTest: false, transparent: true, opacity: .8}));
  marker.renderOrder = 999; marker.visible = false;
  return {
    kind, rest, jointNames: [...bones.keys()], lagNodes,
    setLagLocal(node, quaternion) { lagObjects.get(node)?.quaternion.fromArray(quaternion); },
    worldQuaternionsOf: names => new Map(names.map(name => [name, bones.get(name).getWorldQuaternion(scratch).toArray()])),
    setLocal(name, quaternion) { bones.get(name)?.quaternion.fromArray(quaternion); },
    // Offset from the pelvis rest position. A rig without a pelvis ignores it rather than throwing.
    setRootTranslation(offset) {
      const pelvis = bones.get('pelvis'), basis = rest.get('pelvis');
      if (pelvis && basis) pelvis.position.fromArray(basis.position).add(new THREE.Vector3().fromArray(offset));
    },
    resetToRest() {
      for (const [name, bone] of bones) { const basis = rest.get(name); bone.quaternion.fromArray(basis.local); bone.position.fromArray(basis.position); }
    },
    localOf: name => bones.get(name).quaternion.toArray(),
    worldPositionOf: name => bones.get(name).getWorldPosition(new THREE.Vector3()).toArray(),
    setSkeletonVisible(show) {
      if (!skeleton) return;
      skeleton.visible = show;
      for (const mesh of meshes) mesh.visible = !show || SKELETON_VISIBLE.test(mesh.name);
    },
    setVisible(show) { group.visible = show; },
    isVisible: () => group.visible,
    // Returns false (and hides the marker) when this rig has no such bone, e.g. the fallback rig's different names.
    setMarker(name) {
      const bone = name && bones.get(name);
      marker.removeFromParent(); marker.visible = false;
      if (!bone) return false;
      bone.add(marker); marker.position.set(0, 0, 0); marker.visible = true; return true;
    },
    markerState: () => ({
      visible: marker.visible && !!marker.parent, position: marker.parent ? marker.getWorldPosition(new THREE.Vector3()).toArray() : null,
      depthTest: marker.material.depthTest, colour: `#${marker.material.color.getHexString()}`,
    }),
    // Read-only view for the test hook: skeleton helper and per-mesh visibility, keyed by mesh name.
    visibility: () => ({
      skeletonVisible: skeleton ? skeleton.visible : false,
      meshVisibility: kind === 'avatar' ? Object.fromEntries(meshes.map(mesh => [mesh.name, mesh.visible])) : {},
    }),
  };
}

// Neutral joint rig built from spheres and cylinders. Stays usable if the avatar cannot be fetched.
export function createFallbackRig(scene, colour) {
  const jointMaterial = new THREE.MeshStandardMaterial({color: colour('--jade'), roughness: .8});
  const boneMaterial = new THREE.MeshStandardMaterial({color: colour('--muted'), roughness: .85});
  const handMaterial = new THREE.MeshStandardMaterial({color: colour('--accent'), roughness: .9});
  const root = new THREE.Bone(); root.name = 'pelvis'; root.position.y = .94; scene.add(root);
  function ball(parent, r = .047, material = jointMaterial) { const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), material); parent.add(mesh); return mesh; }
  ball(root, .075);
  function joint(name, parent, position, r = .045) {
    const bone = new THREE.Bone(); bone.name = name; bone.position.set(...position); parent.add(bone); ball(bone, r);
    const end = new THREE.Vector3(...position);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(.028, .028, end.length(), 12), boneMaterial);
    mesh.position.copy(end).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.normalize());
    parent.add(mesh); return bone;
  }
  const spine = joint('spine', root, [0, .23, 0]), chest = joint('chest', spine, [0, .23, 0]);
  const neck = joint('neck', chest, [0, .13, 0]); const head = joint('head', neck, [0, .15, 0], .115);
  head.children.find(c => c.isMesh).scale.set(.85, 1.2, .9);
  for (const [side, sign] of [['left', 1], ['right', -1]]) {
    const shoulder = joint(`${side}_shoulder`, chest, [sign * .24, 0, 0]);
    const elbow = joint(`${side}_elbow`, shoulder, [sign * .15, -.29, 0]);
    const wrist = joint(`${side}_wrist`, elbow, [sign * .1, -.26, 0], .033);
    const hand = ball(wrist, .07, handMaterial); hand.position.set(sign * .02, -.075, .015); hand.scale.set(.55, 1.2, .38);
    const thumb = ball(wrist, .025, handMaterial); thumb.position.set(-sign * .025, -.05, .045);
    const hip = joint(`${side}_hip`, root, [sign * .13, -.04, 0]); const knee = joint(`${side}_knee`, hip, [sign * .015, -.42, 0]); const ankle = joint(`${side}_ankle`, knee, [0, -.4, 0], .036);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(.115, .065, .24), handMaterial); foot.position.set(0, -.045, .07); ankle.add(foot);
  }
  return makeRig('fallback-rig', root, {accent: colour('--accent')});
}

// Authored avatar with a named 24-bone hierarchy. No catalogue event reaches it. Throws if it cannot load.
export async function loadAvatar(scene, url, colour) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const avatar = gltf.scene, skeleton = new THREE.SkeletonHelper(avatar);
  skeleton.material.color.set(colour('--jade')); skeleton.material.depthTest = false; skeleton.visible = false;
  // Build the rig before touching the scene, so a throw leaves the fallback rig as the only thing shown.
  const rig = makeRig('avatar', avatar, {skeleton, accent: colour('--accent')});
  scene.add(avatar, skeleton);
  return rig;
}
