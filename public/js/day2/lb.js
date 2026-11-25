// 스코어보드 표 (2일차 화면 · 관리자 · 대형 화면 공용)
// 순위: ① 통과한 케이스 수 ② 통과한 케이스의 미션 시간 합 ③ 먼저 낸 제출
import { esc } from '../core/ui.js';
import { VERDICT_NAMES } from './judge.js';

export function renderLeaderboard(lb, { meName = null, big = false } = {}) {
  if (!lb.rows.length) return '<p class="dim">아직 제출한 학생이 없습니다.</p>';
  return `<table class="tbl wide lb${big ? ' big' : ''}"><tr><th>순위</th><th>이름</th><th>학번</th>${lb.cases.map((c) => `<th>${c.hidden ? '🔒 ' : ''}${esc(c.name)}</th>`).join('')}<th>통과</th><th>시간 합</th><th>제출</th></tr>` +
    lb.rows.map((r) => `<tr class="${r.rank ? '' : 'unranked'}${meName && r.name === meName ? ' me' : ''}${r.rank && r.rank <= 3 ? ' top' + r.rank : ''}">
      <td class="rank">${r.rank ? (r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank) : '-'}</td><td>${esc(r.name)}</td><td class="dim">${esc(r.studentId)}</td>
      ${r.cases.map((c) => `<td>${c.verdict ? `<span class="vchip v-${c.verdict}">${c.verdict === 'AC' ? c.time.toFixed(2) + 's' : VERDICT_NAMES[c.verdict]}</span>` : '<span class="dim">-</span>'}</td>`).join('')}
      <td><b>${r.passCount}/${r.total}</b></td><td>${r.totalTime != null ? `${r.totalTime.toFixed(2)} s` : '<span class="dim">-</span>'}</td><td class="dim">${r.submissions}</td></tr>`).join('') + '</table>' +
    (lb.preview ? '<p class="dim">(관리자 미리보기 — 학생에게는 아직 보이지 않습니다)</p>' : '');
}
