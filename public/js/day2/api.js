// 서버 API 호출 도우미
// raw: { body, headers } 를 주면 JSON 으로 바꾸지 않고 그대로 보냄 (압축한 제출 본문 등)
export async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(path, {
    method,
    headers: raw ? raw.headers : body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: raw ? raw.body : body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  if (!res.ok) {
    const e = new Error((data && data.error) || `${res.status} ${res.statusText}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

/**
 * 서버 실시간 이벤트 (리더보드 갱신 등). 끊기면 브라우저가 자동 재연결.
 * 브라우저는 같은 서버에 연결을 6개까지만 열 수 있고(HTTP/1.1) 이 연결은 계속 열려 있으므로,
 * 탭이 안 보일 때는 닫고 다시 보이면 연결 + onResume() 으로 놓친 내용을 다시 불러옴
 * (탭을 여러 개 열어 두면 다른 요청이 줄을 서서 화면이 멈춘 것처럼 보이던 문제)
 */
export function events(handlers, { onResume } = {}) {
  let es = null;
  const open = () => {
    if (es) return;
    es = new EventSource('/api/events');
    for (const [name, fn] of Object.entries(handlers)) es.addEventListener(name, (e) => fn(e.data ? JSON.parse(e.data) : {}));
  };
  const close = () => { if (es) { es.close(); es = null; } };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) close();
    else { open(); if (onResume) onResume(); }
  });
  window.addEventListener('pagehide', close);
  if (!document.hidden) open();
  return { close };
}

export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
