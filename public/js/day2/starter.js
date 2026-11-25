// 2일차 시작 프로젝트 (여러 파일 · 패키지 구조)
export const STARTER = {
  'main.py': String.raw`"""
2일차 챌린지: 드론 20대, 충돌 없이 가장 빠르게

  i번 드론: starts[i] 에서 출발 → targets[i] 에 도착. 어떤 두 드론도 부딪히면 안 됨.
  입력  (stdin) : {"v_max", "starts": [[x,y,z]×20], "targets": [[x,y,z]×20], "min_sep", "tol"}
  출력 (stdout) : {"paths": [ [[t, x, y, z], ...] × 20 ]}   ← 미리 계산한 웨이포인트

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
    starts: list            # list[Vec3] — i번 드론의 출발점
    targets: list           # list[Vec3] — i번 드론의 목표점 (할당 고정)
    min_sep: float = 0.3
    tol: float = 0.1

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

    def solve(self):
        P = self.p
        paths = [Path(s) for s in P.starts]

        # TODO 충돌 없이 모든 드론을 자기 목표(targets[i])까지 — 그리고 되도록 빨리
        #   힌트 1) 먼저 '성공'부터: 드론마다 다른 고도로 올라가 수평 이동 → 내려오기 (고도 분리)
        #   힌트 2) 시간 줄이기: 출발 순서 · 대기(wait) · 속도 조절 · 우회 경로 · 우선순위 계획 …
        #   힌트 3) 비공개 케이스는 자리바꾸기 · 좁은 곳에 모이기처럼 충돌이 잘 나는 상황입니다.
        #
        # 아래는 형식만 맞는 예시입니다: 모두 최고 속도로 목표까지 직선
        #   → 대부분의 케이스에서 '충돌' 이 나옵니다.
        for path, goal in zip(paths, P.targets):
            path.move_to(goal, P.v_max)
        return paths
`,
};
