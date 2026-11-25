import { $, esc } from '../core/ui.js';
import { api, events, fmtTime } from '../day2/api.js';
import { renderLeaderboard } from '../day2/lb.js';
import { VERDICT_NAMES } from '../day2/judge.js';

let users = [];
let viewer = null;

boot();
async function boot() {
  const me = await api('/api/auth/me').catch(() => ({}));
  if (me.admin) start(); else showLogin();
}
function showLogin() {
  $('login').hidden = false;
  $('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/admin/login', { method: 'POST', body: { password: $('pw').value } }); $('login').hidden = true; start(); }
    catch (ex) { $('loginMsg').textContent = ex.message; }
  };
}

function start() {
  $('app').hidden = false;
  document.querySelectorAll('.vtab').forEach((t) => (t.onclick = () => view(t.dataset.view)));
  $('btnLogout').onclick = async () => { await api('/api/admin/logout', { method: 'POST' }); location.reload(); };
  $('mClose').onclick = () => { $('modal').hidden = true; };
  $('userSearch').oninput = renderUsers;
  $('clearDeadline').onclick = () => { $('s_deadline').value = ''; };
  $('settingsForm').onsubmit = saveSettings;
  loadSettings();
  events({ leaderboard: refreshLive, submission: refreshLive, judged: refreshLive, config: () => loadSettings() });
  setInterval(renderStatus, 1000);
}
function view(v) {
  document.querySelectorAll('.vtab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  for (const id of ['schedule', 'users', 'feed', 'board', 'cases']) $('view-' + id).hidden = id !== v;
  ({ schedule: loadSettings, users: loadUsers, feed: loadFeed, board: loadBoard, cases: loadCases })[v]();
}
function refreshLive() {
  if (!$('view-feed').hidden) loadFeed();
  if (!$('view-board').hidden) loadBoard();
  if (!$('view-users').hidden) loadUsers();
}

// ---------------------------------------------------------------------- 일정
let current = null;
const toLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const toIso = (v) => (v ? new Date(v).toISOString() : '');
async function loadSettings() {
  current = await api('/api/admin/settings');
  const s = current.settings;
  $('s_day2').value = toLocal(s.day2_open_at);
  $('s_lb').value = toLocal(s.leaderboard_open_at);
  $('s_deadline').value = toLocal(s.submit_deadline);
  document.querySelectorAll('[name=lbmode]').forEach((r) => { r.checked = r.value === s.leaderboard_mode; });
  document.querySelectorAll('[name=sol1]').forEach((r) => { r.checked = r.value === s.day1_solutions; });
  renderStatus();
}
function renderStatus() {
  if (!current) return;
  const c = current.config, now = Date.now();
  const left = (iso) => { const ms = Date.parse(iso) - now; if (!(ms > 0)) return ''; const m = Math.floor(ms / 60000); return ` (${m >= 1440 ? Math.floor(m / 1440) + '일 ' : ''}${Math.floor((m % 1440) / 60)}시간 ${m % 60}분 남음)`; };
  $('status').innerHTML = `
    <div><span>1일차</span><b class="ok">● 항상 공개</b></div>
    <div><span>1일차 해설</span><b class="${c.day1SolutionsOpen ? 'ok' : 'warn'}">${c.day1SolutionsOpen ? '● 공개 중' : '○ 숨김'}</b></div>
    <div><span>2일차</span><b class="${Date.parse(c.day2OpenAt) <= now ? 'ok' : 'warn'}">${Date.parse(c.day2OpenAt) <= now ? '● 공개 중' : '○ 닫힘' + left(c.day2OpenAt)}</b></div>
    <div><span>스코어보드</span><b class="${c.leaderboardOpen ? 'ok' : 'warn'}">${c.leaderboardOpen ? '● 공개 중' : c.leaderboardMode === 'auto' && c.leaderboardOpenAt ? '○ 예약됨' + left(c.leaderboardOpenAt) : '○ 비공개'}</b></div>
    <div><span>제출 마감</span><b class="${c.deadlinePassed ? 'warn' : 'ok'}">${c.submitDeadline ? (c.deadlinePassed ? '마감됨' : new Date(c.submitDeadline).toLocaleString('ko-KR') + left(c.submitDeadline)) : '없음'}</b></div>`;
}
async function saveSettings(e) {
  e.preventDefault();
  const mode = document.querySelector('[name=lbmode]:checked')?.value || 'auto';
  // 자동 공개인데 시각이 비어 있으면 스코어보드는 비공개로 남음 (다른 설정은 그대로 저장되도록 막지 않음)
  const lbNote = mode === 'auto' && !$('s_lb').value ? ' · 스코어보드 공개 시각이 비어 있어 아직 공개되지 않습니다' : '';
  try {
    current = await api('/api/admin/settings', { method: 'PUT', body: { day2_open_at: toIso($('s_day2').value), leaderboard_mode: mode, leaderboard_open_at: toIso($('s_lb').value), submit_deadline: toIso($('s_deadline').value), day1_solutions: document.querySelector('[name=sol1]:checked')?.value || 'closed' } });
    $('saveMsg').textContent = '✓ 저장했습니다 ' + new Date().toLocaleTimeString('ko-KR') + lbNote;
    renderStatus();
  } catch (ex) { $('saveMsg').textContent = '⚠ ' + ex.message; }
}

// ---------------------------------------------------------------------- 학생
async function loadUsers() { users = await api('/api/admin/users'); renderUsers(); }
function renderUsers() {
  const q = $('userSearch').value.trim();
  const list = users.filter((u) => !q || u.student_id.includes(q) || u.name.includes(q));
  $('userCount').textContent = `${users.length}명`;
  $('userTable').innerHTML = `<table class="tbl wide"><tr><th>학번</th><th>이름</th><th>가입</th><th>제출</th><th>최고 성공</th><th>최고 기록</th><th>마지막 제출</th><th>코드 저장</th><th></th></tr>` +
    list.map((u) => `<tr><td>${esc(u.student_id)}</td><td>${esc(u.name)}</td><td class="dim">${fmtTime(u.created_at)}</td><td>${u.submissions}</td>
      <td>${u.best_ac ?? '-'}/5</td><td>${u.best_time != null ? u.best_time.toFixed(2) + ' s' : '-'}</td><td class="dim">${fmtTime(u.last_submit)}</td><td class="dim">${fmtTime(u.project_updated)}</td>
      <td class="actions"><button class="mini" data-code="${u.id}">코드 보기</button><button class="mini" data-reset="${u.id}">비번 0000</button><button class="mini danger" data-del="${u.id}">삭제</button></td></tr>`).join('') + '</table>';
  const byId = (id) => users.find((u) => u.id === +id);
  $('userTable').querySelectorAll('[data-code]').forEach((b) => (b.onclick = () => openUser(+b.dataset.code)));
  $('userTable').querySelectorAll('[data-reset]').forEach((b) => (b.onclick = async () => {
    const u = byId(b.dataset.reset);
    if (!confirm(`${u.name} (${u.student_id}) 의 비밀번호를 0000 으로 초기화할까요?`)) return;
    await api(`/api/admin/users/${u.id}/reset-password`, { method: 'POST' });
    alert('초기화했습니다. 학생은 0000 으로 로그인한 뒤 비밀번호를 바꿀 수 있습니다.');
  }));
  $('userTable').querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    const u = byId(b.dataset.del);
    if (prompt(`계정 삭제: ${u.name} (${u.student_id})\n코드와 제출 기록이 모두 지워지고 되돌릴 수 없습니다.\n확인하려면 학번을 입력하세요.`) !== u.student_id) return;
    await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
    loadUsers();
  }));
}
async function openUser(id) {
  const d = await api(`/api/admin/users/${id}`);
  $('mTitle').textContent = `${d.user.name} (${d.user.student_id}) — 가입 ${fmtTime(d.user.created_at)}`;
  $('modal').hidden = false;
  if (!viewer) viewer = CodeMirror($('mCode'), { readOnly: true, lineNumbers: true, theme: 'material-darker', mode: { name: 'python', version: 3 } });
  const showFiles = (files, label) => {
    const paths = Object.keys(files || {}).sort();
    $('mFiles').innerHTML = `<div class="m-sec">${esc(label)}</div>` + (paths.length ? paths.map((p) => `<div class="ft-row ft-file" data-f="${esc(p)}">${esc(p)}</div>`).join('') : '<div class="dim">파일 없음</div>');
    const open = (p) => {
      $('mFileName').textContent = p;
      viewer.setValue(files[p] ?? '');
      $('mFiles').querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('cur', x.dataset.f === p));
      setTimeout(() => viewer.refresh(), 0);
    };
    $('mFiles').querySelectorAll('[data-f]').forEach((x) => (x.onclick = () => open(x.dataset.f)));
    if (paths.length) open(paths.includes('main.py') ? 'main.py' : paths[0]); else viewer.setValue('');
  };
  showFiles(d.project && d.project.files, `현재 코드 (저장 ${fmtTime(d.project && d.project.updatedAt)})`);
  $('mSubs').innerHTML = `<div class="m-sec">제출 ${d.submissions.length}회</div>` + d.submissions.map((s) => `
    <div class="m-sub" data-sub="${s.id}"><b>#${s.id}</b> <span class="dim">${fmtTime(s.createdAt)}</span><br>
    ${s.status === 'judging' ? '<span class="dim">⏳ 채점 중</span>' : s.status === 'error' ? `<span class="bad-text">제출 오류: ${esc(s.error || '')}</span>` : `
    ${s.results.map((r) => `<span class="vchip v-${r.verdict}" title="${esc(r.message || '')}">${r.caseId}</span>`).join('')}
    <b>${s.passCount}/${s.total}</b>${s.passCount ? ` · ${s.totalTime.toFixed(2)}s` : ''}`}</div>`).join('');
  $('mSubs').querySelectorAll('[data-sub]').forEach((x) => (x.onclick = async () => {
    const r = await api(`/api/admin/submissions/${x.dataset.sub}/files`);
    showFiles(r.files, `제출 #${x.dataset.sub} 의 코드`);
  }));
}

// ---------------------------------------------------------------------- 제출 현황 · 스코어보드 · 케이스
async function loadFeed() {
  const list = await api('/api/admin/submissions');
  $('feed').innerHTML = `<table class="tbl wide"><tr><th>#</th><th>시각</th><th>학번</th><th>이름</th><th>결과</th><th>합계</th></tr>` +
    list.map((s) => `<tr><td>${s.id}</td><td class="dim">${fmtTime(s.created_at)}</td><td>${esc(s.student_id)}</td><td><a href="#" data-u="${s.user_id}">${esc(s.name)}</a></td>
      ${s.status === 'judging' ? '<td colspan="2" class="dim">⏳ 채점 중</td></tr>' : s.status === 'error' ? `<td colspan="2" class="bad-text">제출 오류: ${esc(s.error || '')}</td></tr>` : `
      <td>${s.results.map((r) => `<span class="vchip v-${r.verdict}" title="${esc(r.message || '')}">${r.caseId} ${VERDICT_NAMES[r.verdict]}</span>`).join(' ')}</td>
      <td><b>${s.ac_count}/${s.results.length}</b>${s.ac_count ? ` · ${s.total_time.toFixed(2)} s` : ''}</td></tr>`}`).join('') + '</table>';
  $('feed').querySelectorAll('[data-u]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); openUser(+a.dataset.u); }));
}
async function loadBoard() { $('board').innerHTML = renderLeaderboard(await api('/api/admin/leaderboard')); }
async function loadCases() {
  const cs = await api('/api/admin/cases');
  $('cases').innerHTML = cs.map((c) => `<div class="case-card"><b>${c.id}. ${esc(c.name)}</b> ${c.hidden ? '🔒 비공개' : '공개'} ${c.graded ? '· ★ 공식 채점' : '· 연습용'} <span class="dim">${esc(c.desc)}</span>
    <button class="mini" data-dl="${c.id}">입력 JSON 받기</button>
    <pre class="small">starts  ${esc(JSON.stringify(c.input.starts))}
targets ${esc(JSON.stringify(c.input.targets))}</pre></div>`).join('');
  $('cases').querySelectorAll('[data-dl]').forEach((b) => (b.onclick = () => {
    const c = cs.find((x) => x.id === +b.dataset.dl);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(c.input, null, 1)], { type: 'application/json' }));
    a.download = `case${c.id}.json`;
    a.click();
  }));
}
