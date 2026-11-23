// 2일차 시작 프로젝트 (여러 파일 · 패키지 구조)
export const STARTER = {
  'main.py': String.raw`"""
2일차 챌린지: 드론 20대, 충돌 없이 가장 빠르게

  입력  (stdin) : {"v_max", "starts": [[x,y,z]×20], "targets": [[x,y,z]×20], "min_sep", "tol", "hold"}
  출력 (stdout) : {"paths": [ [[t, x, y, z], ...] × 20 ]}

  * stdout 에는 JSON 한 줄만! 디버그 출력은 print(..., file=sys.stderr)
  * 좌표 단위 m, z 는 위가 + (1일차 NED 와 반대)
"""
import sys
import json

from planner.problem import Problem
from planner.solver import Solver


def main():
    problem = Problem.from_json(json.load(sys.stdin))
    print(f"드론 {problem.n}대, v_max={problem.v_max} m/s", file=sys.stderr)
    paths = Solver(problem).solve()
    print(json.dumps({"paths": [p.to_list() for p in paths]}))


if __name__ == "__main__":
    main()
`,
  'planner/__init__.py': String.raw`"""경로 계획 패키지: problem(입력) · geometry(벡터) · path(경로 기록) · solver(알고리즘)"""
`,
  'planner/geometry.py': String.raw`from dataclasses import dataclass
import math


@dataclass(frozen=True)
class Vec3:
    x: float
    y: float
    z: float

    def __add__(self, o):
        return Vec3(self.x + o.x, self.y + o.y, self.z + o.z)

    def __sub__(self, o):
        return Vec3(self.x - o.x, self.y - o.y, self.z - o.z)

    def __mul__(self, k):
        return Vec3(self.x * k, self.y * k, self.z * k)

    def norm(self):
        return math.sqrt(self.x ** 2 + self.y ** 2 + self.z ** 2)

    def tuple(self):
        return (self.x, self.y, self.z)


def dist(a, b):
    """유클리드 거리 — 속도 제한은 이 거리로 계산됩니다"""
    return (a - b).norm()


def chebyshev(a, b):
    """체비쇼프 거리 — 이 값이 min_sep(0.3) 보다 작아지면 충돌"""
    d = a - b
    return max(abs(d.x), abs(d.y), abs(d.z))
`,
  'planner/problem.py': String.raw`from dataclasses import dataclass, field
from .geometry import Vec3


@dataclass
class Problem:
    v_max: float
    starts: list            # list[Vec3] — i번 드론의 착륙 지점 (= 시작점 = 복귀점)
    targets: list           # list[Vec3] — 목표점 (어느 드론이 가도 됨)
    min_sep: float = 0.3
    tol: float = 0.1
    hold: float = 1.0

    @property
    def n(self):
        return len(self.starts)

    @classmethod
    def from_json(cls, d):
        return cls(
            v_max=d["v_max"],
            starts=[Vec3(*p) for p in d["starts"]],
            targets=[Vec3(*p) for p in d["targets"]],
            min_sep=d.get("min_sep", 0.3),
            tol=d.get("tol", 0.1),
            hold=d.get("hold", 1.0),
        )
`,
  'planner/path.py': String.raw`from .geometry import Vec3, dist

SAFETY = 0.999   # 반올림 오차로 v_max 를 넘지 않도록 아주 조금 느리게


class Path:
    """한 드론의 시간 웨이포인트 [t, x, y, z] 기록기"""

    def __init__(self, start: Vec3):
        self.start = start
        self.points = [(0.0, start)]

    @property
    def t(self):
        return self.points[-1][0]

    @property
    def pos(self):
        return self.points[-1][1]

    def move_to(self, p: Vec3, speed: float):
        """현재 위치에서 p 까지 speed(m/s) 로 직선 이동"""
        d = dist(self.pos, p)
        if d < 1e-9:
            return self
        self.points.append((self.t + d / (speed * SAFETY), p))
        return self

    def wait(self, seconds: float):
        """제자리에서 seconds 초 대기"""
        if seconds > 0:
            self.points.append((self.t + seconds, self.pos))
        return self

    def wait_until(self, t: float):
        return self.wait(t - self.t)

    def to_list(self):
        return [[round(t, 4), round(p.x, 4), round(p.y, 4), round(p.z, 4)] for t, p in self.points]
`,
  'planner/solver.py': String.raw`from .geometry import Vec3, dist, chebyshev
from .path import Path


class Solver:
    def __init__(self, problem):
        self.p = problem

    def assign(self):
        """TODO ① 할당: i번 드론 → 몇 번 목표점? (지금은 i → i)
        힌트: 탐욕(가까운 쌍부터) · 헝가리안 알고리즘"""
        return list(range(self.p.n))

    def solve(self):
        P = self.p
        paths = [Path(s) for s in P.starts]
        goal = self.assign()

        # TODO ② 경로: 충돌 없이 목표점까지 → 모두 동시에 hold 초 이상 머무르기 → 자기 착륙 지점으로 복귀
        #   힌트: 고도 분리(드론마다 다른 고도로 이동) 로 먼저 '성공'을 확보한 뒤 시간을 줄여 보세요.
        #
        # 아래는 형식만 맞는 예시입니다: 모두 2 m 떴다가 그대로 내려옴
        #   → 채점 결과는 '규칙 위반 (대형 미완성)' 이 나옵니다.
        for path in paths:
            path.move_to(path.pos + Vec3(0, 0, 2), P.v_max)
            path.wait(1.0)
            path.move_to(path.start, P.v_max)
        return paths
`,
};
