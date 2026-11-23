/*
 * 가상 쿼드콥터 월드 (ArduCopter 동작을 단순화해서 흉내냄)
 *  - World: 하나의 MAVLink 링크에 드론 N대 (sysid 1..N). 지상국이 보낸 바이트를 파싱해 target_system 으로 배달
 *  - Vehicle: 한 대의 드론 (물리 + 모드/명령 처리 + 텔레메트리 + LED)
 * 좌표계: NED (x=북, y=동, z=아래), 단위 m, rad.  각 드론의 LOCAL_POSITION_NED 원점 = 자기 출발 위치(home)
 * classic script → self.World, self.DroneSim(=Vehicle)
 */
(function (g) {
  'use strict';
  const ML = g.MAVLink;
  const G0 = 9.80665, D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const HOME = { lat: 37.5503, lon: 127.0731, amsl: 40.0 }; // 세종대학교 부근
  const M_PER_DEG = 111319.5;

  const MODE_NAMES = { 0: 'STABILIZE', 1: 'ACRO', 2: 'ALT_HOLD', 3: 'AUTO', 4: 'GUIDED', 5: 'LOITER', 6: 'RTL', 7: 'CIRCLE', 9: 'LAND', 16: 'POSHOLD', 17: 'BRAKE' };
  const SUPPORTED_MODES = [0, 2, 4, 5, 6, 9, 16, 17];
  const ARMABLE_MODES = [0, 2, 4, 5, 16, 17];
  const CMD_NAMES = { 11: 'SET_MODE(msg)', 16: 'NAV_WAYPOINT', 20: 'NAV_RETURN_TO_LAUNCH', 21: 'NAV_LAND', 22: 'NAV_TAKEOFF', 115: 'CONDITION_YAW', 176: 'DO_SET_MODE', 178: 'DO_CHANGE_SPEED', 181: 'DO_SET_RELAY', 182: 'DO_REPEAT_RELAY', 400: 'COMPONENT_ARM_DISARM', 511: 'SET_MESSAGE_INTERVAL', 512: 'REQUEST_MESSAGE' };
  const RESULT_NAMES = ['ACCEPTED', 'TEMPORARILY_REJECTED', 'DENIED', 'UNSUPPORTED', 'FAILED', 'IN_PROGRESS'];
  const DEFAULT_RATES = { 0: 1, 1: 1, 30: 10, 32: 10, 33: 5, 74: 4 };
  const TELEM = new Set([0, 1, 30, 32, 33, 74]);
  const COLLIDE_DIST = 0.6; // 기체 중심 간 거리 (m)

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

  function defaultState() {
    return {
      t: 0, sysid: 1, compid: 1, home: [0, 0, 0],
      pos: [0, 0, 0], vel: [0, 0, 0], acc: [0, 0, 0],
      yaw: 0, roll: 0, pitch: 0, rollRate: 0, pitchRate: 0, yawRate: 0,
      armed: false, landed: true, crashed: false, mode: 0,
      battery: 100, lowBattWarned: false, speed: 5,
      target: null, velCmd: null, velCmdT: 0,
      yawTarget: null, yawSpeed: 60, yawRateCmd: null, autoYaw: false,
      hold: [0, 0, 0], rtlPhase: 0, rtlAlt: 15,
      idleT: 0, rates: Object.assign({}, DEFAULT_RATES), lastEmit: {},
      throttle: 0,
      // LED: LED_CONTROL(186) 로 색/깜빡임, DO_SET_RELAY(181)/DO_REPEAT_RELAY(182) 로 켜기/반복 점멸
      led: [0, 0, 0], ledRate: 0, ledT0: 0, relay: false, repeat: null, ledOn: false, ledColor: [0, 0, 0],
    };
  }

  // ======================================================================  Vehicle
  class Vehicle {
    constructor(world, state) {
      this.world = world;
      this.s = Object.assign(defaultState(), state || {});
      this.s.rates = Object.assign({}, DEFAULT_RATES, (state && state.rates) || {});
      this.seq = 0;
    }

    step(dt) {
      const s = this.s;
      s.t = this.world.t;
      s.acc = [0, 0, 0];
      if (s.armed) {
        s.battery = Math.max(0, s.battery - (s.landed ? 0.01 : 0.05) * dt);
        if (s.battery <= 15 && !s.lowBattWarned) { s.lowBattWarned = true; this.statustext(4, 'Battery low: 15% remaining'); }
      }
      if (!s.armed) {
        if (!s.landed) this.freefall(dt); else s.vel = [0, 0, 0];
      } else if (s.landed) {
        s.vel = [0, 0, 0];
        s.idleT += dt;
        if (s.idleT > 10) {
          this.disarm('Disarming: idle on ground 10s');
          this.log('warn', '시동 후 10초 동안 이륙하지 않아 자동으로 시동이 꺼졌습니다 (ArduCopter DISARM_DELAY)');
        }
      } else {
        this.track(this.controller(), dt);
      }
      this.yawControl(dt);
      this.attitude(dt);
      this.throttle();
      this.ledUpdate();
      this.emitTelemetry();
    }

    // ------------------------------------------------------------ control
    controller() {
      const s = this.s;
      switch (s.mode) {
        case 4:
          if (s.velCmd) {
            if (s.t - s.velCmdT > 3) {
              s.velCmd = null; s.yawRateCmd = null; s.target = s.pos.slice();
              this.log('warn', '속도 명령이 3초간 갱신되지 않아 정지합니다 (속도 제어는 계속 반복해서 보내야 합니다)');
            } else return s.velCmd.slice();
          }
          if (!s.target) s.target = s.pos.slice();
          return this.posCtrl(s.target);
        case 9: return this.landCtrl(s.hold);
        case 6: return this.rtlCtrl();
        default: return this.posCtrl(s.hold);
      }
    }

    posCtrl(t) {
      const s = this.s;
      const ex = t[0] - s.pos[0], ey = t[1] - s.pos[1], ez = t[2] - s.pos[2];
      const dxy = Math.hypot(ex, ey);
      let vx = 0, vy = 0;
      if (dxy > 1e-3) {
        const vh = Math.min(s.speed, 1.0 * dxy, Math.sqrt(2 * 2.0 * dxy));
        vx = (ex / dxy) * vh; vy = (ey / dxy) * vh;
      }
      const az = Math.abs(ez);
      const vz = Math.sign(ez) * Math.min(1.0 * az, ez > 0 ? 1.5 : 2.5, Math.sqrt(2 * 2.0 * az));
      return [vx, vy, vz];
    }

    landCtrl(xy) {
      const s = this.s;
      const v = this.posCtrl([xy[0], xy[1], s.pos[2]]);
      v[2] = -s.pos[2] > 10 ? 2.0 : 1.0;
      return v;
    }

    rtlCtrl() {
      const s = this.s, h = s.home;
      if (s.rtlPhase === 0) {
        if (Math.abs(-s.pos[2] - s.rtlAlt) < 0.3) { s.rtlPhase = 1; this.log('info', `RTL: 고도 ${s.rtlAlt}m 도달 → 홈으로 이동`); }
        return this.posCtrl([s.hold[0], s.hold[1], -s.rtlAlt]);
      }
      if (s.rtlPhase === 1) {
        if (Math.hypot(s.pos[0] - h[0], s.pos[1] - h[1]) < 0.3) { s.rtlPhase = 2; this.log('info', 'RTL: 홈 상공 도착 → 착륙'); }
        return this.posCtrl([h[0], h[1], -s.rtlAlt]);
      }
      return this.landCtrl(h);
    }

    track(vd, dt) {
      const s = this.s;
      const tau = 0.35;
      let ax = (vd[0] - s.vel[0]) / tau, ay = (vd[1] - s.vel[1]) / tau, az = (vd[2] - s.vel[2]) / tau;
      const ah = Math.hypot(ax, ay), AH = 3.5;
      if (ah > AH) { ax *= AH / ah; ay *= AH / ah; }
      az = clamp(az, -3, 3);
      s.vel[0] += ax * dt; s.vel[1] += ay * dt; s.vel[2] += az * dt;
      for (let i = 0; i < 3; i++) s.pos[i] += s.vel[i] * dt;
      s.acc = [ax, ay, az];
      if (s.pos[2] > 0) { s.pos[2] = 0; if (s.vel[2] > 0) s.vel[2] = 0; }
      if (s.pos[2] > -0.05 && vd[2] >= 0 && Math.abs(s.vel[2]) < 0.6) this.touchdown();
    }

    touchdown() {
      const s = this.s;
      s.landed = true; s.vel = [0, 0, 0]; s.pos[2] = 0; s.idleT = 0;
      s.target = null; s.velCmd = null; s.yawRateCmd = null; s.yawTarget = null;
      this.log('info', `착지했습니다 (로컬 N ${f1(s.pos[0] - s.home[0])}, E ${f1(s.pos[1] - s.home[1])})`);
      if (s.mode === 9 || s.mode === 6) this.disarm('Land complete, disarming');
    }

    freefall(dt) {
      const s = this.s;
      s.vel[2] += G0 * dt;
      for (let i = 0; i < 3; i++) { s.vel[i] *= 1 - 0.15 * dt; s.pos[i] += s.vel[i] * dt; }
      s.acc = [0, 0, G0];
      if (s.pos[2] >= 0) {
        const impact = s.vel[2];
        s.pos[2] = 0; s.vel = [0, 0, 0]; s.landed = true;
        if (impact > 4 && !s.crashed) {
          s.crashed = true;
          this.statustext(2, `CRASH: impact ${impact.toFixed(1)} m/s`);
          this.log('error', `💥 추락! 충돌 속도 ${impact.toFixed(1)} m/s — '드론 리셋'으로 초기화하세요`);
        } else if (!s.crashed) this.log('warn', '드론이 지면으로 떨어졌습니다');
      }
    }

    yawControl(dt) {
      const s = this.s;
      if (!s.armed || s.landed) { s.yawRate = 0; return; }
      const maxR = (s.yawSpeed || 60) * D2R;
      let rate = 0;
      if (s.yawRateCmd != null && s.velCmd) {
        rate = clamp(s.yawRateCmd, -maxR, maxR);
      } else {
        let tgt = s.yawTarget;
        if (s.autoYaw) {
          let dx = 0, dy = 0;
          if (s.mode === 4 && s.target) { dx = s.target[0] - s.pos[0]; dy = s.target[1] - s.pos[1]; }
          tgt = Math.hypot(dx, dy) > 2 ? Math.atan2(dy, dx) : null;
        } else if (s.mode === 6 && s.rtlPhase === 1 && Math.hypot(s.pos[0] - s.home[0], s.pos[1] - s.home[1]) > 2) {
          tgt = Math.atan2(s.home[1] - s.pos[1], s.home[0] - s.pos[0]);
        }
        if (tgt != null) {
          const err = wrapPi(tgt - s.yaw);
          rate = clamp(err * 2.5, -maxR, maxR);
          if (Math.abs(err) < 0.002) { rate = 0; s.yaw = tgt; }
        }
      }
      s.yaw = wrapPi(s.yaw + rate * dt);
      s.yawRate = rate;
    }

    attitude(dt) {
      const s = this.s;
      let pT = 0, rT = 0;
      if (s.crashed) rT = 1.35;
      else if (s.armed && !s.landed) {
        const ax = s.acc[0] + 0.15 * s.vel[0], ay = s.acc[1] + 0.15 * s.vel[1];
        const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
        pT = -Math.atan2(ax * c + ay * sn, G0); rT = Math.atan2(-ax * sn + ay * c, G0);
      } else if (!s.armed && !s.landed) { rT = s.roll + 1.5 * dt; pT = s.pitch + 0.7 * dt; }
      const k = Math.min(1, dt / 0.12);
      const np = s.pitch + (pT - s.pitch) * k, nr = s.roll + (rT - s.roll) * k;
      s.pitchRate = (np - s.pitch) / dt; s.rollRate = (nr - s.roll) / dt;
      s.pitch = np; s.roll = nr;
    }

    throttle() {
      const s = this.s;
      if (!s.armed) s.throttle = 0;
      else if (s.landed) s.throttle = 8;
      else s.throttle = clamp(Math.round(45 - s.acc[2] * 6 + Math.hypot(s.vel[0], s.vel[1]) * 1.5), 10, 100);
    }

    ledUpdate() {
      const s = this.s;
      const custom = s.led[0] || s.led[1] || s.led[2];
      let color = custom ? s.led : (s.relay || s.repeat ? [255, 255, 255] : [0, 0, 0]);
      let on = !!custom || s.relay;
      if (custom && s.ledRate > 0) on = Math.floor((s.t - s.ledT0) * s.ledRate * 2) % 2 === 0;
      if (s.repeat) {
        const k = Math.floor((s.t - s.repeat.t0) / (s.repeat.period / 2));
        if (k >= s.repeat.count * 2) { s.repeat = null; }
        else { on = k % 2 === 0; if (!custom) color = [255, 255, 255]; }
      }
      s.ledOn = on && !s.crashed;
      s.ledColor = color;
    }

    disarm(text) {
      const s = this.s;
      s.armed = false; s.velCmd = null; s.target = null; s.yawRateCmd = null;
      this.statustext(5, text);
    }

    crash(text) {
      const s = this.s;
      if (s.crashed) return;
      s.crashed = true; s.armed = false; s.target = null; s.velCmd = null;
      if (s.pos[2] < -0.05) s.landed = false;
      this.statustext(2, text);
    }

    // ------------------------------------------------------------ telemetry
    emitTelemetry() {
      const s = this.s;
      for (const k in s.rates) {
        const r = s.rates[k];
        if (!r) continue;
        const last = s.lastEmit[k] ?? -1e9;
        if (s.t - last >= 1 / r - 1e-6) { s.lastEmit[k] = s.t; this.emit(+k); }
      }
    }

    emit(id) {
      const s = this.s;
      const tms = Math.round(s.t * 1000);
      const alt = -s.pos[2];
      const gs = Math.hypot(s.vel[0], s.vel[1]);
      const hdgDeg = ((s.yaw * R2D) % 360 + 360) % 360;
      switch (id) {
        case 0: return this.send('HEARTBEAT', {
          type: 2, autopilot: 3,
          base_mode: 1 | 16 | (s.mode === 4 ? 8 : 0) | (s.armed ? 128 : 0),
          custom_mode: s.mode, system_status: s.crashed ? 5 : (s.armed && !s.landed ? 4 : 3), mavlink_version: 3,
        });
        case 1: return this.send('SYS_STATUS', {
          onboard_control_sensors_present: 0x0361fc2f, onboard_control_sensors_enabled: 0x0361fc2f, onboard_control_sensors_health: 0x0361fc2f,
          load: 250, voltage_battery: Math.round((10.5 + 2.1 * s.battery / 100) * 1000),
          current_battery: s.armed ? (s.landed ? 200 : 1200) : 50, battery_remaining: Math.round(s.battery),
          drop_rate_comm: 0, errors_comm: 0, errors_count1: 0, errors_count2: 0, errors_count3: 0, errors_count4: 0,
        });
        case 30: return this.send('ATTITUDE', { time_boot_ms: tms, roll: s.roll, pitch: s.pitch, yaw: wrapPi(s.yaw), rollspeed: s.rollRate, pitchspeed: s.pitchRate, yawspeed: s.yawRate });
        case 32: return this.send('LOCAL_POSITION_NED', { time_boot_ms: tms, x: s.pos[0] - s.home[0], y: s.pos[1] - s.home[1], z: s.pos[2], vx: s.vel[0], vy: s.vel[1], vz: s.vel[2] });
        case 33: {
          const ll = nedToLatLon(s.pos[0], s.pos[1]);
          return this.send('GLOBAL_POSITION_INT', {
            time_boot_ms: tms, lat: Math.round(ll.lat * 1e7), lon: Math.round(ll.lon * 1e7),
            alt: Math.round((HOME.amsl + alt) * 1000), relative_alt: Math.round(alt * 1000),
            vx: Math.round(s.vel[0] * 100), vy: Math.round(s.vel[1] * 100), vz: Math.round(s.vel[2] * 100),
            hdg: Math.round(hdgDeg * 100) % 36000,
          });
        }
        case 74: return this.send('VFR_HUD', { airspeed: gs, groundspeed: gs, heading: Math.round(hdgDeg) % 360, throttle: s.throttle, alt: HOME.amsl + alt, climb: -s.vel[2] });
        default: return false;
      }
    }

    send(name, values) {
      const s = this.s;
      const frame = ML.encode(name, values, this.seq++, s.sysid, s.compid);
      this.world.output(frame, name, s.sysid, s.compid);
      return true;
    }
    statustext(severity, text) {
      this.send('STATUSTEXT', { severity, text: text.slice(0, 50) });
      this.world.pushEvent({ kind: 'status', sysid: this.s.sysid, severity, text });
    }
    log(level, text) { this.world.log(level, text, this.s.sysid); }

    // ------------------------------------------------------------ input (World 가 배달)
    handle(m) {
      const s = this.s, f = m.fields;
      if (f.target_component !== undefined && f.target_component !== 0 && f.target_component !== s.compid) {
        this.log('warn', `${m.name}: target_component=${f.target_component} → 오토파일럿(compid=${s.compid})이 아니라서 무시됨`);
        return;
      }
      switch (m.name) {
        case 'SET_MODE':
          if (!(f.base_mode & 1)) { this.log('warn', 'SET_MODE: base_mode에 MAV_MODE_FLAG_CUSTOM_MODE_ENABLED(1)가 없어 무시됨'); return; }
          return this.ack(11, this.setMode(f.custom_mode));
        case 'COMMAND_LONG':
          return this.ack(f.command, this.command(f));
        case 'SET_POSITION_TARGET_LOCAL_NED': return this.posTarget(m.name, f, 'local');
        case 'SET_POSITION_TARGET_GLOBAL_INT': return this.posTarget(m.name, f, 'global');
        case 'LED_CONTROL': return this.ledControl(f);
        case 'REQUEST_DATA_STREAM': {
          const map = { 0: [1, 30, 32, 33, 74], 2: [1], 6: [32, 33], 10: [30], 11: [74] };
          for (const id of map[f.req_stream_id] || []) s.rates[id] = f.start_stop ? Math.min(50, f.req_message_rate) : 0;
          this.log('info', `REQUEST_DATA_STREAM: stream ${f.req_stream_id} → ${f.start_stop ? f.req_message_rate + 'Hz' : '중지'}`);
          return;
        }
        default:
          this.log('info', `${m.name} 수신 (드론은 이 메시지에 반응하지 않습니다)`);
      }
    }

    ledControl(f) {
      const s = this.s;
      const n = f.custom_len;
      if (f.pattern === 0 || n === 0) { s.led = [0, 0, 0]; s.ledRate = 0; this.log('info', 'LED 끔'); return; }
      if (n < 3) { this.log('warn', `LED_CONTROL: custom_len=${n} — 색을 정하려면 custom_len=3(R,G,B) 또는 4(R,G,B,깜빡임Hz)`); return; }
      const b = f.custom_bytes;
      s.led = [b[0], b[1], b[2]];
      s.ledRate = n >= 4 ? Math.min(b[3], 20) : 0;
      s.ledT0 = s.t;
      this.log('info', `LED 색 → RGB(${b[0]}, ${b[1]}, ${b[2]})${s.ledRate ? `, ${s.ledRate}Hz 깜빡임` : ''}`);
    }

    ack(command, [result, why]) {
      this.send('COMMAND_ACK', { command, result });
      this.log(result === 0 ? 'info' : 'warn', `ACK ${CMD_NAMES[command] || command} → ${RESULT_NAMES[result] || result}${why ? ' : ' + why : ''}`);
    }

    setMode(m) {
      const s = this.s;
      if (!SUPPORTED_MODES.includes(m)) return [4, `모드 ${MODE_NAMES[m] || m} 은(는) 이 시뮬레이터에서 지원하지 않습니다`];
      const prev = s.mode;
      s.mode = m;
      s.velCmd = null; s.yawRateCmd = null; s.yawTarget = null; s.autoYaw = false; s.yawSpeed = 60;
      s.hold = s.pos.slice();
      s.target = m === 4 && !s.landed ? s.pos.slice() : null;
      if (m === 6) { s.rtlPhase = 0; s.rtlAlt = Math.max(-s.pos[2], 15); }
      if (prev !== m) this.log('info', `비행 모드: ${MODE_NAMES[prev]} → ${MODE_NAMES[m]}`);
      if ((m === 9 || m === 6) && s.armed && s.landed) this.disarm('Landed, disarming');
      return [0, ''];
    }

    command(f) {
      const s = this.s;
      const p = [f.param1, f.param2, f.param3, f.param4, f.param5, f.param6, f.param7];
      switch (f.command) {
        case 400:
          if (p[0] === 1) {
            if (s.armed) return [0, '이미 시동 상태'];
            if (s.crashed) return [4, '추락 상태입니다. 드론 리셋 필요'];
            if (!ARMABLE_MODES.includes(s.mode)) return [4, `${MODE_NAMES[s.mode]} 모드에서는 시동을 걸 수 없습니다`];
            if (s.battery < 5) return [4, '배터리 부족'];
            s.armed = true; s.idleT = 0;
            this.statustext(6, 'Arming motors');
            return [0, ''];
          }
          if (p[0] === 0) {
            if (!s.armed) return [0, '이미 시동 꺼짐'];
            if (!s.landed && Math.round(p[1]) !== 21196) return [4, '비행 중에는 시동을 끌 수 없습니다 (강제: param2=21196)'];
            this.disarm('Disarming motors');
            return [0, ''];
          }
          return [2, 'param1 은 1(ARM) 또는 0(DISARM)'];
        case 22: {
          const alt = p[6];
          if (s.mode !== 4) return [4, `TAKEOFF는 GUIDED 모드에서만 가능 (현재 ${MODE_NAMES[s.mode]})`];
          if (!s.armed) return [4, '시동(ARM)이 걸려 있지 않습니다'];
          if (!s.landed) return [4, '이미 비행 중입니다'];
          if (!(alt > 0)) return [2, 'param7(이륙 고도, m)은 0보다 커야 합니다'];
          s.landed = false; s.target = [s.pos[0], s.pos[1], -alt];
          s.velCmd = null; s.autoYaw = false;
          this.log('info', `이륙 시작 → 목표 고도 ${f1(alt)} m`);
          return [0, ''];
        }
        case 21: return this.setMode(9);
        case 20: return this.setMode(6);
        case 176:
          if (!((p[0] | 0) & 1)) return [2, 'param1에 MAV_MODE_FLAG_CUSTOM_MODE_ENABLED(1) 필요'];
          return this.setMode(Math.round(p[1]));
        case 178:
          if (p[1] > 0) { s.speed = Math.min(p[1], 15); return [0, `수평 속도 ${f1(s.speed)} m/s`]; }
          return [2, 'param2(속도, m/s)는 0보다 커야 합니다'];
        case 115: {
          if (!s.armed || s.landed) return [4, '비행 중에만 가능합니다'];
          let a = p[0] * D2R;
          if (Math.round(p[3]) === 1) a = s.yaw + (p[2] < 0 ? -1 : 1) * a;
          s.yawTarget = wrapPi(a); s.autoYaw = false; s.yawRateCmd = null;
          s.yawSpeed = p[1] > 0 ? Math.min(p[1], 180) : 60;
          return [0, ''];
        }
        case 181: // DO_SET_RELAY: param1 relay 번호(0 = LED), param2 0/1
          if (Math.round(p[0]) !== 0) return [4, '이 드론에는 relay 0 (LED) 만 있습니다'];
          s.relay = Math.round(p[1]) === 1; s.repeat = null;
          return [0, s.relay ? 'LED 켬' : 'LED 끔'];
        case 182: { // DO_REPEAT_RELAY: param1 relay, param2 횟수, param3 주기(초)
          if (Math.round(p[0]) !== 0) return [4, '이 드론에는 relay 0 (LED) 만 있습니다'];
          const count = Math.round(p[1]), period = p[2];
          if (!(count > 0) || !(period > 0)) return [2, 'param2(횟수) 와 param3(주기, 초) 는 0보다 커야 합니다'];
          s.repeat = { count: Math.min(count, 100), period: Math.max(period, 0.05), t0: s.t };
          return [0, `${count}번 깜빡임 (주기 ${period}s)`];
        }
        case 511: {
          const id = Math.round(p[0]);
          if (!TELEM.has(id)) return [4, `메시지 ${id} 의 주기는 설정할 수 없습니다`];
          if (p[1] === -1) s.rates[id] = 0;
          else if (p[1] === 0) s.rates[id] = DEFAULT_RATES[id];
          else if (p[1] > 0) s.rates[id] = Math.min(50, 1e6 / p[1]);
          return [0, `${ML.BY_ID[id].name} → ${f1(s.rates[id])} Hz`];
        }
        case 512: {
          const id = Math.round(p[0]);
          if (!TELEM.has(id)) return [4, `메시지 ${id} 은(는) 요청할 수 없습니다`];
          this.emit(id);
          return [0, ''];
        }
        default:
          return [3, `MAV_CMD ${f.command} 은(는) 이 시뮬레이터에서 지원하지 않습니다`];
      }
    }

    posTarget(name, f, kind) {
      const s = this.s;
      if (s.mode !== 4) { this.log('warn', `${name}: GUIDED 모드가 아니라서 무시됨 (현재 ${MODE_NAMES[s.mode]})`); return; }
      if (!s.armed || s.landed) { this.log('warn', `${name}: 아직 이륙 전이라 무시됨 — 먼저 MAV_CMD_NAV_TAKEOFF`); return; }
      const fr = f.coordinate_frame, tm = f.type_mask;
      const usePos = (tm & 7) !== 7, useVel = (tm & 56) !== 56;
      let body = false;
      if (kind === 'local') {
        if (![1, 7, 8, 9].includes(fr)) { this.log('warn', `${name}: coordinate_frame=${fr} 은(는) 지원하지 않습니다 (1,7,8,9 사용)`); return; }
        body = fr === 8 || fr === 9;
      } else if (![0, 3, 5, 6, 10, 11].includes(fr)) { this.log('warn', `${name}: coordinate_frame=${fr} 은(는) 지원하지 않습니다 (5,6 사용)`); return; }
      const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
      const rot = (x, y) => (body ? [x * c - y * sn, x * sn + y * c] : [x, y]);

      if (usePos) {
        let n, e, d;
        if (kind === 'local') {
          [n, e] = rot(f.x, f.y); d = f.z;
          if (fr === 1) { n += s.home[0]; e += s.home[1]; } else { n += s.pos[0]; e += s.pos[1]; d += s.pos[2]; }
          if (fr === 1 && f.z > 0.5) this.log('warn', `z=${f1(f.z)} 은 지면 아래입니다! NED에서 z는 아래가 + → 고도 ${f1(f.z)}m 는 z=${f1(-f.z)}`);
        } else {
          n = (f.lat_int / 1e7 - HOME.lat) * M_PER_DEG;
          e = (f.lon_int / 1e7 - HOME.lon) * M_PER_DEG * Math.cos(HOME.lat * D2R);
          d = fr === 0 || fr === 5 ? -(f.alt - HOME.amsl) : -f.alt;
          if (Math.hypot(n, e) > 2000) { this.log('warn', `${name}: 목표가 홈에서 ${Math.round(Math.hypot(n, e))}m 떨어져 있어 거부됨 (lat_int/lon_int는 도×1e7 정수)`); return; }
        }
        if (d > 0) d = 0;
        s.target = [n, e, d]; s.velCmd = null; s.yawRateCmd = null;
        this.log('info', `목표 위치 → 로컬 N ${f1(n - s.home[0])}, E ${f1(e - s.home[1])}, 고도 ${f1(-d)} m`);
      } else if (useVel) {
        let [vn, ve] = rot(f.vx, f.vy);
        const h = Math.hypot(vn, ve), vmax = 15;
        if (h > vmax) { vn *= vmax / h; ve *= vmax / h; }
        if (!s.velCmd) this.log('info', '속도 제어 시작 (3초 안에 계속 다시 보내야 유지됩니다)');
        s.velCmd = [vn, ve, clamp(f.vz, -3, 3)]; s.velCmdT = s.t; s.target = null;
      } else {
        this.log('warn', `${name}: type_mask=${tm} 이(가) 위치와 속도를 모두 무시합니다`);
      }
      if (!(tm & 1024)) { s.yawTarget = wrapPi(f.yaw); s.autoYaw = false; s.yawRateCmd = null; }
      else if (!(tm & 2048)) { s.yawRateCmd = f.yaw_rate; s.yawTarget = null; s.autoYaw = false; }
      else if (usePos) { s.autoYaw = true; s.yawTarget = null; }
    }
  }

  // ======================================================================  World
  class World {
    /** opts: { count: 드론 수, spacing: 출발 간격(m), states: 복원할 vehicle 상태 배열, overrides: [{sysid, mode...}] } */
    constructor(opts = {}) {
      this.t = opts.t || 0;
      this.events = [];
      this.out = [];
      this.parser = new ML.Parser();
      this.linkOpen = false;
      this.stats = { txPkts: 0, txBytes: 0, rxPkts: 0, rxBytes: 0, bad: 0 };
      this.collisions = opts.collisions || [];
      const n = opts.states ? opts.states.length : Math.max(1, Math.min(20, opts.count || 1));
      const spacing = opts.spacing ?? 3;
      this.vehicles = [];
      for (let i = 0; i < n; i++) {
        let st;
        if (opts.states) st = opts.states[i];
        else {
          const home = [0, i * spacing, 0];
          st = Object.assign({ sysid: i + 1, home, pos: home.slice(), hold: home.slice() }, (opts.overrides || [])[i] || {});
          st.lastEmit = { 0: -i * 0.05 }; // 하트비트 엇갈리게
        }
        this.vehicles.push(new Vehicle(this, st));
      }
    }

    get multi() { return this.vehicles.length > 1; }
    snapshot() {
      return { t: this.t, vehicles: this.vehicles.map((v) => v.s), stats: this.stats, linkOpen: this.linkOpen, collisions: this.collisions };
    }

    advanceTo(t) {
      if (t - this.t > 5) this.t = t - 5;
      const dt = 0.01;
      while (this.t + dt <= t) {
        this.t += dt;
        for (const v of this.vehicles) v.step(dt);
        if (this.multi) this.checkCollisions();
      }
    }

    checkCollisions() {
      const vs = this.vehicles;
      for (let i = 0; i < vs.length; i++) {
        for (let j = i + 1; j < vs.length; j++) {
          const a = vs[i].s, b = vs[j].s;
          if ((a.landed && b.landed) || (a.crashed && b.crashed)) continue;
          const d = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
          if (d < COLLIDE_DIST) {
            const at = [(a.pos[0] + b.pos[0]) / 2, (a.pos[1] + b.pos[1]) / 2, (a.pos[2] + b.pos[2]) / 2];
            const c = { t: this.t, a: a.sysid, b: b.sysid, pos: at };
            this.collisions.push(c);
            vs[i].crash(`CRASH: collided with #${b.sysid}`);
            vs[j].crash(`CRASH: collided with #${a.sysid}`);
            this.pushEvent({ kind: 'collision', ...c });
            this.log('error', `💥 드론 #${a.sysid} 와 #${b.sysid} 충돌! (N ${f1(at[0])}, E ${f1(at[1])}, 고도 ${f1(-at[2])} m)`);
          }
        }
      }
    }

    // ---- 드론 → 지상국
    output(frame, name, sysid, compid) {
      this.out.push(frame);
      if (this.out.length > 1500) this.out.splice(0, this.out.length - 1500);
      const d = ML.BY_NAME[name];
      this.pushEvent({
        kind: 'msg', dir: 'RX', id: d.id, name, sysid, compid, len: frame.length,
        fields: ML.decodePayload(d, frame.subarray(10, 10 + frame[1])), hex: ML.toHex(frame), telem: TELEM.has(d.id),
      });
    }
    drainOut() {
      let n = 0;
      for (const f of this.out) n += f.length;
      const u8 = new Uint8Array(n);
      let o = 0;
      for (const f of this.out) { u8.set(f, o); o += f.length; }
      this.stats.rxPkts += this.out.length; this.stats.rxBytes += n;
      this.out = [];
      return u8;
    }
    openLink(dev) { this.out = []; this.parser = new ML.Parser(); this.linkOpen = true; this.pushEvent({ kind: 'link', open: true, dev }); }
    closeLink() { if (this.linkOpen) { this.linkOpen = false; this.pushEvent({ kind: 'link', open: false }); } }

    // ---- 지상국 → 드론
    receive(bytes, source = 'code') {
      for (const m of this.parser.push(bytes)) {
        if (m.junk) { this.stats.bad++; this.log('warn', `⚠ 잘못된 바이트: MAVLink 시작 바이트(0xFD/0xFE)가 아닌 바이트 ${m.junk}개를 버렸습니다`); this.pushEvent({ kind: 'bad', reason: 'STX 아님' }); continue; }
        if (m.crcError) {
          this.stats.bad++;
          this.pushEvent({ kind: 'msg', dir: 'TX', id: m.id, name: m.name, hex: ML.toHex(m.raw), bad: 'CRC 불일치', source });
          this.log('warn', `⚠ 잘못된 메시지: ${m.name} 프레임의 CRC가 맞지 않아 버렸습니다 (CRC_EXTRA=${ML.BY_ID[m.id].crc} 를 포함했는지 확인)`);
          continue;
        }
        if (m.unknown) {
          this.stats.bad++;
          this.pushEvent({ kind: 'msg', dir: 'TX', id: m.id, name: `MSG#${m.id}`, hex: ML.toHex(m.raw), bad: '알 수 없는 메시지', source });
          this.log('warn', `⚠ 메시지 ID ${m.id} 는 이 시뮬레이터가 이해하지 못합니다`);
          continue;
        }
        this.stats.txPkts++; this.stats.txBytes += m.raw.length;
        this.pushEvent({ kind: 'msg', dir: 'TX', id: m.id, name: m.name, sysid: m.sysid, compid: m.compid, seq: m.seq, fields: m.fields, hex: ML.toHex(m.raw), source, target: m.fields.target_system });
        this.route(m);
      }
    }

    route(m) {
      if (m.name === 'HEARTBEAT') return; // GCS heartbeat
      const ts = m.fields.target_system;
      if (ts === undefined) { this.log('info', `${m.name} 수신 (드론은 이 메시지에 반응하지 않습니다)`); return; }
      const targets = ts === 0 ? this.vehicles : this.vehicles.filter((v) => v.s.sysid === ts);
      if (!targets.length) {
        const ids = this.vehicles.map((v) => v.s.sysid).join(', ');
        this.log('warn', `${m.name}: target_system=${ts} 인 드론이 없습니다 (있는 드론 sysid: ${ids}). master.target_system 을 쓰세요`);
        return;
      }
      for (const v of targets) v.handle(m);
    }

    log(level, text, sysid) {
      this.pushEvent({ kind: 'log', level, text: this.multi && sysid ? `[#${sysid}] ${text}` : text, sysid });
    }
    pushEvent(ev) {
      ev.t = this.t;
      this.events.push(ev);
      if (this.events.length > 4000) this.events.splice(0, this.events.length - 4000);
    }
    takeEvents() { const e = this.events; this.events = []; return e; }
  }

  function nedToLatLon(n, e) {
    return { lat: HOME.lat + n / M_PER_DEG, lon: HOME.lon + e / (M_PER_DEG * Math.cos(HOME.lat * D2R)) };
  }

  World.HOME = HOME;
  World.MODE_NAMES = MODE_NAMES;
  World.nedToLatLon = nedToLatLon;
  g.World = World;
  g.Vehicle = Vehicle;
})(typeof self !== 'undefined' ? self : globalThis);
