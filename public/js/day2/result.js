// 2일차 제출 결과 화면: 서버가 케이스를 하나씩 실행·채점하는 과정을 1초마다 받아 보여 줌
import { esc } from '../core/ui.js';
import { api, events, fmtTime } from './api.js';
import { VERDICT_NAMES } from './judge.js';

const $ = (id) => document.getElementById(id);
const id = +new URLSearchParams(location.search).get('id');
const fmtMs = (ms) => (ms == null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`);
let timer = null;

function row(r, k) {
  const st = r.verdict || r.state || 'WAIT';
  const running = st === 'RUN';
  const detail = st === 'AC'
    ? `<b class="res-time">${r.missionTime.toFixed(2)} s</b><span class="dim">미션 시간 (마지막 드론 도착)</span>`
    : st === 'WAIT' ? '<span class="dim">순서를 기다리는 중</span>'
      : running ? '<span class="dim">서버에서 경로 계산 중…</span>'
        : `<span class="res-msg">${esc(r.message || '')}</span>`;
  return `<div class="res-case s-${st}">
    <div class="res-n">${k + 1}</div>
    <div class="res-name">${r.hidden ? '🔒 ' : '★ '}${esc(r.name)}<div class="dim small">${r.hidden ? '비공개' : '공개'} 케이스${r.computeMs != null && !running ? ` · 계산 ${fmtMs(r.computeMs)}` : ''}</div></div>
    <div class="res-state"><span class="vchip v-${st}">${running ? '<span class="spin"></span>' : ''}${VERDICT_NAMES[st] || st}</span></div>
    <div class="res-detail">${detail}</div>
  </div>`;
}

function render(s) {
  $('title').textContent = `제출 #${s.id} 채점 결과`;
  const judging = s.status === 'judging';
  $('sub').textContent = `${fmtTime(s.createdAt)} 제출 · ` + (judging ? (s.ahead > 0 ? `채점 대기 중 (앞에 ${s.ahead}건)` : '서버에서 채점하는 중…') : s.status === 'error' ? '제출 오류' : '채점 완료');
  $('cases').innerHTML = s.results.map(row).join('');
  const box = $('summary');
  if (s.status === 'done') {
    const all = s.passCount === s.total;
    box.hidden = false;
    box.className = 'res-summary ' + (all ? 'ok' : s.passCount ? 'part' : 'none');
    box.innerHTML = `<div class="res-big">${all ? '🎉 ' : ''}${s.passCount} / ${s.total} 통과</div>
      <div>${s.passCount ? `통과한 케이스의 미션 시간 합 <b>${s.totalTime.toFixed(2)} s</b>` : '통과한 케이스가 없습니다'}</div>
      <div class="dim small">순위는 통과 수가 먼저, 같으면 시간 합이 작은 순입니다.</div>`;
  } else if (s.status === 'error') {
    box.hidden = false; box.className = 'res-summary none';
    box.innerHTML = `<div class="res-big">제출 오류</div><div>${esc(s.error || '')}</div>`;
  } else box.hidden = true;
  return judging;
}

async function poll() {
  clearTimeout(timer);
  try {
    const s = await api(`/api/day2/submissions/${id}`);
    if (render(s)) timer = setTimeout(poll, 1000);
  } catch (e) {
    if (e.status === 401) { location.href = '../'; return; }
    $('sub').textContent = e.status === 404 ? '제출을 찾을 수 없습니다' : `불러오지 못했습니다: ${e.message} (다시 시도 중)`;
    if (e.status !== 404) timer = setTimeout(poll, 2000);
  }
}

if (!id) $('sub').textContent = '제출 번호가 없습니다';
else {
  poll();
  events({ progress: (m) => { if (m.id === id) poll(); }, judged: (m) => { if (m.id === id) poll(); } });
}
