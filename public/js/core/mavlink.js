/*
 * MAVLink v2 코덱 (시뮬레이터용 최소 구현)
 * - 메시지 정의(필드 순서, CRC_EXTRA)는 MAVLink common/ardupilotmega 정의와 동일합니다.
 * - Python 쪽 pymavlink 호환 모듈도 이 정의(JSON)를 그대로 사용합니다.
 * classic script: 워커에서 importScripts 로 로드 → self.MAVLink
 */
(function (g) {
  'use strict';

  const TYPES = {
    uint8_t: { size: 1, get: 'getUint8', set: 'setUint8' },
    int8_t: { size: 1, get: 'getInt8', set: 'setInt8' },
    uint16_t: { size: 2, get: 'getUint16', set: 'setUint16' },
    int16_t: { size: 2, get: 'getInt16', set: 'setInt16' },
    uint32_t: { size: 4, get: 'getUint32', set: 'setUint32' },
    int32_t: { size: 4, get: 'getInt32', set: 'setInt32' },
    float: { size: 4, get: 'getFloat32', set: 'setFloat32' },
    char: { size: 1 },
  };

  // 필드는 XML 정의 순서(= pymavlink *_send 인자 순서). 와이어 순서는 자동 계산.
  const P7 = [1, 2, 3, 4, 5, 6, 7].map((i) => ['param' + i, 'float']);
  const POS_TAIL = ['vx', 'vy', 'vz', 'afx', 'afy', 'afz', 'yaw', 'yaw_rate'].map((n) => [n, 'float']);
  const RAW_DEFS = [
    { id: 0, name: 'HEARTBEAT', crc: 50, fields: [['type', 'uint8_t'], ['autopilot', 'uint8_t'], ['base_mode', 'uint8_t'], ['custom_mode', 'uint32_t'], ['system_status', 'uint8_t'], ['mavlink_version', 'uint8_t']] },
    { id: 1, name: 'SYS_STATUS', crc: 124, fields: [['onboard_control_sensors_present', 'uint32_t'], ['onboard_control_sensors_enabled', 'uint32_t'], ['onboard_control_sensors_health', 'uint32_t'], ['load', 'uint16_t'], ['voltage_battery', 'uint16_t'], ['current_battery', 'int16_t'], ['battery_remaining', 'int8_t'], ['drop_rate_comm', 'uint16_t'], ['errors_comm', 'uint16_t'], ['errors_count1', 'uint16_t'], ['errors_count2', 'uint16_t'], ['errors_count3', 'uint16_t'], ['errors_count4', 'uint16_t']] },
    { id: 11, name: 'SET_MODE', crc: 89, fields: [['target_system', 'uint8_t'], ['base_mode', 'uint8_t'], ['custom_mode', 'uint32_t']] },
    { id: 30, name: 'ATTITUDE', crc: 39, fields: [['time_boot_ms', 'uint32_t'], ['roll', 'float'], ['pitch', 'float'], ['yaw', 'float'], ['rollspeed', 'float'], ['pitchspeed', 'float'], ['yawspeed', 'float']] },
    { id: 32, name: 'LOCAL_POSITION_NED', crc: 185, fields: [['time_boot_ms', 'uint32_t'], ['x', 'float'], ['y', 'float'], ['z', 'float'], ['vx', 'float'], ['vy', 'float'], ['vz', 'float']] },
    { id: 33, name: 'GLOBAL_POSITION_INT', crc: 104, fields: [['time_boot_ms', 'uint32_t'], ['lat', 'int32_t'], ['lon', 'int32_t'], ['alt', 'int32_t'], ['relative_alt', 'int32_t'], ['vx', 'int16_t'], ['vy', 'int16_t'], ['vz', 'int16_t'], ['hdg', 'uint16_t']] },
    { id: 66, name: 'REQUEST_DATA_STREAM', crc: 148, fields: [['target_system', 'uint8_t'], ['target_component', 'uint8_t'], ['req_stream_id', 'uint8_t'], ['req_message_rate', 'uint16_t'], ['start_stop', 'uint8_t']] },
    { id: 74, name: 'VFR_HUD', crc: 20, fields: [['airspeed', 'float'], ['groundspeed', 'float'], ['heading', 'int16_t'], ['throttle', 'uint16_t'], ['alt', 'float'], ['climb', 'float']] },
    { id: 76, name: 'COMMAND_LONG', crc: 152, fields: [['target_system', 'uint8_t'], ['target_component', 'uint8_t'], ['command', 'uint16_t'], ['confirmation', 'uint8_t'], ...P7] },
    { id: 77, name: 'COMMAND_ACK', crc: 143, fields: [['command', 'uint16_t'], ['result', 'uint8_t']] },
    { id: 84, name: 'SET_POSITION_TARGET_LOCAL_NED', crc: 143, fields: [['time_boot_ms', 'uint32_t'], ['target_system', 'uint8_t'], ['target_component', 'uint8_t'], ['coordinate_frame', 'uint8_t'], ['type_mask', 'uint16_t'], ['x', 'float'], ['y', 'float'], ['z', 'float'], ...POS_TAIL] },
    { id: 86, name: 'SET_POSITION_TARGET_GLOBAL_INT', crc: 5, fields: [['time_boot_ms', 'uint32_t'], ['target_system', 'uint8_t'], ['target_component', 'uint8_t'], ['coordinate_frame', 'uint8_t'], ['type_mask', 'uint16_t'], ['lat_int', 'int32_t'], ['lon_int', 'int32_t'], ['alt', 'float'], ...POS_TAIL] },
    { id: 186, name: 'LED_CONTROL', crc: 72, fields: [['target_system', 'uint8_t'], ['target_component', 'uint8_t'], ['instance', 'uint8_t'], ['pattern', 'uint8_t'], ['custom_len', 'uint8_t'], ['custom_bytes', 'uint8_t', 24]] },
    { id: 253, name: 'STATUSTEXT', crc: 83, fields: [['severity', 'uint8_t'], ['text', 'char', 50]] },
  ];

  const defsJSON = JSON.stringify(RAW_DEFS);
  const BY_ID = {};
  const BY_NAME = {};
  for (const raw of RAW_DEFS) {
    const d = { id: raw.id, name: raw.name, crc: raw.crc };
    d.fields = raw.fields.map(([name, type, len]) => ({ name, type, len: len || 0 }));
    // MAVLink 규칙: 타입 크기 내림차순(안정 정렬)으로 와이어 순서 결정
    d.wire = d.fields.slice().sort((a, b) => TYPES[b.type].size - TYPES[a.type].size);
    let off = 0;
    for (const f of d.wire) { f.offset = off; off += TYPES[f.type].size * (f.len || 1); }
    d.length = off;
    BY_ID[d.id] = d;
    BY_NAME[d.name] = d;
  }

  function crcAccumulate(b, crc) {
    let tmp = (b ^ (crc & 0xff)) & 0xff;
    tmp = (tmp ^ (tmp << 4)) & 0xff;
    return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff;
  }
  function x25(bytes, crc = 0xffff) {
    for (let i = 0; i < bytes.length; i++) crc = crcAccumulate(bytes[i], crc);
    return crc;
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function encode(name, values, seq, sysid, compid) {
    const d = BY_NAME[name];
    if (!d) throw new Error('unknown message ' + name);
    const buf = new Uint8Array(d.length);
    const dv = new DataView(buf.buffer);
    for (const f of d.wire) {
      const v = values[f.name];
      if (f.type === 'char') {
        buf.set(enc.encode(String(v ?? '')).subarray(0, f.len), f.offset);
      } else if (f.len) {
        const t = TYPES[f.type];
        for (let i = 0; i < f.len; i++) {
          const x = Array.isArray(v) || ArrayBuffer.isView(v) ? v[i] : 0;
          dv[t.set](f.offset + i * t.size, f.type === 'float' ? Number(x || 0) : Math.trunc(Number(x || 0)), true);
        }
      } else {
        const t = TYPES[f.type];
        const n = f.type === 'float' ? Number(v || 0) : Math.trunc(Number(v || 0));
        dv[t.set](f.offset, n, true);
      }
    }
    let len = d.length;
    while (len > 1 && buf[len - 1] === 0) len--; // MAVLink2 payload truncation
    const frame = new Uint8Array(10 + len + 2);
    frame[0] = 0xfd; frame[1] = len; frame[2] = 0; frame[3] = 0;
    frame[4] = seq & 0xff; frame[5] = sysid & 0xff; frame[6] = compid & 0xff;
    frame[7] = d.id & 0xff; frame[8] = (d.id >> 8) & 0xff; frame[9] = (d.id >> 16) & 0xff;
    frame.set(buf.subarray(0, len), 10);
    let crc = x25(frame.subarray(1, 10 + len));
    crc = crcAccumulate(d.crc, crc);
    frame[10 + len] = crc & 0xff;
    frame[11 + len] = crc >> 8;
    return frame;
  }

  function decodePayload(d, payload) {
    const p = new Uint8Array(d.length);
    p.set(payload.subarray(0, d.length));
    const dv = new DataView(p.buffer);
    const out = {};
    for (const f of d.fields) {
      if (f.type === 'char') {
        const raw = p.subarray(f.offset, f.offset + f.len);
        const z = raw.indexOf(0);
        out[f.name] = dec.decode(z >= 0 ? raw.subarray(0, z) : raw);
      } else if (f.len) {
        const t = TYPES[f.type];
        out[f.name] = Array.from({ length: f.len }, (_, i) => dv[t.get](f.offset + i * t.size, true));
      } else {
        out[f.name] = dv[TYPES[f.type].get](f.offset, true);
      }
    }
    return out;
  }

  /** 바이트 스트림 파서. push() 는 파싱 결과 배열을 돌려줍니다. */
  class Parser {
    constructor() { this.buf = new Uint8Array(0); }
    push(bytes) {
      const nb = new Uint8Array(this.buf.length + bytes.length);
      nb.set(this.buf); nb.set(bytes, this.buf.length);
      const b = nb;
      const out = [];
      let i = 0, junk = 0;
      while (i < b.length) {
        const stx = b[i];
        if (stx !== 0xfd && stx !== 0xfe) { i++; junk++; continue; }
        let hdr, len, msgid, seq, sysid, compid, total, version;
        if (stx === 0xfd) {
          if (b.length - i < 10) break;
          len = b[i + 1];
          const sig = (b[i + 2] & 1) ? 13 : 0;
          hdr = 10; total = 10 + len + 2 + sig; version = 2;
          if (b.length - i < total) break;
          seq = b[i + 4]; sysid = b[i + 5]; compid = b[i + 6];
          msgid = b[i + 7] | (b[i + 8] << 8) | (b[i + 9] << 16);
        } else {
          if (b.length - i < 6) break;
          len = b[i + 1];
          hdr = 6; total = 6 + len + 2; version = 1;
          if (b.length - i < total) break;
          seq = b[i + 2]; sysid = b[i + 3]; compid = b[i + 4]; msgid = b[i + 5];
        }
        const frame = b.slice(i, i + total);
        const d = BY_ID[msgid];
        if (!d) { out.push({ unknown: true, id: msgid, sysid, compid, seq, raw: frame }); i += total; continue; }
        let crc = x25(frame.subarray(1, hdr + len));
        crc = crcAccumulate(d.crc, crc);
        const got = frame[hdr + len] | (frame[hdr + len + 1] << 8);
        if (crc !== got) { out.push({ crcError: true, id: msgid, name: d.name, raw: frame }); i += total; continue; }
        out.push({ id: msgid, name: d.name, seq, sysid, compid, version, fields: decodePayload(d, frame.subarray(hdr, hdr + len)), raw: frame });
        i += total;
      }
      if (junk) out.unshift({ junk });
      this.buf = b.slice(i);
      return out;
    }
  }

  function toHex(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i++) s += (u8[i] < 16 ? '0' : '') + u8[i].toString(16);
    return s;
  }
  function fromHex(h) {
    const n = h.length >> 1;
    const u8 = new Uint8Array(n);
    for (let i = 0; i < n; i++) u8[i] = parseInt(h.substr(i * 2, 2), 16);
    return u8;
  }

  g.MAVLink = { TYPES, BY_ID, BY_NAME, encode, decodePayload, Parser, x25, crcAccumulate, toHex, fromHex, defsJSON };
})(typeof self !== 'undefined' ? self : globalThis);
