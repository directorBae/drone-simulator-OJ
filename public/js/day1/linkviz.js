// 통신 링크 시각화: 지상국(내 코드) ⇄ 드론. 업링크(TX)·다운링크(RX) 레인 위로 패킷이 흘러감
import { esc } from '../core/ui.js';

const BAUD_BYTES = 5760; // 57,600 baud 8N1 ≈ 5,760 B/s

export class LinkViz {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="lv-node lv-gcs"><div class="lv-icon">💻</div><div><b>지상국 · 내 코드</b><div class="dim">SYSID 255</div></div></div>
      <div class="lv-lanes">
        <div class="lv-status"><span class="lv-dot"></span><span class="lv-text">연결 안 됨 — connect() 를 호출하면 링크가 열립니다</span></div>
        <div class="lv-lane up"><span class="lv-lab">업링크 TX →</span><div class="lv-track"></div></div>
        <div class="lv-lane down"><span class="lv-lab">← 다운링크 RX</span><div class="lv-track"></div></div>
        <div class="lv-stats"></div>
      </div>
      <div class="lv-node lv-drone"><div class="lv-icon">🛸</div><div><b class="lv-dname">드론</b><div class="dim lv-dsys">SYSID 1</div></div></div>`;
    this.up = root.querySelector('.up .lv-track');
    this.down = root.querySelector('.down .lv-track');
    this.statusEl = root.querySelector('.lv-status');
    this.stats = root.querySelector('.lv-stats');
    this.open = false;
    this.lastTelem = 0;
    this.rate = { bytes: 0, t0: performance.now(), bps: 0 };
  }
  setDrones(n) {
    this.root.querySelector('.lv-dname').textContent = n > 1 ? `드론 ${n}대` : '드론';
    this.root.querySelector('.lv-dsys').textContent = n > 1 ? `SYSID 1 … ${n}` : 'SYSID 1';
  }
  setOpen(open, dev) {
    this.open = open;
    this.root.classList.toggle('open', open);
    this.statusEl.querySelector('.lv-text').textContent = open
      ? `연결됨 · ${dev || 'udpin:0.0.0.0:14550'} (UDP 처럼 동작: 연결은 없고 패킷만 오갑니다)`
      : '링크 닫힘 — 코드가 실행 중일 때만 지상국이 메시지를 받습니다';
  }
  packet(ev) {
    const up = ev.dir === 'TX';
    const now = performance.now();
    if (!up) {
      this.rate.bytes += ev.len || ev.hex.length / 2;
      if (ev.telem) { if (now - this.lastTelem < 70) return; this.lastTelem = now; }
    }
    const track = up ? this.up : this.down;
    if (track.childElementCount > 40) return;
    const p = document.createElement('span');
    p.className = `lv-pkt ${up ? 'tx' : 'rx'}${ev.telem ? ' telem' : ''}${ev.bad ? ' bad' : ''}`;
    if (!ev.telem) p.textContent = (ev.bad ? '✖ ' : '') + ev.name + (ev.dir === 'RX' && ev.sysid > 1 ? ` #${ev.sysid}` : '');
    track.appendChild(p);
    const w = track.clientWidth;
    p.animate(
      up ? [{ transform: 'translateX(0)' }, { transform: `translateX(${w}px) translateX(-100%)` }] : [{ transform: `translateX(${w}px) translateX(-100%)` }, { transform: 'translateX(0)' }],
      { duration: ev.telem ? 700 : 1100, easing: 'linear' },
    ).onfinish = () => p.remove();
  }
  updateStats(st) {
    const now = performance.now();
    if (now - this.rate.t0 > 1000) {
      this.rate.bps = (this.rate.bytes * 1000) / (now - this.rate.t0);
      this.rate.bytes = 0; this.rate.t0 = now;
    }
    const pct = ((this.rate.bps / BAUD_BYTES) * 100).toFixed(0);
    this.stats.innerHTML = `TX <b>${st.txPkts}</b>개 · ${fmtB(st.txBytes)} &nbsp;|&nbsp; RX(코드가 읽음) <b>${st.rxPkts}</b>개 · ${fmtB(st.rxBytes)} &nbsp;|&nbsp; ` +
      `다운링크 ${fmtB(this.rate.bps)}/s = 57,600 baud 의 <b>${pct}%</b>${st.bad ? ` &nbsp;|&nbsp; <span class="bad">잘못된 패킷 ${st.bad}</span>` : ''}`;
  }
}
function fmtB(b) { return b < 1024 ? `${Math.round(b)} B` : `${(b / 1024).toFixed(1)} KB`; }
export { esc };
