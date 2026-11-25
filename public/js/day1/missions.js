// 1일차 미션 체크포인트 (슬라이드 '미션: 네 개의 체크포인트') — 시뮬레이션 상태를 보고 자동으로 체크
// 학생이 하나씩 따라가도록: 지금 할 체크포인트만 펼쳐서 할 일 · 힌트 · 사전 링크 · 통과 조건을 보여 줌 (정답 코드는 없음)
import { esc } from '../core/ui.js';

const SQUARE = [[10, 0], [10, 10], [0, 10], [0, 0]];

// 체크포인트별 안내. links: [보이는 이름, MAVLink 사전 카드 id]
const GUIDE = {
  1: {
    goal: '가상 드론과 연결하고, 드론이 보내는 HEARTBEAT 를 받아 내 드론의 SYSID 를 확인하세요.',
    steps: ['<code>m = connect()</code> 로 링크 열기', '<code>m.wait_heartbeat()</code> 로 첫 HEARTBEAT 기다리기', '<code>m.target_system</code> (= 드론 SYSID) 출력해 보기'],
    links: [['HEARTBEAT', 'msg-HEARTBEAT'], ['pymavlink 함수', 'sec-pymav']],
    check: 'HEARTBEAT 를 받으면 자동으로 체크됩니다.',
  },
  2: {
    goal: '시동을 걸고 고도 5 m 까지 이륙하세요. 드론이 명령을 받아들였는지 COMMAND_ACK 로 확인합니다.',
    steps: ['비행 모드를 <b>GUIDED</b> 로 (코드로 조종하는 모드)', '시동 걸기 — COMMAND_LONG 으로 <code>MAV_CMD_COMPONENT_ARM_DISARM</code>', '이륙 — <code>MAV_CMD_NAV_TAKEOFF</code>, 고도는 <b>param7</b>', '이륙에는 몇 초 걸립니다: <code>time.sleep()</code> 또는 LOCAL_POSITION_NED 로 고도 확인'],
    links: [['SET_MODE', 'msg-SET_MODE'], ['비행 모드 표', 'tbl-modes'], ['COMMAND_LONG', 'msg-COMMAND_LONG'], ['ARM/DISARM', 'cmd-400'], ['TAKEOFF', 'cmd-22'], ['COMMAND_ACK', 'msg-COMMAND_ACK']],
    check: '고도 4.5 m 이상 + TAKEOFF 명령의 COMMAND_ACK 가 "수락(0)" 이면 체크됩니다.',
    tip: '드론이 꿈쩍 안 하면 콘솔의 회색 [sim] 로그를 보세요. 거절 이유가 나옵니다 (모드 · 시동 순서 등).',
  },
  3: {
    goal: '고도 5 m 를 유지하며 한 변 10 m 정사각형을 그리세요. 3D 화면의 1 → 2 → 3 → 4 표시를 차례로 지나면 됩니다.',
    steps: ['꼭짓점 (북, 동) = (10, 0) → (10, 10) → (0, 10) → (0, 0)', '위치 명령 — <code>SET_POSITION_TARGET_LOCAL_NED</code> (좌표계 LOCAL_NED, 위치만 쓰는 type_mask)', '<b>NED 의 z 는 아래가 +</b> → 고도 5 m 는 z = −5', '다음 꼭짓점으로 가기 전에 도착할 시간을 주세요 (sleep 또는 LOCAL_POSITION_NED)'],
    links: [['SET_POSITION_TARGET_LOCAL_NED', 'msg-SET_POSITION_TARGET_LOCAL_NED'], ['좌표계 표', 'tbl-frame'], ['type_mask 표', 'tbl-mask'], ['LOCAL_POSITION_NED', 'msg-LOCAL_POSITION_NED']],
    check: '각 꼭짓점을 순서대로 1.5 m 안으로 지나면 하나씩 올라갑니다 (지금 (n/4)).',
  },
  4: {
    goal: '그 자리에 착륙시키세요. 땅에 닿으면 시동이 자동으로 꺼집니다.',
    steps: ['착륙 — <code>MAV_CMD_NAV_LAND</code>', '고도가 0 이 될 때까지 기다리기 (LOCAL_POSITION_NED 또는 HEARTBEAT 의 시동 상태)'],
    links: [['LAND', 'cmd-21'], ['LOCAL_POSITION_NED', 'msg-LOCAL_POSITION_NED']],
    check: 'LAND 모드에서 고도 0 에 닿으면 체크됩니다.',
  },
  b1: { goal: 'LED 색을 바꿔 보세요. 단색 · 깜빡임 모두 가능합니다.', links: [['LED_CONTROL', 'msg-LED_CONTROL'], ['DO_SET_RELAY', 'cmd-181'], ['DO_REPEAT_RELAY', 'cmd-182']] },
  b2: { goal: '올라가면서(또는 내려가면서) 한 바퀴 이상 도는 나선 경로를 그려 보세요.', links: [['SET_POSITION_TARGET_LOCAL_NED', 'msg-SET_POSITION_TARGET_LOCAL_NED']] },
  b3: { goal: '위쪽 "드론" 개수를 2대로 바꾸고 두 대를 동시에 띄워 보세요. 드론마다 SYSID 가 다릅니다.', links: [['HEARTBEAT', 'msg-HEARTBEAT'], ['COMMAND_LONG', 'msg-COMMAND_LONG']] },
};

export class Missions {
  /** opts: { onChange(), onComplete(item, next), onLink(dictId), onGoCode() } — 옛 방식(onChange 함수)도 받음 */
  constructor(root, opts = {}) {
    this.root = root;
    const o = typeof opts === 'function' ? { onChange: opts } : opts;
    this.onChange = o.onChange; this.onComplete = o.onComplete; this.onLink = o.onLink; this.onGoCode = o.onGoCode;
    this.expanded = new Set();
    root.addEventListener('click', (e) => {
      const link = e.target.closest('[data-dict]');
      if (link) { this.onLink && this.onLink(link.dataset.dict); return; }
      if (e.target.closest('[data-gocode]')) { this.onGoCode && this.onGoCode(); return; }
      const head = e.target.closest('[data-toggle]');
      if (head) {
        const id = head.dataset.toggle;
        if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
        this.render();
      }
    });
    this.reset();
  }
  reset() {
    this.st = { connected: false, linkOpenAt: null, takeoffAck: false, flewHigh: false, sq: 0, flew: false, landMode: false, landed: false, two: false, spiral: 0, lastHead: null, led: false };
    this.expanded.clear();
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
  /** 본 미션 진행 (완료 수, 전체) */
  get progress() { const main = this.items.filter((i) => !i.bonus); return { done: main.filter((i) => i.done).length, total: main.length }; }
  onEvent(ev) {
    const s = this.st;
    if (ev.kind === 'link' && ev.open) s.linkOpenAt = ev.t;
    if (ev.kind === 'msg' && ev.dir === 'RX' && ev.name === 'COMMAND_ACK' && ev.fields.command === 22 && ev.fields.result === 0) s.takeoffAck = true;
  }
  onSnap(snap) {
    const s = this.st, beforeItems = this.items, before = JSON.stringify(beforeItems.map((i) => i.done));
    if (snap.linkOpen && snap.stats.rxPkts > 0) s.connected = true;
    const v = snap.vehicles[0];
    const alt = -v.pos[2];
    const ln = v.pos[0] - v.home[0], le = v.pos[1] - v.home[1];
    if (v.armed && alt >= 4.5) s.flewHigh = true;
    if (!v.landed && alt > 1) s.flew = true;
    const sqBefore = s.sq;
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
    const after = this.items;
    if (JSON.stringify(after.map((i) => i.done)) !== before || s.sq !== sqBefore) {
      after.forEach((it, k) => {
        if (it.done && !beforeItems[k].done) {
          const next = after.find((x) => !x.bonus && !x.done) || null;
          this.onComplete && this.onComplete(it, next);
        }
      });
      this.render();
      this.onChange && this.onChange();
    }
  }
  markers() {
    return SQUARE.map(([n, e], i) => ({ n, e, alt: 5, label: `${i + 1}`, done: this.st.sq > i }));
  }
  render() {
    const items = this.items;
    const main = items.filter((i) => !i.bonus), bonus = items.filter((i) => i.bonus);
    const current = main.find((i) => !i.done);
    const { done, total } = this.progress;
    const card = (it) => {
      const g = GUIDE[it.id] || {};
      const isCur = current && it.id === current.id;
      const open = isCur || this.expanded.has(String(it.id));
      const state = it.done ? 'done' : isCur ? 'current' : 'todo';
      return `<div class="ms ms-${state}${it.bonus ? ' bonus' : ''}">
        <div class="ms-head" data-toggle="${it.id}">
          <span class="ms-n">${it.done ? '✔' : it.bonus ? '★' : it.id}</span>
          <span class="ms-title"><b>${esc(it.title)}</b> <span class="dim">${esc(it.desc)}</span></span>
          ${isCur ? '<span class="ms-now">지금 할 일</span>' : it.done ? '<span class="ms-ok">완료</span>' : ''}
          <span class="ms-caret">${open ? '▾' : '▸'}</span>
        </div>
        ${open ? `<div class="ms-body">
          <p>${g.goal || ''}</p>
          ${g.steps ? `<ol class="ms-steps">${g.steps.map((s) => `<li>${s}</li>`).join('')}</ol>` : ''}
          ${g.links ? `<div class="ms-links">📖 사전: ${g.links.map(([n, id]) => `<button class="mini" data-dict="${id}">${esc(n)}</button>`).join('')}</div>` : ''}
          ${g.check ? `<div class="ms-check">✅ 통과 조건: ${g.check.replace('(n/4)', `(${this.st.sq}/4)`)}</div>` : ''}
          ${g.tip ? `<div class="ms-tip">💡 ${g.tip}</div>` : ''}
          ${isCur ? '<button class="btn primary ms-go" data-gocode>💻 코드 쓰러 가기</button>' : ''}
        </div>` : ''}
      </div>`;
    };
    this.root.innerHTML = `
      <div class="ms-progress"><span>진행 <b>${done}/${total}</b>${done === total ? ' — 🎉 미션 완료! 보너스에 도전해 보세요' : ''}</span><div class="boot-bar"><i style="width:${(done / total) * 100}%"></i></div></div>
      ${main.map(card).join('')}
      <h4>보너스</h4>
      ${bonus.map(card).join('')}`;
  }
}
