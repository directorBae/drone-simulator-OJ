// 2일차 리플레이 장면: OJ 좌표계 (x, y, z=위) → three (x, z_up, -y)
import { Stage, THREE, label, buildDrone, animateDrone, clearGroup } from '../core/stage.js';
import { positionAt } from './judge.js';

const P = (x, y, z) => new THREE.Vector3(x, z, -y);
const hue = (i, n) => new THREE.Color().setHSL(i / n, 0.75, 0.6);

export class ReplayScene extends Stage {
  constructor(el) {
    super(el, { gridSize: 80 });
    this.t = 0; this.duration = 0; this.playing = false; this.speed = 1;
    this.paths = null; this.onTime = null;
    this.setView(P(-10, -14, 14), P(4, 6, 6));
    // 축
    const axes = [[new THREE.Vector3(1, 0, 0), 0xff5a5a, 'x'], [new THREE.Vector3(0, 0, -1), 0x4cd97b, 'y'], [new THREE.Vector3(0, 1, 0), 0x5aa8ff, 'z (위)']];
    for (const [dir, color, text] of axes) {
      this.scene.add(new THREE.ArrowHelper(dir, new THREE.Vector3(-1.5, 0.02, 1.5), 3, color, 0.4, 0.2));
      const l = label(text, 'axis-label', color);
      l.position.copy(dir.clone().multiplyScalar(3.6).add(new THREE.Vector3(-1.5, 0, 1.5)));
      this.scene.add(l);
    }
    this.static = new THREE.Group();
    this.dyn = new THREE.Group();
    this.scene.add(this.static, this.dyn);
    this.drones = [];
    this.showPaths = true;
    this.showLabels = true;
    this.frameHooks.push((dt) => this.tick(dt));
  }

  /** 점들이 모두 보이도록 카메라 맞추기 */
  fitView(points) {
    if (!points.length) return;
    const box = new THREE.Box3();
    for (const p of points) box.expandByPoint(P(...p));
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
    const dir = new THREE.Vector3(-0.55, 0.5, 0.85).normalize();
    this.setView(c.clone().add(dir.multiplyScalar(size * 0.95 + 6)), c);
  }

  /** 케이스(착륙장 · 목표점) 표시 */
  setCase(input) {
    clearGroup(this.static);
    this.input = input;
    if (!input) return;
    input.starts.forEach((s, i) => {
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ color: 0x2c3e5c, side: THREE.DoubleSide }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.copy(P(s[0], s[1], 0.004));
      const l = label(String(i), 'pad-label');
      l.position.copy(P(s[0], s[1] - 0.6, 0));
      this.static.add(pad, l);
    });
    const tgeo = new THREE.SphereGeometry(0.12, 12, 8);
    input.targets.forEach((t, k) => {
      const m = new THREE.Mesh(tgeo, new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.85 }));
      m.position.copy(P(...t));
      const ring = new THREE.Mesh(new THREE.SphereGeometry(input.tol ?? 0.1, 10, 6), new THREE.MeshBasicMaterial({ color: 0xffa23a, wireframe: true, transparent: true, opacity: 0.3 }));
      ring.position.copy(m.position);
      const l = label(String(k), 'target-label');
      l.position.copy(P(t[0], t[1], t[2] + 0.35));
      this.static.add(m, ring, l);
    });
    this.setPaths(null);
    this.fitView([...input.starts, ...input.targets]);
  }

  /** 경로 리플레이 준비. paths: [[[t,x,y,z]...]...] */
  setPaths(paths, { collision = null, highlight = null } = {}) {
    clearGroup(this.dyn);
    this.drones = [];
    this.paths = paths;
    this.collision = collision;
    this.t = 0;
    this.duration = paths ? Math.max(...paths.map((p) => p[p.length - 1][0])) : 0;
    const n = this.input ? this.input.starts.length : 0;
    const count = paths ? paths.length : n;
    for (let i = 0; i < count; i++) {
      const color = hue(i, count);
      const d = buildDrone({ size: 0.42, accent: color.getHex() });
      const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.3, 0.3, 0.3)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 }));
      d.add(box);
      box.scale.setScalar(1 / d.scale.x);
      const tag = label(String(i), 'drone-tag');
      tag.element.style.color = '#' + color.getHexString();
      tag.position.set(0, 0.45 / d.scale.x, 0);
      d.add(tag);
      d.userData.tag = tag;
      d.userData.color = color;
      this.dyn.add(d);
      this.drones.push(d);
      if (paths) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(paths[i].map((w) => P(w[1], w[2], w[3]))),
          new THREE.LineBasicMaterial({ color, transparent: true, opacity: highlight == null || highlight === i ? 0.45 : 0.08 }));
        line.visible = this.showPaths;
        d.userData.line = line;
        this.dyn.add(line);
      } else if (this.input) {
        const s = this.input.starts[i];
        d.position.copy(P(...s));
      }
    }
    if (collision) {
      const g = new THREE.Group();
      g.position.copy(P(...collision.pos));
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.35, depthWrite: false })));
      g.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.6, 0.6, 0.6)), new THREE.LineBasicMaterial({ color: 0xff3030 })));
      const l = label(`💥 드론 ${collision.i} ↔ ${collision.j}  t=${collision.t.toFixed(2)}s`, 'collision-label');
      l.position.set(0, 0.7, 0);
      g.add(l);
      g.visible = false;
      this.collisionMarker = g;
      this.dyn.add(g);
    } else this.collisionMarker = null;
    if (paths) {
      const pts = [];
      for (const p of paths) for (let k = 0; k < p.length; k += Math.max(1, Math.floor(p.length / 20))) pts.push(p[k].slice(1));
      if (this.input) pts.push(...this.input.starts, ...this.input.targets);
      this.fitView(pts);
    }
    this.update();
  }

  setTime(t) { this.t = Math.max(0, Math.min(this.duration, t)); this.update(); }
  play() { if (this.t >= this.duration) this.t = 0; this.playing = true; }
  pause() { this.playing = false; }
  togglePaths(v) { this.showPaths = v; this.drones.forEach((d) => { if (d.userData.line) d.userData.line.visible = v; }); }
  toggleLabels(v) { this.showLabels = v; this.drones.forEach((d) => { d.userData.tag.visible = v; }); }

  update() {
    if (!this.paths) return;
    const t = this.t;
    this.paths.forEach((p, i) => {
      const d = this.drones[i];
      const pos = positionAt(p, t);
      d.position.copy(P(...pos));
      const flying = pos[2] > 0.02;
      d.userData.armed = flying;
    });
    if (this.collisionMarker) {
      const c = this.collision;
      const hit = t >= c.t - 1e-6;
      this.collisionMarker.visible = hit;
      [c.i, c.j].forEach((k) => {
        const tag = this.drones[k].userData.tag.element;
        tag.classList.toggle('hit', hit);
      });
      if (hit && this.playing && t - c.t < 0.05) this.playing = false;
    }
    if (this.onTime) this.onTime(t, this.duration);
  }

  tick(dt) {
    if (this.playing && this.paths) {
      let t = this.t + dt * this.speed;
      if (this.collision && this.t < this.collision.t && t >= this.collision.t) { t = this.collision.t; this.playing = false; }
      if (t >= this.duration) { t = this.duration; this.playing = false; }
      this.t = t;
      this.update();
    }
    for (const d of this.drones) animateDrone(d, dt, { armed: !!d.userData.armed, ledOn: !!d.userData.armed, ledColor: [d.userData.color.r * 255, d.userData.color.g * 255, d.userData.color.b * 255] });
  }
}
