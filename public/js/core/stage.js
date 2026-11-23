// three.js 공통 무대: 렌더러, 카메라, 바닥/격자, 라벨, 드론 모델
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export { THREE, CSS2DObject };

export function label(text, cls = 'axis-label', color) {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  if (color !== undefined) el.style.color = typeof color === 'number' ? '#' + color.toString(16).padStart(6, '0') : color;
  return new CSS2DObject(el);
}

/** 그룹을 비울 때 CSS2D 라벨의 DOM 요소도 함께 지움 (three.js 는 자식 라벨을 남겨 둠) */
export function clearGroup(group) {
  group.traverse((o) => { if (o.isCSS2DObject && o.element.parentNode) o.element.parentNode.removeChild(o.element); });
  group.clear();
}
export function removeObject(scene, obj) {
  obj.traverse((o) => { if (o.isCSS2DObject && o.element.parentNode) o.element.parentNode.removeChild(o.element); });
  scene.remove(obj);
}

/** 쿼드콥터 모델. size = 대각 모터 간 대략 폭(m) */
export function buildDrone({ size = 0.7, accent = 0xff4b4b } = {}) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.4, roughness: 0.5 });
  const shell = new THREE.MeshStandardMaterial({ color: 0xe8edf4, metalness: 0.1, roughness: 0.4 });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.3), dark));
  const cover = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.22), shell);
  cover.position.y = 0.055;
  g.add(cover);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 12), new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.4 }));
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 0.03, -0.2);
  g.add(nose);
  // LED (위쪽 돔)
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 10), ledMat);
  led.position.set(0, 0.09, 0);
  g.add(led);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.position.copy(led.position);
  g.add(glow);

  const props = [];
  const arm = 0.25;
  [[1, -1, true], [-1, -1, true], [1, 1, false], [-1, 1, false]].forEach(([sx, sz, front], i) => {
    const x = sx * arm, z = sz * arm;
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, Math.hypot(x, z)), dark);
    a.position.set(x / 2, 0, z / 2);
    a.rotation.y = Math.atan2(x, z);
    g.add(a);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 16), dark);
    motor.position.set(x, 0.02, z);
    g.add(motor);
    const prop = new THREE.Group();
    prop.position.set(x, 0.05, z);
    prop.add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.006, 0.025), new THREE.MeshStandardMaterial({ color: front ? 0xff6b6b : 0xcfd8e3 })));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.13, 24), new THREE.MeshBasicMaterial({ color: front ? 0xff8080 : 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    prop.add(disc);
    prop.userData = { dir: i % 3 === 0 ? 1 : -1, disc };
    props.push(prop);
    g.add(prop);
  });
  g.scale.setScalar(size / 0.7);
  g.userData = { props, led, ledMat, glow, spin: 0 };
  return g;
}

/** 프로펠러 회전 + LED 표시 */
export function animateDrone(d, dt, { armed, ledOn, ledColor }) {
  const u = d.userData;
  u.spin += ((armed ? 38 : 0) - u.spin) * Math.min(1, dt * 2.5);
  for (const pr of u.props) {
    pr.rotation.y += pr.userData.dir * u.spin * dt;
    pr.userData.disc.material.opacity = Math.min(0.28, u.spin / 120);
  }
  if (ledOn) {
    const c = new THREE.Color(ledColor[0] / 255, ledColor[1] / 255, ledColor[2] / 255);
    u.ledMat.color.copy(c);
    u.glow.material.color.copy(c);
    u.glow.material.opacity = 0.55;
  } else {
    u.ledMat.color.setHex(0x222222);
    u.glow.material.opacity = 0;
  }
}

export class Stage {
  constructor(el, { background = 0x0d1320, gridSize = 100 } = {}) {
    this.el = el;
    this.follow = false;
    this.followTarget = null; // THREE.Vector3 를 돌려주는 함수
    this.frameHooks = [];
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(r.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'label-layer';
    el.appendChild(this.labels.domElement);

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(background);
    scene.fog = new THREE.Fog(background, 70, 200);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 800);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x1a2230, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(10, 20, 8);
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: 0x111a28, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    scene.add(ground);
    const g1 = new THREE.GridHelper(gridSize, gridSize, 0x1d2a40, 0x1d2a40);
    const g10 = new THREE.GridHelper(gridSize, gridSize / 10, 0x34507a, 0x34507a);
    g10.position.y = 0.003;
    scene.add(g1, g10);

    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
    this.clock = new THREE.Clock();
    r.setAnimationLoop(() => this.frame());
  }
  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  setView(camPos, target) {
    this.camera.position.copy(camPos);
    this.controls.target.copy(target);
  }
  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    for (const f of this.frameHooks) f(dt);
    if (this.follow && this.followTarget) {
      const p = this.followTarget();
      if (p) {
        const delta = p.clone().sub(this.controls.target).multiplyScalar(Math.min(1, dt * 3));
        this.controls.target.add(delta);
        this.camera.position.add(delta);
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }
}

/** 궤적 선 */
export class Trail {
  constructor(scene, color = 0xffb347, max = 6000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.n = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setDrawRange(0, 0);
    this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    this.line.frustumCulled = false;
    scene.add(this.line);
  }
  add(v, minDist = 0.15) {
    const p = this.pos, n = this.n;
    if (n && Math.hypot(p[n * 3 - 3] - v.x, p[n * 3 - 2] - v.y, p[n * 3 - 1] - v.z) < minDist) return;
    if (n >= this.max) { p.copyWithin(0, 3); this.n--; }
    p.set([v.x, v.y, v.z], this.n * 3);
    this.n++;
    this.line.geometry.setDrawRange(0, this.n);
    this.line.geometry.attributes.position.needsUpdate = true;
  }
  clear() { this.n = 0; this.line.geometry.setDrawRange(0, 0); }
  dispose(scene) { scene.remove(this.line); this.line.geometry.dispose(); }
}
