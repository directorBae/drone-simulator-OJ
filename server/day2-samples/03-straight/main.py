"""
[관리자 테스트 코드] 충돌 — 직선 최고 속도 (시작 코드 그대로)
  모든 드론이 목표까지 직선으로.
  예상 결과: 0/5 · 5개 모두 충돌
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

    # 모든 드론이 최고 속도로 목표까지 직선 비행 (시작 코드의 예시와 같음)
    for start, target in zip(starts, targets):
        t = math.dist(start, target) / v_max
        paths.append([[0, *start], [t, *target]])

    return paths


def main():
    problem = json.load(sys.stdin)            # 입력 JSON 읽기 — 수정하지 마세요
    paths = plan(problem)
    print(json.dumps({"paths": paths}))       # 결과 JSON 출력 — 수정하지 마세요


if __name__ == "__main__":
    main()
