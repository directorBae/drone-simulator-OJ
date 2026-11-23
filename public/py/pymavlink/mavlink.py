"""
교육용 경량 pymavlink 호환 모듈 (시뮬레이터 전용)

실제 pymavlink(`pymavlink.dialects.v20.ardupilotmega`)에서 자주 쓰는 API를 흉내 냅니다.
메시지는 진짜 MAVLink v2 바이트 프레임(헤더 + 페이로드 + CRC16/X.25 + CRC_EXTRA)으로
만들어져 시뮬레이터에 전송되고, 시뮬레이터가 보낸 바이트도 여기서 직접 해석합니다.
"""
import json
import struct

try:
    from js import MAVLINK_DEFS_JSON  # 브라우저(Pyodide) 워커가 넣어 줌
except ImportError:  # 로컬 테스트용
    import os
    MAVLINK_DEFS_JSON = os.environ.get("MAVLINK_DEFS_JSON", "[]")

# --------------------------------------------------------------------------- enums
class EnumEntry:
    def __init__(self, name, description=""):
        self.name = name
        self.description = description

    def __repr__(self):
        return self.name


enums = {}


def _enum(group, items):
    d = enums.setdefault(group, {})
    for name, value in items:
        globals()[name] = value
        d[value] = EnumEntry(name)


_enum("MAV_RESULT", [("MAV_RESULT_ACCEPTED", 0), ("MAV_RESULT_TEMPORARILY_REJECTED", 1), ("MAV_RESULT_DENIED", 2),
                     ("MAV_RESULT_UNSUPPORTED", 3), ("MAV_RESULT_FAILED", 4), ("MAV_RESULT_IN_PROGRESS", 5),
                     ("MAV_RESULT_CANCELLED", 6)])
_enum("MAV_CMD", [("MAV_CMD_NAV_WAYPOINT", 16), ("MAV_CMD_NAV_LOITER_UNLIM", 17), ("MAV_CMD_NAV_RETURN_TO_LAUNCH", 20),
                  ("MAV_CMD_NAV_LAND", 21), ("MAV_CMD_NAV_TAKEOFF", 22), ("MAV_CMD_CONDITION_YAW", 115),
                  ("MAV_CMD_DO_SET_MODE", 176), ("MAV_CMD_DO_CHANGE_SPEED", 178), ("MAV_CMD_DO_SET_HOME", 179),
                  ("MAV_CMD_DO_SET_RELAY", 181), ("MAV_CMD_DO_REPEAT_RELAY", 182),
                  ("MAV_CMD_DO_REPOSITION", 192), ("MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN", 246),
                  ("MAV_CMD_MISSION_START", 300), ("MAV_CMD_COMPONENT_ARM_DISARM", 400),
                  ("MAV_CMD_SET_MESSAGE_INTERVAL", 511), ("MAV_CMD_REQUEST_MESSAGE", 512)])
_enum("MAV_FRAME", [("MAV_FRAME_GLOBAL", 0), ("MAV_FRAME_LOCAL_NED", 1), ("MAV_FRAME_MISSION", 2),
                    ("MAV_FRAME_GLOBAL_RELATIVE_ALT", 3), ("MAV_FRAME_LOCAL_ENU", 4), ("MAV_FRAME_GLOBAL_INT", 5),
                    ("MAV_FRAME_GLOBAL_RELATIVE_ALT_INT", 6), ("MAV_FRAME_LOCAL_OFFSET_NED", 7),
                    ("MAV_FRAME_BODY_NED", 8), ("MAV_FRAME_BODY_OFFSET_NED", 9), ("MAV_FRAME_GLOBAL_TERRAIN_ALT", 10),
                    ("MAV_FRAME_GLOBAL_TERRAIN_ALT_INT", 11), ("MAV_FRAME_BODY_FRD", 12)])
_enum("MAV_MODE_FLAG", [("MAV_MODE_FLAG_CUSTOM_MODE_ENABLED", 1), ("MAV_MODE_FLAG_TEST_ENABLED", 2),
                        ("MAV_MODE_FLAG_AUTO_ENABLED", 4), ("MAV_MODE_FLAG_GUIDED_ENABLED", 8),
                        ("MAV_MODE_FLAG_STABILIZE_ENABLED", 16), ("MAV_MODE_FLAG_HIL_ENABLED", 32),
                        ("MAV_MODE_FLAG_MANUAL_INPUT_ENABLED", 64), ("MAV_MODE_FLAG_SAFETY_ARMED", 128)])
_enum("MAV_TYPE", [("MAV_TYPE_GENERIC", 0), ("MAV_TYPE_FIXED_WING", 1), ("MAV_TYPE_QUADROTOR", 2),
                   ("MAV_TYPE_HELICOPTER", 4), ("MAV_TYPE_GCS", 6), ("MAV_TYPE_HEXAROTOR", 13),
                   ("MAV_TYPE_OCTOROTOR", 14)])
_enum("MAV_AUTOPILOT", [("MAV_AUTOPILOT_GENERIC", 0), ("MAV_AUTOPILOT_ARDUPILOTMEGA", 3),
                        ("MAV_AUTOPILOT_INVALID", 8), ("MAV_AUTOPILOT_PX4", 12)])
_enum("MAV_STATE", [("MAV_STATE_UNINIT", 0), ("MAV_STATE_BOOT", 1), ("MAV_STATE_CALIBRATING", 2),
                    ("MAV_STATE_STANDBY", 3), ("MAV_STATE_ACTIVE", 4), ("MAV_STATE_CRITICAL", 5),
                    ("MAV_STATE_EMERGENCY", 6), ("MAV_STATE_POWEROFF", 7)])
_enum("MAV_SEVERITY", [("MAV_SEVERITY_EMERGENCY", 0), ("MAV_SEVERITY_ALERT", 1), ("MAV_SEVERITY_CRITICAL", 2),
                       ("MAV_SEVERITY_ERROR", 3), ("MAV_SEVERITY_WARNING", 4), ("MAV_SEVERITY_NOTICE", 5),
                       ("MAV_SEVERITY_INFO", 6), ("MAV_SEVERITY_DEBUG", 7)])
_enum("MAV_DATA_STREAM", [("MAV_DATA_STREAM_ALL", 0), ("MAV_DATA_STREAM_RAW_SENSORS", 1),
                          ("MAV_DATA_STREAM_EXTENDED_STATUS", 2), ("MAV_DATA_STREAM_RC_CHANNELS", 3),
                          ("MAV_DATA_STREAM_RAW_CONTROLLER", 4), ("MAV_DATA_STREAM_POSITION", 6),
                          ("MAV_DATA_STREAM_EXTRA1", 10), ("MAV_DATA_STREAM_EXTRA2", 11),
                          ("MAV_DATA_STREAM_EXTRA3", 12)])
_enum("POSITION_TARGET_TYPEMASK", [("POSITION_TARGET_TYPEMASK_X_IGNORE", 1), ("POSITION_TARGET_TYPEMASK_Y_IGNORE", 2),
                                   ("POSITION_TARGET_TYPEMASK_Z_IGNORE", 4), ("POSITION_TARGET_TYPEMASK_VX_IGNORE", 8),
                                   ("POSITION_TARGET_TYPEMASK_VY_IGNORE", 16), ("POSITION_TARGET_TYPEMASK_VZ_IGNORE", 32),
                                   ("POSITION_TARGET_TYPEMASK_AX_IGNORE", 64), ("POSITION_TARGET_TYPEMASK_AY_IGNORE", 128),
                                   ("POSITION_TARGET_TYPEMASK_AZ_IGNORE", 256), ("POSITION_TARGET_TYPEMASK_FORCE_SET", 512),
                                   ("POSITION_TARGET_TYPEMASK_YAW_IGNORE", 1024),
                                   ("POSITION_TARGET_TYPEMASK_YAW_RATE_IGNORE", 2048)])
MAV_COMP_ID_ALL = 0
MAV_COMP_ID_AUTOPILOT1 = 1
MAVLINK_STX = 0xFD
MAVLINK_STX_MAVLINK1 = 0xFE


# --------------------------------------------------------------------------- CRC
class x25crc:
    """pymavlink 과 같은 CRC-16/MCRF4XX (X.25) 계산기.  x25crc(buf).crc"""

    def __init__(self, buf=None):
        self.crc = 0xFFFF
        if buf is not None:
            self.accumulate(buf)

    def accumulate(self, buf):
        crc = self.crc
        for b in bytes(buf):
            tmp = b ^ (crc & 0xFF)
            tmp = (tmp ^ (tmp << 4)) & 0xFF
            crc = ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xFFFF
        self.crc = crc
        return self


# --------------------------------------------------------------------------- message definitions
_TYPEINFO = {"uint8_t": ("B", 1), "int8_t": ("b", 1), "uint16_t": ("H", 2), "int16_t": ("h", 2),
             "uint32_t": ("I", 4), "int32_t": ("i", 4), "float": ("f", 4), "char": ("s", 1)}
_INT_RANGE = {"uint8_t": (0, 255), "int8_t": (-128, 127), "uint16_t": (0, 65535), "int16_t": (-32768, 32767),
              "uint32_t": (0, 2 ** 32 - 1), "int32_t": (-2 ** 31, 2 ** 31 - 1)}


class _MsgDef:
    def __init__(self, d):
        self.id = d["id"]
        self.name = d["name"]
        self.crc_extra = d["crc"]
        self.fields = [(f[0], f[1], f[2] if len(f) > 2 else 0) for f in d["fields"]]
        self.fieldnames = [f[0] for f in self.fields]
        self.fieldtypes = {f[0]: f[1] for f in self.fields}
        self.wire = sorted(self.fields, key=lambda f: -_TYPEINFO[f[1]][1])
        fmt = "<"
        for _, t, n in self.wire:
            fmt += ("%ds" % n) if t == "char" else (("%d" % n) if n else "") + _TYPEINFO[t][0]
        self.fmt = fmt
        self.length = struct.calcsize(fmt)


MSG_BY_ID = {}
MSG_BY_NAME = {}
_CLASSES = {}


class MAVLink_message:
    """수신/송신 메시지 객체. 필드는 속성으로 접근합니다 (msg.relative_alt 등)."""

    def __init__(self, msgdef, values):
        self._def = msgdef
        self._type = msgdef.name
        self.id = msgdef.id
        self._header = None
        self._msgbuf = None
        for k in msgdef.fieldnames:
            setattr(self, k, values.get(k, 0))

    def get_type(self):
        return self._type

    def get_msgId(self):
        return self.id

    def get_fieldnames(self):
        return list(self._def.fieldnames)

    def get_srcSystem(self):
        return self._header["srcSystem"] if self._header else 0

    def get_srcComponent(self):
        return self._header["srcComponent"] if self._header else 0

    def get_seq(self):
        return self._header["seq"] if self._header else 0

    def get_msgbuf(self):
        return self._msgbuf

    def get_crc(self):
        return self._msgbuf[-2] | (self._msgbuf[-1] << 8) if self._msgbuf else None

    def to_dict(self):
        d = {"mavpackettype": self._type}
        for k in self._def.fieldnames:
            d[k] = getattr(self, k)
        return d

    def pack(self, mav, force_mavlink1=False):
        return mav._pack(self)

    def __str__(self):
        return "%s {%s}" % (self._type, ", ".join("%s : %s" % (k, getattr(self, k)) for k in self._def.fieldnames))

    __repr__ = __str__

    def __eq__(self, other):
        return isinstance(other, MAVLink_message) and self.to_dict() == other.to_dict()


def _bind_args(md, args, kwargs, fname):
    kwargs = dict(kwargs)
    kwargs.pop("force_mavlink1", None)
    names = md.fieldnames
    sig = "%s(%s)" % (fname, ", ".join(names))
    if len(args) > len(names):
        raise TypeError("%s: 인자가 너무 많습니다 (%d개 필요, %d개 받음)\n  올바른 형태: %s"
                        % (fname, len(names), len(args) + len(kwargs), sig))
    vals = dict(zip(names, args))
    for k, v in kwargs.items():
        if k not in names:
            raise TypeError("%s: '%s' 라는 인자는 없습니다\n  올바른 형태: %s" % (fname, k, sig))
        if k in vals:
            raise TypeError("%s: '%s' 인자가 두 번 들어왔습니다" % (fname, k))
        vals[k] = v
    missing = [n for n in names if n not in vals]
    if missing:
        raise TypeError("%s: 인자가 부족합니다 (%d개 필요, %d개 받음). 빠진 인자: %s\n  올바른 형태: %s"
                        % (fname, len(names), len(vals), ", ".join(missing), sig))
    for n, t, cnt in md.fields:
        v = vals[n]
        if t == "char":
            if not isinstance(v, (str, bytes, bytearray)):
                raise TypeError("%s: '%s' 필드는 문자열이어야 합니다 (받은 값: %r)" % (fname, n, v))
        elif cnt:
            try:
                v = list(v)
            except TypeError:
                raise TypeError("%s: '%s' 필드는 길이 %d 이하의 리스트여야 합니다 (받은 값: %r)" % (fname, n, cnt, v)) from None
            if len(v) > cnt:
                raise ValueError("%s: '%s' 필드는 최대 %d개입니다 (받은 개수: %d)" % (fname, n, cnt, len(v)))
            out = []
            for x in v + [0] * (cnt - len(v)):
                if t == "float":
                    out.append(float(x))
                    continue
                if isinstance(x, float) and x.is_integer():
                    x = int(x)
                lo, hi = _INT_RANGE[t]
                if not isinstance(x, int) or not lo <= x <= hi:
                    raise ValueError("%s: '%s' 의 원소는 %s(%d~%d) 정수여야 합니다 (받은 값: %r)" % (fname, n, t, lo, hi, x))
                out.append(x)
            vals[n] = out
        elif t == "float":
            try:
                vals[n] = float(v)
            except (TypeError, ValueError):
                raise TypeError("%s: '%s' 필드는 float(실수)여야 합니다 (받은 값: %r)" % (fname, n, v)) from None
        else:
            if isinstance(v, bool):
                v = int(v)
            if isinstance(v, float):
                if not v.is_integer():
                    raise TypeError("%s: '%s' 필드는 %s(정수)입니다. 받은 값 %r 은 정수가 아닙니다" % (fname, n, t, v))
                v = int(v)
            if not isinstance(v, int):
                raise TypeError("%s: '%s' 필드는 %s(정수)여야 합니다 (받은 값: %r)" % (fname, n, t, v))
            lo, hi = _INT_RANGE[t]
            if not lo <= v <= hi:
                raise ValueError("%s: '%s' 필드(%s)의 범위는 %d ~ %d 입니다 (받은 값: %d)" % (fname, n, t, lo, hi, v))
            vals[n] = v
    return vals


def _make_class(md):
    cname = "MAVLink_%s_message" % md.name.lower()

    def __init__(self, *args, **kwargs):
        MAVLink_message.__init__(self, md, _bind_args(md, args, kwargs, cname))

    return type(cname, (MAVLink_message,), {"__init__": __init__, "msgname": md.name, "id": md.id})


for _d in json.loads(str(MAVLINK_DEFS_JSON)):
    _md = _MsgDef(_d)
    MSG_BY_ID[_md.id] = _md
    MSG_BY_NAME[_md.name] = _md
    _CLASSES[_md.name] = _make_class(_md)
    globals()[_CLASSES[_md.name].__name__] = _CLASSES[_md.name]
    globals()["MAVLINK_MSG_ID_" + _md.name] = _md.id


def _decode(md, payload, header, frame):
    p = bytes(payload[:md.length]).ljust(md.length, b"\0")  # MAVLink2: 잘린 0 바이트 복원
    values = {}
    raw = struct.unpack(md.fmt, p)
    k = 0
    for name, t, n in md.wire:
        if t == "char":
            v = raw[k].split(b"\0", 1)[0].decode("utf-8", "replace")
            k += 1
        elif n:
            v = list(raw[k:k + n])
            k += n
        else:
            v = float(raw[k]) if t == "float" else raw[k]
            k += 1
        values[name] = v
    cls = _CLASSES[md.name]
    obj = cls.__new__(cls)
    MAVLink_message.__init__(obj, md, values)
    obj._header = header
    obj._msgbuf = bytes(frame)
    return obj


# --------------------------------------------------------------------------- parser
class Parser:
    """바이트 스트림 → 메시지 리스트"""

    def __init__(self):
        self.buf = bytearray()
        self.bad_crc = 0
        self.junk = 0

    def parse(self, data):
        self.buf.extend(data)
        b = self.buf
        out = []
        i = 0
        while i < len(b):
            stx = b[i]
            if stx == 0xFD:
                if len(b) - i < 10:
                    break
                plen = b[i + 1]
                total = 12 + plen + (13 if b[i + 2] & 1 else 0)
                if len(b) - i < total:
                    break
                hdr = 10
                seq, sysid, compid = b[i + 4], b[i + 5], b[i + 6]
                msgid = b[i + 7] | (b[i + 8] << 8) | (b[i + 9] << 16)
            elif stx == 0xFE:
                if len(b) - i < 6:
                    break
                plen = b[i + 1]
                total = 8 + plen
                if len(b) - i < total:
                    break
                hdr = 6
                seq, sysid, compid, msgid = b[i + 2], b[i + 3], b[i + 4], b[i + 5]
            else:
                i += 1
                self.junk += 1
                continue
            frame = bytes(b[i:i + total])
            md = MSG_BY_ID.get(msgid)
            if md is None:
                i += total
                continue
            crc = x25crc(frame[1:hdr + plen]).accumulate(bytes([md.crc_extra])).crc
            if crc != (frame[hdr + plen] | (frame[hdr + plen + 1] << 8)):
                self.bad_crc += 1
                i += 1
                continue
            out.append(_decode(md, frame[hdr:hdr + plen],
                               {"srcSystem": sysid, "srcComponent": compid, "seq": seq}, frame))
            i += total
        del self.buf[:i]
        return out


# --------------------------------------------------------------------------- MAVLink (master.mav)
class MAVLink:
    """master.mav 객체.  master.mav.<메시지이름>_send(...) / _encode(...)"""

    def __init__(self, file, srcSystem=255, srcComponent=0, use_native=False):
        self.file = file
        self.srcSystem = srcSystem
        self.srcComponent = srcComponent
        self.seq = 0
        self.total_packets_sent = 0
        self.total_bytes_sent = 0
        self._parser = Parser()

    def _pack(self, msg):
        md = msg._def
        args = []
        for name, t, n in md.wire:
            v = getattr(msg, name)
            if t == "char":
                args.append(v.encode("utf-8") if isinstance(v, str) else bytes(v))
            elif n:
                args.extend(list(v) + [0] * (n - len(v)))
            else:
                args.append(v)
        try:
            payload = struct.pack(md.fmt, *args)
        except struct.error as e:
            raise ValueError("%s 패킹 실패: %s" % (md.name, e)) from None
        plen = len(payload)
        while plen > 1 and payload[plen - 1] == 0:  # MAVLink2 payload truncation
            plen -= 1
        payload = payload[:plen]
        header = struct.pack("<BBBBBBBHB", 0xFD, plen, 0, 0, self.seq, self.srcSystem, self.srcComponent,
                             md.id & 0xFFFF, md.id >> 16)
        crc = x25crc(header[1:] + payload).accumulate(bytes([md.crc_extra])).crc
        buf = header + payload + struct.pack("<H", crc)
        msg._header = {"srcSystem": self.srcSystem, "srcComponent": self.srcComponent, "seq": self.seq}
        msg._msgbuf = buf
        self.seq = (self.seq + 1) & 0xFF
        return buf

    def send(self, msg, force_mavlink1=False):
        buf = self._pack(msg)
        self.file.write(buf)
        self.total_packets_sent += 1
        self.total_bytes_sent += len(buf)

    def parse_buffer(self, buf):
        msgs = self._parser.parse(buf)
        return msgs or None

    def parse_char(self, c):
        msgs = self._parser.parse(c)
        return msgs[0] if msgs else None

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        for suffix in ("_send", "_encode"):
            if name.endswith(suffix):
                md = MSG_BY_NAME.get(name[: -len(suffix)].upper())
                if md is None:
                    break
                cls = _CLASSES[md.name]

                def build(*args, **kwargs):
                    obj = cls.__new__(cls)
                    MAVLink_message.__init__(obj, md, _bind_args(md, args, kwargs, name))
                    return obj

                if suffix == "_encode":
                    return build

                def send(*args, **kwargs):
                    self.send(build(*args, **kwargs))

                return send
        raise AttributeError("'%s' 은(는) 지원하지 않습니다. 이 시뮬레이터가 아는 메시지: %s"
                             % (name, ", ".join(n.lower() + "_send" for n in sorted(MSG_BY_NAME))))
