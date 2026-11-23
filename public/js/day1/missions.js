// 1일차 미션 체크포인트 (슬라이드 '미션: 네 개의 체크포인트') — 시뮬레이션 상태를 보고 자동으로 체크
const SQUARE = [[10, 0], [10, 10], [0, 10], [0, 0]];

export class Missions {
  constructor(root, onChange) {
    this.root = root;
    this.onChange = onChange;
    this.reset();
  }
  reset() {
    this.st = { connected: false, linkOpenAt: null, takeoffAck: false, flewHigh: false, sq: 0, flew: false, landMode: false, landed: false, two: false, spiral: 0, lastHead: null, led: false };
    this.render();
  }
  get items() {
    const s = this.st;
    return [
      { id: 1, title: '연결', desc: 'HEARTBEAT 수신, 내 SYSID 확인', done: s.connected },
      { id: 2, title: '이륙', desc: '시동 후 고도 5 m, COMMAND_ACK 확인', done: s.takeoffAck && s.flewHigh },
      { id: 3, title: '이동', desc: `한 변 10 m 정사각형 비행 (${s.sq}/4)`, done: s.sq >= 4 },
      { id: 4, title: '착륙', desc: 'LAND 명령, 고도 0 확인', done: s.landed },
      { id: 'b1', title: '보너스', desc: 'LED 켜 보기', done: s.led, bonus: true },
      { id: 'b2', title: '보너스', desc: `3D 나선 경로 (${Math.min(360, Math.round(Math.abs(s.spiral) * 57.3))}°/360°)`, done: Math.abs(s.spiral) >= 2 * Math.PI, bonus: true },
      { id: 'b3', title: '보너스', desc: '기체 2대 동시 비행', done: s.two, bonus: true },
    ];
  }
  onEvent(ev) {
    const s = this.st;
    if (ev.kind === 'link' && ev.open) s.linkOpenAt = ev.t;
    if (ev.kind === 'msg' && ev.dir === 'RX' && ev.name === 'COMMAND_ACK' && ev.fields.command === 22 && ev.fields.result === 0) s.takeoffAck = true;
  }
  onSnap(snap) {
    const s = this.st, before = JSON.stringify(this.items.map((i) => i.done));
    if (snap.linkOpen && snap.stats.rxPkts > 0) s.connected = true;
    const v = snap.vehicles[0];
    const alt = -v.pos[2];
    const ln = v.pos[0] - v.home[0], le = v.pos[1] - v.home[1];
    if (v.armed && alt >= 4.5) s.flewHigh = true;
    if (!v.landed && alt > 1) s.flew = true;
    if (s.sq < 4 && !v.landed && alt > 2) {
      const [n, e] = SQUARE[s.sq];
      if (Math.hypot(ln - n, le - e) < 1.5) s.sq++;
    }
    if (v.mode === 9 && s.flew) s.landMode = true;
    if (s.landMode && v.landed && alt < 0.05) s.landed = true;
    if (v.ledOn) s.led = true;
    if (snap.vehicles.filter((x) => !x.landed && -x.pos[2] > 1 && !x.crashed).length >= 2) s.two = true;
    // 나선: 상승/하강하면서 진행 방향이 돌아간 누적 각도
    const sp = Math.hypot(v.vel[0], v.vel[1]);
    if (!v.landed && sp > 0.8 && Math.abs(v.vel[2]) > 0.15) {
      const h = Math.atan2(v.vel[1], v.vel[0]);
      if (s.lastHead !== null) { let d = h - s.lastHead; d = Math.atan2(Math.sin(d), Math.cos(d)); s.spiral += d; }
      s.lastHead = h;
    } else if (sp < 0.3) s.lastHead = null;
    if (JSON.stringify(this.items.map((i) => i.done)) !== before) { this.render(); this.onChange && this.onChange(); }
  }
  markers() {
    return SQUARE.map(([n, e], i) => ({ n, e, alt: 5, label: `${i + 1}`, done: this.st.sq > i }));
  }
  render() {
    this.root.innerHTML = this.items.map((it) => `
      <div class="ms ${it.done ? 'done' : ''} ${it.bonus ? 'bonus' : ''}">
        <span class="ms-n">${it.done ? '✔' : it.bonus ? '★' : it.id}</span>
        <span><b>${it.title}</b> <span class="dim">${it.desc}</span></span>
      </div>`).join('');
  }
}
