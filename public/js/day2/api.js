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

/** 서버 실시간 이벤트 (리더보드 갱신 등). 끊기면 브라우저가 자동 재연결 */
export function events(handlers) {
  const es = new EventSource('/api/events');
  for (const [name, fn] of Object.entries(handlers)) es.addEventListener(name, (e) => fn(e.data ? JSON.parse(e.data) : {}));
  return es;
}

export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
