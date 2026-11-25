"""
[관리자 테스트 코드] 전부 성공 · 빠름 — 우선순위 계획
  먼 드론부터: 직선이 막히면 출발을 늦추거나 위로 돌아가는 경로 중 가장 빨리 도착하는 것.
  예상 결과: 5/5 통과 · 시간 합 75.85 s
"""
import sys
import json
import math


def plan(problem):
    """시작 코드와 같은 구조: 입력(problem)을 받아 드론마다 웨이포인트 [[t, x, y, z], ...] 를 돌려줌"""
    v_max = problem["v_max"]
    starts = problem["starts"]
    targets = problem["targets"]
    paths = []

    # ================================================================
    # 여기에 코드를 작성하세요  ← 이 예시에서는 아래가 그 부분
    # ================================================================

    # 우선순위 계획: 먼 드론부터 한 대씩 경로를 정함.
    #   후보 = ① 직선  ② 고도 h 로 올라가 수평 이동 후 내려오기 (h 여러 개)
    #   후보마다 출발을 0, 0.25, 0.5 … 초 늦춰 보며, 이미 정한 드론들과 충돌하지 않는 것 중 가장 빨리 도착하는 것을 고름
    #   끝까지 못 찾으면 전체를 고도 분리로 (항상 성공)
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
        """위치 목록을 최고 속도로, delay 초 기다렸다가 출발하는 웨이포인트로"""
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

    def candidates(i):
        s, g = starts[i], targets[i]
        yield [s, g]
        top = max(s[2], g[2])
        for dh in (1.0, 2.0, 3.0, 4.5, 6.0, 8.0):
            h = top + dh
            yield [s, [s[0], s[1], h], [g[0], g[1], h], g]

    def prioritized():
        done = {}
        for i in sorted(range(n), key=lambda i: -math.dist(starts[i], targets[i])):
            best = None
            for pts in candidates(i):
                delay = 0.0
                while delay <= 40:
                    p = timed(pts, delay)
                    if best is not None and p[-1][0] >= best[-1][0]:
                        break
                    if all(not collide(p, q) for q in done.values()):
                        best = p
                        break
                    delay += 0.25
            if best is None:
                return None
            done[i] = best
        return [done[i] for i in range(n)]

    def layered():
        order = sorted(range(n), key=lambda i: targets[i][2])
        top = max(max(p[2] for p in starts), max(p[2] for p in targets))
        layer = [0.0] * n
        for rank, i in enumerate(order):
            layer[i] = top + 1 + 0.5 * rank
        T = lambda ds: max(max(ds) / V, 1e-3)
        T1 = T([abs(layer[i] - starts[i][2]) for i in range(n)])
        T2 = T([math.hypot(targets[i][0] - starts[i][0], targets[i][1] - starts[i][1]) for i in range(n)])
        T3 = T([abs(layer[i] - targets[i][2]) for i in range(n)])
        return [[[0, *starts[i]], [T1, starts[i][0], starts[i][1], layer[i]], [T1 + T2, targets[i][0], targets[i][1], layer[i]], [T1 + T2 + T3, *targets[i]]] for i in range(n)]

    paths = prioritized() or layered()
    paths = [[[round(x, 6) for x in w] for w in p] for p in paths]

    return paths


def main():
    problem = json.load(sys.stdin)            # 입력 JSON 읽기 — 수정하지 마세요
    paths = plan(problem)
    print(json.dumps({"paths": paths}))       # 결과 JSON 출력 — 수정하지 마세요


if __name__ == "__main__":
    main()
