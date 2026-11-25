"""
[관리자 테스트 코드] 런타임 에러 — 입력 키 오타
  problem['targets'] 대신 problem['target'] 을 읽음.
  예상 결과: 7개 모두 런타임 에러 (KeyError: 'target')
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

    # 입력 키 이름을 잘못 씀: "targets" 가 아니라 "target" → KeyError
    goals = problem["target"]
    for s, g in zip(starts, goals):
        a = math.dist(s, g) / v_max
        paths.append([[0, *s], [a, *g], [a + hold, *g], [2 * a + hold, *s]])

    return paths


def main():
    problem = json.load(sys.stdin)            # 입력 JSON 읽기 — 수정하지 마세요
    paths = plan(problem)
    print(json.dumps({"paths": paths}))       # 결과 JSON 출력 — 수정하지 마세요


if __name__ == "__main__":
    main()
