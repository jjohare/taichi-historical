// Renderer, camera, lights, floor and OrbitControls. Owns render-on-demand: one coalesced rAF per request,
// driven by the controls' change event and by the resize and visibility observers. There is no loop.
import * as THREE from 'three';
import {OrbitControls} from '../vendor/OrbitControls.js';
import {TEXT} from './provenance.js';

export function createScene({host, colour, onRender, onContextChange}) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(colour('--floor'));
  const camera = new THREE.PerspectiveCamera(36, 1, .01, 30); camera.position.set(1.9, 1.45, 2.7);
  const renderer = new THREE.WebGLRenderer({antialias: true, alpha: false});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label', TEXT.aria);
  renderer.domElement.setAttribute('role', 'img'); host.append(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, .95, 0); controls.minDistance = 2.2; controls.maxDistance = 7; controls.maxPolarAngle = Math.PI * .86;
  controls.enablePan = false; controls.enableDamping = false; controls.autoRotate = false; controls.update(); controls.saveState();
  scene.add(new THREE.HemisphereLight(colour('--surface'), colour('--jade'), 2.5));
  const light = new THREE.DirectionalLight(colour('--surface'), 3); light.position.set(3, 5, 4); scene.add(light);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.8, .8, .02, 64), new THREE.MeshStandardMaterial({color: colour('--bg'), roughness: 1}));
  base.position.y = 0; scene.add(base);
  const grid = new THREE.PolarGridHelper(.75, 8, 3, 64, colour('--border'), colour('--border')); grid.position.y = .012; scene.add(grid);

  let visible = true, frame = 0;
  function render() { frame = 0; if (visible && !renderer.getContext().isContextLost()) { renderer.render(scene, camera); onRender(); } }
  function requestRender() { if (!frame) frame = requestAnimationFrame(render); }
  controls.addEventListener('change', requestRender);
  function resize() {
    const {width, height} = host.getBoundingClientRect(); if (!width || !height) return;
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); requestRender();
  }
  new ResizeObserver(resize).observe(host);
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (visible) requestRender(); }).observe(host);
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); onContextChange('lost'); });
  renderer.domElement.addEventListener('webglcontextrestored', () => onContextChange('restored'));

  const up = new THREE.Vector3(0, 1, 0);
  function orbit(angle) {
    const offset = camera.position.clone().sub(controls.target); offset.applyAxisAngle(up, angle);
    camera.position.copy(controls.target).add(offset); controls.update(); requestRender();
  }
  function zoom(factor) {
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance));
    camera.position.copy(controls.target).add(offset); controls.update(); requestRender();
  }
  // Instant jump to a preset position; the target never moves (design §5.4).
  function setCameraPosition(position) { camera.position.fromArray(position); controls.update(); requestRender(); }
  function resetCamera() { controls.reset(); requestRender(); }
  resize();
  return {isVisible: () => visible, scene, camera, controls, renderer, requestRender, orbit, zoom, setCameraPosition, resetCamera};
}
