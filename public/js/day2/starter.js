// 2일차 시작 코드: main() 은 입출력만, 학생은 plan() 을 채움 (필요하면 파일 · 폴더를 더 만들어 import 해도 됨)
export const STARTER = {
  'main.py': String.raw`"""
2일차 챌린지: 드론 20대, 충돌 없이 가장 빠르게

  미션: 착륙장의 드론 20대로 목표 모양을 만들고(모두 동시에 hold 초 이상) 다시 착륙장으로 복귀
  할 일: plan() 을 완성해 드론마다 웨이포인트 [t, x, y, z] 목록을 만드세요.
         입력을 읽고 결과 JSON 을 출력하는 부분(main)은 이미 되어 있습니다.
  규칙 · JSON 형식: 코드 위의 [📋 규칙 · JSON 형식] 탭

  * 디버그 출력은 print(..., file=sys.stderr) — stdout 에는 결과 JSON 만 나가야 합니다
"""
import sys
import json
import math


def plan(problem):
    """
    problem (입력 JSON 그대로):
        problem["v_max"]    최고 속력 (m/s)
        problem["starts"]   [[x, y, z], ...]  i번 드론의 착륙 지점 (출발점 = 복귀점)
        problem["targets"]  [[x, y, z], ...]  i번 드론이 대형에서 맡을 자리
        problem["min_sep"]  두 드론의 max(|Δx|, |Δy|, |Δz|) 가 이보다 작아지면 충돌
        problem["tol"]      위치 허용 오차 (m)
        problem["hold"]     대형을 유지해야 하는 시간 (초) — 모든 드론이 "동시에" 자기 자리에

    반환: paths — paths[i] = i번 드론의 웨이포인트 [[t, x, y, z], ...]
        · 첫 웨이포인트는 [0, 착륙 지점],  마지막 위치도 자기 착륙 지점 (복귀)
        · 그 사이에 모든 드론이 동시에 hold 초 이상 자기 목표에 머물러야 함
        · t 는 계속 커져야 하고, 웨이포인트 사이 속력은 v_max 이하
        · 같은 위치를 더 늦은 t 로 한 번 더 적으면 그동안 제자리에서 기다림
    """
    v_max = problem["v_max"]
    starts = problem["starts"]
    targets = problem["targets"]
    hold = problem["hold"]
    paths = []

    # ================================================================
    # TODO: 여기에 코드를 작성하세요
    #   지금은 형식만 맞는 예시입니다 — 모두 최고 속도로 목표까지 직선 → 다 모이면 hold 초 유지 → 직선으로 복귀
    #   → 경로가 엇갈리는 케이스에서는 '충돌' 이 납니다.
    #   힌트: 드론마다 다른 고도로 올라가 수평 이동 → 내려오기(고도 분리)로 먼저 성공부터,
    #         그다음 출발 순서 · 기다리기 · 우회 경로로 시간을 줄여 보세요.
    # ================================================================
    arrive = [math.dist(s, g) / v_max for s, g in zip(starts, targets)]
    leave = max(arrive) + hold + 0.2          # 모두 도착한 뒤 hold 초 넘게 대형 유지
    for s, g, a in zip(starts, targets, arrive):
        paths.append([[0, *s], [a, *g], [leave, *g], [leave + a, *s]])

    return paths


def main():
    problem = json.load(sys.stdin)            # 입력 JSON 읽기 — 수정하지 마세요
    paths = plan(problem)
    print(json.dumps({"paths": paths}))       # 결과 JSON 출력 — 수정하지 마세요


if __name__ == "__main__":
    main()
`,
};
