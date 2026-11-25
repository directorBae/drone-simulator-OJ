"""
[관리자 테스트 코드] 일부 충돌 — 출발 시각(속도)만 조절, 경로는 직선
  직선은 그대로 두고 겹치는 드론의 출발만 늦춤. 넓게 퍼진 대형은 통과하지만 밀집 대형 · 좁은 형상에서는 피할 수 없어 충돌.
  예상 결과: 3/7 통과 (원형 · 구 · 자리 바꾸기, 106.03 s) · 좁은 형상 · 기둥 쌓기 · 밀집 2개 충돌
"""
import sys
import json
import math


def plan(problem):
    """시작 코드와 같은 구조: 입력(problem)을 받아 드론마다 웨이포인트 [[t, x, y, z], ...] 를 돌려줌
    (착륙장 이륙 → 목표 대형을 모두 동시에 hold 초 이상 유지 → 자기 착륙 지점으로 복귀)"""
    v_max = problem["v_max"]
    starts = problem["starts"]
    targets = problem["targets"]
    hold = problem["hold"]
    paths = []

    # ================================================================
    # 여기에 코드를 작성하세요  ← 이 예시에서는 아래가 그 부분
    # ================================================================

    # 출발 시각만 조절: 모든 드론이 직선 · 최고 속도, 겹치면 '늦게 출발'로만 피함 (경로 모양은 안 바꿈)
    #   한 대씩(먼 드론부터) 출발을 0, 0.25, 0.5 … 초 늦춰 보며, 이미 정한 드론들과 충돌하지 않는 가장 이른 출발을 고름
    #   → 넓게 퍼진 대형은 되지만, 밀집 대형처럼 직선끼리 피할 수 없게 겹치면 실패 (그때는 그냥 직선 그대로 → 충돌)
    V = v_max * 0.999
    SEP = problem["min_sep"] + 0.02
    n = len(starts)

    def seg_hit(a0, a1, b0, b1, t0, t1):
        """[t0, t1] 동안 두 드론이 직선 등속일 때 Chebyshev 거리 < SEP 인 순간이 있는가 (축마다 정확히 풀이)"""
        L = t1 - t0
        lo, hi = 0.0, L
        for k in range(3):
            d0 = a0[k] - b0[k]
            w = ((a1[k] - b1[k]) - d0) / L if L > 0 else 0.0
            if abs(w) < 1e-12:
                if abs(d0) >= SEP:
                    return False
                continue
            s1, s2 = (-SEP - d0) / w, (SEP - d0) / w
            lo, hi = max(lo, min(s1, s2)), min(hi, max(s1, s2))
            if hi - lo <= 1e-9:
                return False
        return hi - lo > 1e-9

    def pos(p, t):
        if t <= p[0][0]:
            return p[0][1:]
        if t >= p[-1][0]:
            return p[-1][1:]
        for a, b in zip(p, p[1:]):
            if a[0] <= t <= b[0]:
                u = (t - a[0]) / (b[0] - a[0])
                return [a[k + 1] + (b[k + 1] - a[k + 1]) * u for k in range(3)]

    def collide(pa, pb):
        times = sorted(set([w[0] for w in pa] + [w[0] for w in pb]))
        times.append(times[-1] + 1)
        return any(seg_hit(pos(pa, t0), pos(pa, t1), pos(pb, t0), pos(pb, t1), t0, t1) for t0, t1 in zip(times, times[1:]))

    def timed(points, delay):
        """위치 목록을 최고 속도로, delay 초 기다렸다가 출발하는 웨이포인트로 (t=0 부터)"""
        p = [[0.0, *points[0]]]
        if delay > 0:
            p.append([delay, *points[0]])
        t = delay
        for a, b in zip(points, points[1:]):
            d = math.dist(a, b)
            if d > 1e-9:
                t += d / V
                p.append([t, *b])
        return p

    def candidates(s, g):
        yield [s, g]                                       # 직선 하나뿐

    def prioritized(src, dst):
        """src[i] → dst[i] 를 모두 t=0 에 출발한다고 보고 계획. 실패하면 None"""
        done = {}
        for i in sorted(range(n), key=lambda i: -math.dist(src[i], dst[i])):
            best = None
            for pts in candidates(src[i], dst[i]):
                delay = 0.0
                while delay <= 80:
                    p = timed(pts, delay)
                    if best is not None and p[-1][0] >= best[-1][0]:
                        break
                    if all(not collide(p, q) for q in done.values()) and all(not collide(p, [[0.0, *src[j]]]) for j in range(n) if j != i and j not in done):
                        best = p
                        break
                    delay += 0.25
            if best is None:
                return None
            done[i] = best
        return [done[i] for i in range(n)]

    go = prioritized(starts, targets)
    back = prioritized(targets, starts)
    go = go or [timed([starts[i], targets[i]], 0) for i in range(n)]       # 못 찾으면 그냥 직선 (충돌!)
    back = back or [timed([targets[i], starts[i]], 0) for i in range(n)]
    leave = max(p[-1][0] for p in go) + hold + 0.05          # 모두 도착한 뒤 hold 초 유지하고 함께 출발
    for p, q in zip(go, back):
        paths.append(p + [[leave, *p[-1][1:]]] + [[leave + w[0], *w[1:]] for w in q[1:]])
    paths = [[[round(x, 6) for x in w] for w in p] for p in paths]

    return paths


def main():
    problem = json.load(sys.stdin)            # 입력 JSON 읽기 — 수정하지 마세요
    paths = plan(problem)
    print(json.dumps({"paths": paths}))       # 결과 JSON 출력 — 수정하지 마세요


if __name__ == "__main__":
    main()
