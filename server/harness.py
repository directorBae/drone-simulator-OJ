"""
2일차 채점용 파이썬 실행기 (서버에서 학생 프로젝트 하나를 한 번 실행)

  python3 -I harness.py <프로젝트 폴더>

  - 입력은 stdin, 학생 프로그램의 출력은 stdout 그대로
  - 컴파일/런타임 에러는 fd 3 에 JSON 한 줄로 알림: {"kind": "CE"|"RE", "text", "file", "line", "etype"}
  - 리눅스에서는 메모리 · CPU 시간 · 파일 크기 · 프로세스 수를 제한 (resource 모듈)
"""
import builtins
import json
import os
import sys
import traceback

PROJ = os.path.abspath(sys.argv[1])
ENTRY = os.path.join(PROJ, 'main.py')

try:
    _report = os.fdopen(3, 'w', encoding='utf-8')
except OSError:
    _report = None


def report(kind, text, file=None, line=None, etype=None):
    if _report is None:
        print(text, file=sys.stderr)
        return
    _report.write(json.dumps({'kind': kind, 'text': text, 'file': file, 'line': line, 'etype': etype}, ensure_ascii=False) + '\n')
    _report.flush()


def limit():
    try:
        import resource
    except ImportError:  # Windows (개발용)
        return
    mb = int(os.environ.get('JUDGE_MEM_MB', '1024'))
    cpu = int(os.environ.get('JUDGE_CPU_SEC', '31'))
    for name, value in (('RLIMIT_AS', mb * 1024 * 1024), ('RLIMIT_CPU', cpu), ('RLIMIT_FSIZE', 64 * 1024 * 1024),
                        ('RLIMIT_NPROC', int(os.environ.get('JUDGE_NPROC', '256'))), ('RLIMIT_NOFILE', 64)):
        res = getattr(resource, name, None)
        if res is None:
            continue
        try:
            resource.setrlimit(res, (value, value))
        except (ValueError, OSError):
            pass


def rel(path):
    return path[len(PROJ) + 1:].replace(os.sep, '/') if path.startswith(PROJ + os.sep) else path


def describe(e):
    tb = traceback.extract_tb(e.__traceback__)
    frames = [f for f in tb if f.filename.startswith(PROJ + os.sep)]
    out = []
    if frames:
        out.append('Traceback (most recent call last):\n')
        for f in frames:
            out.append('  File "%s", line %d, in %s\n' % (rel(f.filename), f.lineno, f.name))
            if f.line:
                out.append('    %s\n' % f.line.strip())
    out.extend(l.replace(PROJ + os.sep, '') for l in traceback.format_exception_only(type(e), e))
    file = line = None
    if frames:
        file, line = rel(frames[-1].filename), frames[-1].lineno
    if isinstance(e, SyntaxError) and e.filename and e.filename.startswith(PROJ + os.sep):
        file, line = rel(e.filename), e.lineno
    return ''.join(out).rstrip()[-4000:], file, line


def main():
    limit()
    os.chdir(PROJ)
    sys.path.insert(0, PROJ)
    sys.argv = [ENTRY]
    try:
        with open(ENTRY, encoding='utf-8') as fp:
            src = fp.read()
        code = compile(src, ENTRY, 'exec')
    except SyntaxError as e:
        text, file, line = describe(e)
        report('CE', text, file, line, type(e).__name__)
        return 1
    g = {'__name__': '__main__', '__file__': ENTRY, '__builtins__': builtins}
    try:
        exec(code, g)
    except SystemExit as e:
        if e.code not in (None, 0):
            report('RE', 'SystemExit: %s' % (e.code,), None, None, 'SystemExit')
            return 1
    except MemoryError:
        report('RE', 'MemoryError: 메모리 한도를 넘었습니다', None, None, 'MemoryError')
        return 1
    except BaseException as e:  # noqa: BLE001 — 학생 코드의 모든 예외
        text, file, line = describe(e)
        report('CE' if isinstance(e, SyntaxError) else 'RE', text, file, line, type(e).__name__)
        return 1
    finally:
        try:
            sys.stdout.flush()
        except Exception:  # noqa: BLE001
            pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
