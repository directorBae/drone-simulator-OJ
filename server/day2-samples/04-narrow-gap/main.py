"""
[관리자 테스트 코드] 일부 충돌 — 고도 분리, 층 간격 딱 0.3 m
  02 와 같지만 층 간격이 min_sep 과 똑같은 0.3 m. 공개 케이스는 통과하지만 목표가 촘촘한 비공개 케이스에서 충돌.
  예상 결과: 4/7 통과 (공개 2개 + 밀집 큐브 · 밀집 2단 링, 257.11 s) · 자리 바꾸기 · 좁은 형상 · 기둥 쌓기 충돌
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

    # 고도 분리: 드론마다 다른 고도 층 → 상승 · 수평 이동 · 하강을 모두 같은 박자로 → 대형 유지 → 같은 길로 복귀
    GAP = 0.3                                     # 층 사이 간격 (m)  ← min_sep 과 똑같음: 여유가 없음!
    v = v_max * 0.999                             # 실제로 쓸 속력
    H = hold + 0.2                                  # 대형 유지 시간 (조금 여유)
    n = len(starts)
    order = sorted(range(n), key=lambda i: targets[i][2])   # 목표가 낮을수록 낮은 층
    top = max(max(p[2] for p in starts), max(p[2] for p in targets))
    layer = [0.0] * n
    for rank, i in enumerate(order):
        layer[i] = top + 1 + GAP * rank

    def stage_time(dists):
        return max(max(dists) / v, 1e-3)

    T1 = stage_time([abs(layer[i] - starts[i][2]) for i in range(n)])
    T2 = stage_time([math.hypot(targets[i][0] - starts[i][0], targets[i][1] - starts[i][1]) for i in range(n)])
    T3 = stage_time([abs(layer[i] - targets[i][2]) for i in range(n)])
    T = T1 + T2 + T3                                # 모두 동시에 목표 도착
    for i in range(n):
        s, g, h = starts[i], targets[i], layer[i]
        paths.append([[0, *s], [T1, s[0], s[1], h], [T1 + T2, g[0], g[1], h], [T, *g],          # 가기
                      [T + H, *g],                                                               # 대형 유지
                      [T + H + T3, g[0], g[1], h], [T + H + T3 + T2, s[0], s[1], h], [2 * T + H, *s]])  # 돌아오기

    return paths


def main():
    problem = json.load(sys.stdin)            # 입력 JSON 읽기 — 수정하지 마세요
    paths = plan(problem)
    print(json.dumps({"paths": paths}))       # 결과 JSON 출력 — 수정하지 마세요


if __name__ == "__main__":
    main()
