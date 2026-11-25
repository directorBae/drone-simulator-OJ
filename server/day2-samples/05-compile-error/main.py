"""
[관리자 테스트 코드] 컴파일 에러 — for 문 콜론 빠짐
  02 와 같지만 문법 오류가 하나 있음.
  예상 결과: 5개 모두 컴파일 에러 (main.py 29번째 줄)
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

    # 고도 분리: 드론마다 다른 고도 층 → 상승 · 수평 이동 · 하강을 모두 같은 박자로
    GAP = 0.5                                     # 층 사이 간격 (m)
    v = v_max * 0.999                             # 실제로 쓸 속력
    n = len(starts)
    order = sorted(range(n), key=lambda i: targets[i][2])   # 목표가 낮을수록 낮은 층
    top = max(max(p[2] for p in starts), max(p[2] for p in targets))
    layer = [0.0] * n
    for rank, i in enumerate(order)
        layer[i] = top + 1 + GAP * rank

    def stage_time(dists):
        return max(max(dists) / v, 1e-3)

    T1 = stage_time([abs(layer[i] - starts[i][2]) for i in range(n)])
    T2 = stage_time([math.hypot(targets[i][0] - starts[i][0], targets[i][1] - starts[i][1]) for i in range(n)])
    T3 = stage_time([abs(layer[i] - targets[i][2]) for i in range(n)])
    for i in range(n):
        s, g, h = starts[i], targets[i], layer[i]
        paths.append([[0, *s], [T1, s[0], s[1], h], [T1 + T2, g[0], g[1], h], [T1 + T2 + T3, *g]])

    return paths


def main():
    problem = json.load(sys.stdin)            # 입력 JSON 읽기 — 수정하지 마세요
    paths = plan(problem)
    print(json.dumps({"paths": paths}))       # 결과 JSON 출력 — 수정하지 마세요


if __name__ == "__main__":
    main()
