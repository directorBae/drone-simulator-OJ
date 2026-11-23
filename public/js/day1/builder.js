// MAVLink 메시지 작성기: 코드 없이 메시지를 골라 필드를 채우고 바로 드론에 보냄
import { esc, hexHtml, HEX_LEGEND } from '../core/ui.js';

const ML = window.MAVLink;
const MODES = { STABILIZE: 0, ALT_HOLD: 2, GUIDED: 4, LOITER: 5, RTL: 6, LAND: 9, BRAKE: 17 };
const CMD = (command, ...p) => ({ msg: 'COMMAND_LONG', f: { command, confirmation: 0, ...Object.fromEntries(p.map((v, i) => ['param' + (i + 1), v])) } });

// 프리셋: 자주 쓰는 메시지를 미리 채워 둠 (필드는 화면에서 고칠 수 있음)
const PRESETS = [
  { group: '모드 · 시동', name: 'GUIDED 모드로 (SET_MODE)', ...{ msg: 'SET_MODE', f: { base_mode: 1, custom_mode: 4 } } },
  { group: '모드 · 시동', name: '시동 ARM (COMMAND_LONG 400)', ...CMD(400, 1) },
  { group: '모드 · 시동', name: '시동 끄기 DISARM (400)', ...CMD(400, 0) },
  { group: '비행', name: '이륙 5m (NAV_TAKEOFF 22)', ...CMD(22, 0, 0, 0, 0, 0, 0, 5) },
  { group: '비행', name: '위치 이동 (SET_POSITION_TARGET_LOCAL_NED)', msg: 'SET_POSITION_TARGET_LOCAL_NED', f: { coordinate_frame: 1, type_mask: 0b110111111000, x: 10, y: 0, z: -5 } },
  { group: '비행', name: '속도 명령 북쪽 2m/s (LOCAL_NED 속도)', msg: 'SET_POSITION_TARGET_LOCAL_NED', f: { coordinate_frame: 1, type_mask: 0b110111000111, vx: 2 } },
  { group: '비행', name: '방향 90° 로 회전 (CONDITION_YAW 115)', ...CMD(115, 90, 30, 1, 0) },
  { group: '비행', name: '속도 변경 3m/s (DO_CHANGE_SPEED 178)', ...CMD(178, 1, 3, -1) },
  { group: '비행', name: '착륙 (NAV_LAND 21)', ...CMD(21) },
  { group: '비행', name: '귀환 (RETURN_TO_LAUNCH 20)', ...CMD(20) },
  { group: 'LED', name: 'LED 빨강 (LED_CONTROL)', msg: 'LED_CONTROL', f: { instance: 42, pattern: 42, custom_len: 3, custom_bytes: [255, 0, 0] } },
  { group: 'LED', name: 'LED 초록 2Hz 깜빡임 (LED_CONTROL)', msg: 'LED_CONTROL', f: { instance: 42, pattern: 42, custom_len: 4, custom_bytes: [0, 255, 0, 2] } },
  { group: 'LED', name: 'LED 끄기 (LED_CONTROL pattern 0)', msg: 'LED_CONTROL', f: { instance: 42, pattern: 0, custom_len: 0, custom_bytes: [] } },
  { group: 'LED', name: '릴레이 LED 켜기 (DO_SET_RELAY 181)', ...CMD(181, 0, 1) },
  { group: 'LED', name: '5번 깜빡이기 (DO_REPEAT_RELAY 182)', ...CMD(182, 0, 5, 0.6) },
  { group: '기타', name: '지상국 HEARTBEAT', msg: 'HEARTBEAT', f: { type: 6, autopilot: 8, base_mode: 0, custom_mode: 0, system_status: 4, mavlink_version: 3 } },
  { group: '기타', name: 'ATTITUDE 1회 요청 (REQUEST_MESSAGE 512)', ...CMD(512, 30) },
  { group: '기타', name: '위치 메시지 20Hz (SET_MESSAGE_INTERVAL 511)', ...CMD(511, 32, 50000) },
];
const SENDABLE = ['HEARTBEAT', 'SET_MODE', 'COMMAND_LONG', 'SET_POSITION_TARGET_LOCAL_NED', 'SET_POSITION_TARGET_GLOBAL_INT', 'LED_CONTROL', 'REQUEST_DATA_STREAM'];

export class MessageBuilder {
  constructor(root, { onSend, getDrones }) {
    this.root = root;
    this.onSend = onSend;
    this.getDrones = getDrones;
    this.seq = 0;
    root.innerHTML = `
      <div class="mb-row">
        <label>빠른 선택 <select class="mb-preset"></select></label>
        <label>메시지 <select class="mb-msg"></select></label>
        <label>대상 드론 <select class="mb-target"></select></label>
      </div>
      <div class="mb-help dim"></div>
      <div class="mb-fields"></div>
      <div class="mb-preview">
        <div class="mb-sec">전송될 바이트 <span class="dim">(MAVLink 2 · 보낸 쪽 SYSID 255 / COMPID 190)</span></div>
        <div class="hex mb-hex"></div>${HEX_LEGEND}</div>
        <div class="mb-sec">같은 동작을 하는 파이썬 코드</div>
        <pre class="mb-code"></pre>
      </div>
      <div class="mb-actions"><button class="btn primary mb-send">📡 드론에 전송</button><button class="btn mb-copy">코드 복사</button><span class="mb-msgout dim"></span></div>`;
    this.$ = (s) => root.querySelector(s);
    const ps = this.$('.mb-preset');
    ps.add(new Option('— 프리셋 고르기 —', ''));
    let group = null, og = null;
    PRESETS.forEach((p, i) => {
      if (p.group !== group) { group = p.group; og = document.createElement('optgroup'); og.label = group; ps.appendChild(og); }
      og.appendChild(new Option(p.name, String(i)));
    });
    for (const n of SENDABLE) this.$('.mb-msg').add(new Option(`${n} (${ML.BY_NAME[n].id})`, n));
    ps.onchange = () => { const p = PRESETS[+ps.value]; if (p) this.load(p.msg, p.f); };
    this.$('.mb-msg').onchange = () => this.load(this.$('.mb-msg').value, {});
    this.$('.mb-target').onchange = () => this.preview();
    this.$('.mb-send').onclick = () => this.send();
    this.$('.mb-copy').onclick = () => navigator.clipboard?.writeText(this.$('.mb-code').textContent);
    this.refreshTargets();
    this.load('COMMAND_LONG', CMD(400, 1).f);
  }

  refreshTargets() {
    const sel = this.$('.mb-target');
    const cur = sel.value;
    sel.innerHTML = '';
    const n = this.getDrones();
    for (let i = 1; i <= n; i++) sel.add(new Option(`#${i} (SYSID ${i})`, String(i)));
    if (n > 1) sel.add(new Option('전체 (target_system = 0)', '0'));
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
    this.preview();
  }

  load(name, preset) {
    this.name = name;
    this.$('.mb-msg').value = name;
    const d = ML.BY_NAME[name];
    const help = {
      COMMAND_LONG: 'command 번호와 param1~7 로 동작을 정합니다. 결과는 COMMAND_ACK 로 돌아옵니다.',
      SET_MODE: 'base_mode=1(CUSTOM_MODE_ENABLED), custom_mode = ArduCopter 모드 번호 (GUIDED=4, LAND=9, RTL=6 …)',
      SET_POSITION_TARGET_LOCAL_NED: 'NED: z 는 아래가 + → 고도 5m 는 z=-5. type_mask 0b110111111000 = 위치만, 0b110111000111 = 속도만',
      LED_CONTROL: 'custom_len=3 → custom_bytes 앞 3개가 R,G,B. custom_len=4 → 4번째가 깜빡임(Hz). pattern=0 → 끔',
      HEARTBEAT: '지상국도 HEARTBEAT 를 보내 "살아 있음"을 알립니다 (type 6 = GCS)',
    }[name] || '';
    this.$('.mb-help').textContent = help;
    const box = this.$('.mb-fields');
    box.innerHTML = '';
    for (const f of d.fields) {
      if (f.name === 'target_system') continue;
      let v = preset[f.name];
      if (f.name === 'target_component') v = v ?? 1;
      const wrap = document.createElement('label');
      wrap.className = 'mb-field';
      const type = f.len ? `${f.type}[${f.len}]` : f.type;
      let input;
      if (name === 'SET_MODE' && f.name === 'custom_mode') {
        input = document.createElement('select');
        for (const [k, n] of Object.entries(MODES)) input.add(new Option(`${n} = ${k}`, String(n)));
        input.value = String(v ?? 4);
      } else if (f.name === 'type_mask') {
        input = document.createElement('input');
        input.value = '0b' + (v ?? 0b110111111000).toString(2);
      } else {
        input = document.createElement('input');
        input.value = f.len ? (v || []).join(', ') : String(v ?? 0);
      }
      input.dataset.field = f.name;
      input.oninput = input.onchange = () => this.preview();
      wrap.innerHTML = `<span class="mb-fname">${esc(f.name)}</span><span class="mb-ftype dim">${type}</span>`;
      wrap.appendChild(input);
      box.appendChild(wrap);
    }
    this.preview();
  }

  values() {
    const d = ML.BY_NAME[this.name];
    const out = {};
    let err = null;
    for (const f of d.fields) {
      if (f.name === 'target_system') { out[f.name] = +this.$('.mb-target').value; continue; }
      const el = this.root.querySelector(`[data-field="${f.name}"]`);
      const raw = (el?.value ?? '0').trim();
      if (f.len && f.type !== 'char') {
        out[f.name] = raw ? raw.split(/[\s,]+/).map(Number) : [];
        if (out[f.name].some((x) => !Number.isFinite(x))) err = `${f.name}: 숫자 목록이어야 합니다`;
        if (out[f.name].length > f.len) err = `${f.name}: 최대 ${f.len}개`;
      } else if (f.type === 'char') out[f.name] = raw;
      else {
        const n = raw.startsWith('0b') ? parseInt(raw.slice(2), 2) : Number(raw);
        if (!Number.isFinite(n)) err = `${f.name}: 숫자가 아닙니다 ("${raw}")`;
        else if (f.type !== 'float' && !Number.isInteger(n)) err = `${f.name}: ${f.type} 는 정수여야 합니다`;
        out[f.name] = n;
      }
    }
    return { out, err };
  }

  preview() {
    if (!this.name) return;
    const { out, err } = this.values();
    const d = ML.BY_NAME[this.name];
    this.$('.mb-msgout').textContent = err ? '⚠ ' + err : '';
    this.$('.mb-send').disabled = !!err;
    if (err) return;
    this.frame = ML.encode(this.name, out, this.seq, 255, 190);
    this.$('.mb-hex').innerHTML = hexHtml(ML.toHex(this.frame));
    const args = d.fields.map((f) => {
      const v = out[f.name];
      if (f.name === 'target_system') return v === 0 ? '0' : 'm.target_system' + (v > 1 ? ` + ${v - 1}` : '');
      if (f.name === 'type_mask') return '0b' + v.toString(2);
      if (f.len) { const a = [...v]; while (a.length < f.len) a.push(0); return `[${a.slice(0, Math.max(v.length, 1)).join(', ')}] + [0] * ${f.len - Math.max(v.length, 1)}`; }
      return typeof v === 'number' && !Number.isInteger(v) ? String(v) : String(v);
    });
    this.$('.mb-code').textContent = `m.mav.${this.name.toLowerCase()}_send(${args.join(', ')})`;
  }

  send() {
    this.preview();
    if (!this.frame) return;
    this.onSend(MAVLink.toHex(this.frame), this.name);
    this.seq = (this.seq + 1) & 255;
    this.preview();
    this.$('.mb-msgout').textContent = `✓ ${this.name} 전송 (seq ${(this.seq + 255) & 255})`;
  }
}
