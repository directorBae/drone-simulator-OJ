// 학생 프로젝트(파일 묶음) 검사 — 저장 API(메인 스레드)와 채점 워커가 함께 씀
export const MAX_PROJECT_BYTES = 1_000_000;
export const MAX_FILES = 100;

/** 문제가 있으면 오류 메시지, 없으면 null */
export function validFiles(files) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) return '파일 목록 형식이 올바르지 않습니다';
  const entries = Object.entries(files);
  if (entries.length > MAX_FILES) return `파일은 최대 ${MAX_FILES}개까지 저장할 수 있습니다`;
  let size = 0;
  for (const [p, c] of entries) {
    if (typeof c !== 'string') return `${p}: 내용이 문자열이 아닙니다`;
    if (!/^[\w\-. /가-힣]+$/.test(p) || p.includes('..') || p.startsWith('/') || p.length > 200) return `파일 경로 '${p}' 를 쓸 수 없습니다`;
    size += p.length + c.length;
  }
  if (size > MAX_PROJECT_BYTES) return `프로젝트 크기가 ${MAX_PROJECT_BYTES / 1e6}MB 를 넘습니다`;
  if (!('main.py' in files)) return 'main.py 가 필요합니다';
  return null;
}
