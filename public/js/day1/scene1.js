// 1일차 3D 장면: NED 좌표계, 드론 N대, LED, 지상국 ↔ 드론 신호 펄스, 충돌 표시
import { Stage, THREE, CSS2DObject, label, buildDrone, animateDrone, Trail, clearGroup, removeObject } from '../core/stage.js';

const ned = (n, e, d) => new THREE.Vector3(e, -d, -n); // NED → three (x=동, y=위, z=남)
const GCS_POS = new THREE.Vector3(-4, 0, 4);          // 지상국(노트북+안테나) 위치: 남서쪽
const DRONE_COLORS = [0xff4b4b, 0x4cd97b, 0x5aa8ff, 0xffc94a, 0xb48cff];

export class Day1Scene extends Stage {
  constructor(el) {
    super(el);
    this.drones = [];
    this.trails = [];
    this.disp = [];
    this.pulses = [];
    this.state = null;
    this.follow = true;
    this.followTarget = () => this.disp[0];
    this.resetView();

    const axes = [[new THREE.Vector3(0, 0, -1), 0xff5a5a, 'N (+x)'], [new THREE.Vector3(1, 0, 0), 0x4cd97b, 'E (+y)'], [new THREE.Vector3(0, 1, 0), 0x5aa8ff, '위 (−z)']];
    for (const [dir, color, text] of axes) {
      this.scene.add(new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0.02, 0), 5, color, 0.6, 0.3));
      const l = label(text, 'axis-label', color);
      l.position.copy(dir.clone().multiplyScalar(5.8));
      this.scene.add(l);
    }
    for (let m = 10; m <= 50; m += 10) {
      const a = label(`N ${m}m`, 'tick-label'); a.position.copy(ned(m, 0, 0)); this.scene.add(a);
      const b = label(`E ${m}m`, 'tick-label'); b.position.copy(ned(0, m, 0)); this.scene.add(b);
    }

    // 지상국 (노트북 + 안테나)
    const gcs = new THREE.Group();
    gcs.position.copy(GCS_POS);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.6), new THREE.MeshStandardMaterial({ color: 0x3a4456 }));
    base.position.y = 0.6;
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.03), new THREE.MeshStandardMaterial({ color: 0x1b2a44, emissive: 0x1e5aa8, emissiveIntensity: 0.6 }));
    screen.position.set(0, 0.88, -0.3);
    screen.rotation.x = -0.25;
    const table = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.58, 0.8), new THREE.MeshStandardMaterial({ color: 0x2a2f38 }));
    table.position.y = 0.29;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6), new THREE.MeshStandardMaterial({ color: 0x9aa8bd }));
    mast.position.set(0.5, 1.4, 0);
    this.antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: 0x555555 }));
    this.antennaTip.position.set(0.5, 2.2, 0);
    gcs.add(table, base, screen, mast, this.antennaTip);
    const gl = label('지상국 (내 코드)', 'gcs-label');
    gl.position.set(0, 2.6, 0);
    gcs.add(gl);
    this.scene.add(gcs);
    this.antennaWorld = GCS_POS.clone().add(new THREE.Vector3(0.5, 2.2, 0));

    this.bubbleEl = document.createElement('div');
    this.bubbleEl.className = 'bubble';
    this.bubble = new CSS2DObject(this.bubbleEl);
    this.bubbleAnchor = new THREE.Object3D();
    this.bubble.position.set(0, 0.9, 0);
    this.bubbleAnchor.add(this.bubble);
    this.scene.add(this.bubbleAnchor);

    this.collisionGroup = new THREE.Group();
    this.scene.add(this.collisionGroup);
    this.missionGroup = new THREE.Group();
    this.scene.add(this.missionGroup);
    this.pulseGeo = new THREE.SphereGeometry(0.09, 10, 8);
    this.frameHooks.push((dt) => this.tick(dt));
  }

  resetView() {
    const p = this.disp[0] ? this.disp[0].clone() : new THREE.Vector3();
    this.setView(p.clone().add(new THREE.Vector3(-8, 6, 10)), p.clone().add(new THREE.Vector3(0, 1, 0)));
  }

  ensureDrones(n) {
    while (this.drones.length < n) {
      const i = this.drones.length;
      const color = DRONE_COLORS[i % DRONE_COLORS.length];
      const d = buildDrone({ size: 0.9, accent: color });
      const tag = label(`#${i + 1}`, 'drone-tag', color);
      tag.position.set(0, 0.45, 0);
      d.add(tag);
      const pad = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.72, 40), new THREE.MeshBasicMaterial({ color: 0xffc94a, side: THREE.DoubleSide }));
      pad.rotation.x = -Math.PI / 2;
      d.userData.pad = pad;
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.4, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      d.userData.shadow = shadow;
      const tg = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), new THREE.MeshBasicMaterial({ color: 0x3ef0ff, wireframe: true }));
      tg.visible = false;
      d.userData.target = tg;
      this.scene.add(d, pad, shadow, tg);
      this.drones.push(d);
      this.trails.push(new Trail(this.scene, i === 0 ? 0xffb347 : color));
      this.disp.push(new THREE.Vector3());
    }
    while (this.drones.length > n) {
      const d = this.drones.pop();
      removeObject(this.scene, d); this.scene.remove(d.userData.pad, d.userData.shadow, d.userData.target);
      this.trails.pop().dispose(this.scene);
      this.disp.pop();
    }
  }

  setState(snap) {
    const first = !this.state || this.state.vehicles.length !== snap.vehicles.length;
    this.state = snap;
    this.ensureDrones(snap.vehicles.length);
    snap.vehicles.forEach((s, i) => {
      if (first) this.disp[i].copy(ned(...s.pos));
      const h = this.drones[i].userData.pad;
      h.position.copy(ned(s.home[0], s.home[1], 0)).setY(0.01);
    });
    // 충돌 표시
    if (snap.collisions.length !== this.collisionGroup.children.length) {
      clearGroup(this.collisionGroup);
      for (const c of snap.collisions) {
        const g = new THREE.Group();
        g.position.copy(ned(...c.pos));
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.35, depthWrite: false })));
        const l = label(`💥 #${c.a} ↔ #${c.b}  t+${c.t.toFixed(1)}s`, 'collision-label');
        l.position.set(0, 0.9, 0);
        g.add(l);
        this.collisionGroup.add(g);
      }
    }
  }

  /** 신호 펄스: dir 'up' = 지상국 → 드론, 'down' = 드론 → 지상국 */
  pulse(dir, sysid, important) {
    if (this.pulses.length > 60) return;
    const i = this.state ? this.state.vehicles.findIndex((v) => v.sysid === sysid) : 0;
    const targets = sysid === 0 || sysid === undefined ? this.disp.map((_, k) => k) : [i];
    for (const k of targets) {
      if (k < 0 || !this.disp[k]) continue;
      const m = new THREE.Mesh(this.pulseGeo, new THREE.MeshBasicMaterial({ color: dir === 'up' ? 0xffa23a : 0x4ea1ff, transparent: true, opacity: important ? 1 : 0.55 }));
      m.scale.setScalar(important ? 1.4 : 0.8);
      this.scene.add(m);
      this.pulses.push({ m, k, dir, t: 0, dur: 0.45 });
    }
    this.antennaTip.material.color.setHex(dir === 'up' ? 0xffa23a : 0x4ea1ff);
    this.antennaFlash = 0.15;
  }

  say(text) {
    this.bubbleEl.textContent = text.length > 90 ? text.slice(0, 88) + '…' : text;
    this.bubbleEl.classList.add('show');
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => this.bubbleEl.classList.remove('show'), 3500);
  }

  clearTrails() { this.trails.forEach((t) => t.clear()); }

  /** 미션 체크포인트 표시용 마커 */
  setMissionMarkers(list) {
    clearGroup(this.missionGroup);
    for (const m of list) {
      const g = new THREE.Group();
      g.position.copy(ned(m.n, m.e, -m.alt));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.04, 8, 32), new THREE.MeshBasicMaterial({ color: m.done ? 0x3ddc84 : 0xb48cff }));
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      const l = label(m.label, 'marker-label', m.done ? 0x3ddc84 : 0xb48cff);
      l.position.set(0, 0.5, 0);
      g.add(l);
      this.missionGroup.add(g);
    }
  }

  tick(dt) {
    const snap = this.state;
    if (this.antennaFlash > 0) { this.antennaFlash -= dt; if (this.antennaFlash <= 0) this.antennaTip.material.color.setHex(0x555555); }
    if (!snap) return;
    snap.vehicles.forEach((s, i) => {
      const d = this.drones[i];
      const disp = this.disp[i];
      disp.lerp(ned(...s.pos), Math.min(1, dt * 18));
      d.position.copy(disp);
      d.rotation.set(s.pitch, -s.yaw, -s.roll, 'YXZ');
      animateDrone(d, dt, s);
      const alt = Math.max(0, disp.y);
      const sh = d.userData.shadow;
      sh.position.set(disp.x, 0.006, disp.z);
      sh.scale.setScalar(1 + alt * 0.04);
      sh.material.opacity = Math.max(0.08, 0.42 - alt * 0.012);
      const tg = d.userData.target;
      tg.visible = !!(s.mode === 4 && s.target && !s.landed);
      if (tg.visible) tg.position.copy(ned(...s.target));
      if (!s.landed || alt > 0.05) this.trails[i].add(disp);
    });
    this.bubbleAnchor.position.copy(this.disp[0]);
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t += dt;
      const f = Math.min(1, p.t / p.dur);
      const drone = this.disp[p.k] ? this.disp[p.k].clone().add(new THREE.Vector3(0, 0.2, 0)) : this.antennaWorld;
      const [a, b] = p.dir === 'up' ? [this.antennaWorld, drone] : [drone, this.antennaWorld];
      p.m.position.lerpVectors(a, b, f);
      p.m.position.y += Math.sin(f * Math.PI) * 1.2;
      if (f >= 1) { this.scene.remove(p.m); p.m.material.dispose(); this.pulses.splice(i, 1); }
    }
  }
}
