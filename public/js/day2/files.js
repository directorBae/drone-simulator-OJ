// 프로젝트 파일 트리: 파일 생성 · 폴더 생성 · 이름 변경 · 삭제 · 업로드(파일/폴더)
import { esc } from '../core/ui.js';

const PATH_RE = /^[\w\-. /가-힣]+$/;
const TEXT_EXT = /\.(py|txt|json|csv|md|cfg|ini|yaml|yml)$/i;
export const MAX_UPLOAD = 200_000;

export function cleanPath(p) {
  p = String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '').trim();
  if (!p || !PATH_RE.test(p) || p.split('/').some((s) => s === '..' || s === '.' || !s)) return null;
  return p;
}

export class FileTree {
  /** files: {path: content} (공유 객체), opts: {onOpen(path), onChange()} */
  constructor(root, files, { onOpen, onChange }) {
    this.root = root;
    this.files = files;
    this.onOpen = onOpen;
    this.onChange = onChange;
    this.current = 'main.py';
    this.selectedDir = '';
    this.dirTarget = false;  // true 면 '삭제'·'이름' 대상이 폴더(selectedDir), 아니면 열린 파일(current)
    this.undo = null;        // 마지막 삭제 되돌리기 {files, current, selectedDir, label, timer}
    this.collapsed = new Set();
    this.render();
  }
  setFiles(files) { this.files = files; if (this.undo) clearTimeout(this.undo.timer); this.undo = null; this.dirTarget = false; if (!(this.current in files)) this.current = 'main.py'; this.render(); }
  dirs() {
    const s = new Set();
    for (const p of Object.keys(this.files)) { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join('/')); }
    return [...s].sort();
  }
  render() {
    const paths = Object.keys(this.files).sort((a, b) => a.localeCompare(b, 'ko'));
    // 트리 구성
    const tree = { dirs: {}, files: [] };
    for (const p of paths) {
      const parts = p.split('/');
      let node = tree;
      for (let i = 0; i < parts.length - 1; i++) node = node.dirs[parts[i]] ||= { dirs: {}, files: [] };
      node.files.push(p);
    }
    const html = [];
    const walk = (node, prefix, depth) => {
      for (const name of Object.keys(node.dirs).sort()) {
        const full = prefix + name;
        const closed = this.collapsed.has(full);
        html.push(`<div class="ft-row ft-dir${this.selectedDir === full ? ' sel' : ''}${this.dirTarget && this.selectedDir === full ? ' target' : ''}" data-dir="${esc(full)}" style="padding-left:${8 + depth * 14}px">${closed ? '▸' : '▾'} 📁 ${esc(name)}</div>`);
        if (!closed) walk(node.dirs[name], full + '/', depth + 1);
      }
      for (const p of node.files) {
        const name = p.split('/').pop();
        const icon = p === 'main.py' ? '▶' : name.endsWith('.py') ? '🐍' : '📄';
        html.push(`<div class="ft-row ft-file${p === this.current ? ' cur' : ''}${!this.dirTarget && p === this.current ? ' target' : ''}" data-file="${esc(p)}" style="padding-left:${8 + depth * 14}px">${icon} ${esc(name)}</div>`);
      }
    };
    walk(tree, '', 0);
    if (this.undo) html.push(`<div class="ft-undo">🗑 ${esc(this.undo.label)} 삭제됨 <button class="mini" data-undo>되돌리기</button></div>`);
    this.root.innerHTML = html.join('');
    const ub = this.root.querySelector('[data-undo]');
    if (ub) ub.onclick = () => this.restore();
    this.root.querySelectorAll('.ft-file').forEach((el) => {
      el.onclick = () => { const p = el.dataset.file; this.selectedDir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''; this.dirTarget = false; this.open(p); };
    });
    this.root.querySelectorAll('.ft-dir').forEach((el) => {
      el.onclick = () => {
        const d = el.dataset.dir;
        if (this.selectedDir === d && this.dirTarget) { if (this.collapsed.has(d)) this.collapsed.delete(d); else this.collapsed.add(d); }
        this.selectedDir = d;
        this.dirTarget = true;
        this.render();
      };
    });
  }
  open(p) { this.current = p; this.render(); this.onOpen(p); }
  /** '삭제'·'이름' 이 다룰 대상 (선택한 폴더 또는 열린 파일) */
  target() { return this.dirTarget && this.selectedDir ? { path: this.selectedDir, folder: true } : { path: this.current, folder: false }; }
  base() { return this.selectedDir ? this.selectedDir + '/' : ''; }

  newFile() {
    const name = prompt(`새 파일 이름 (현재 폴더: /${this.selectedDir})\n예: utils.py, planner/astar.py`, this.base() + 'new_file.py');
    if (name == null) return;
    const p = cleanPath(name);
    if (!p) return alert('파일 이름에 쓸 수 없는 문자가 있습니다 (영문/숫자/한글/_-. 와 / 만 가능)');
    if (p in this.files) return alert('이미 있는 파일입니다');
    if (this.dirs().includes(p)) return alert('같은 이름의 폴더가 있습니다');
    this.files[p] = p.endsWith('.py') ? '' : '';
    this.onChange(); this.open(p);
  }
  newFolder() {
    const name = prompt(`새 폴더 이름 (현재 폴더: /${this.selectedDir})\n파이썬 패키지로 쓰도록 __init__.py 가 함께 만들어집니다.`, this.base() + 'mypkg');
    if (name == null) return;
    const p = cleanPath(name);
    if (!p) return alert('폴더 이름에 쓸 수 없는 문자가 있습니다');
    if (p in this.files) return alert('같은 이름의 파일이 있습니다');
    const init = p + '/__init__.py';
    if (!(init in this.files)) this.files[init] = '';
    this.selectedDir = p;
    this.dirTarget = false;
    this.onChange(); this.open(init);
  }
  rename() {
    const { path: from, folder: isFolder } = this.target();
    if (from === 'main.py') return alert('main.py 는 진입점이라 이름을 바꿀 수 없습니다');
    const answer = prompt(`'${from}' 의 새 이름 (경로를 바꾸면 다른 폴더로 옮겨집니다)`, from);
    if (answer == null) return;
    const to = cleanPath(answer);
    if (!to) return alert('이름에 쓸 수 없는 문자가 있습니다 (영문/숫자/한글/_-. 와 / 만 가능)');
    if (!to || to === from) return;
    const moves = isFolder ? Object.keys(this.files).filter((p) => p.startsWith(from + '/')).map((p) => [p, to + p.slice(from.length)]) : [[from, to]];
    if (moves.some(([, b]) => b in this.files)) return alert('같은 이름이 이미 있습니다');
    for (const [a, b] of moves) { this.files[b] = this.files[a]; delete this.files[a]; }
    if (moves.some(([a]) => a === this.current)) this.current = moves.find(([a]) => a === this.current)[1];
    if (isFolder) this.selectedDir = to;
    this.onChange(); this.open(this.current);
  }
  /** 선택한 파일/폴더를 바로 지움. 몇 초 동안 '되돌리기' 를 보여 줌 */
  remove() {
    const { path: p, folder } = this.target();
    if (p === 'main.py') return alert('main.py 는 진입점이라 지울 수 없습니다');
    const victims = folder ? Object.keys(this.files).filter((x) => x.startsWith(p + '/')) : [p];
    if (!victims.length) return;
    if (victims.includes('main.py')) return alert('main.py 가 들어 있는 폴더는 지울 수 없습니다');
    if (this.undo) clearTimeout(this.undo.timer);
    const saved = Object.fromEntries(victims.map((v) => [v, this.files[v]]));
    this.undo = { files: saved, current: this.current, selectedDir: this.selectedDir, dirTarget: this.dirTarget, label: folder ? `📁 ${p} (파일 ${victims.length}개)` : p };
    this.undo.timer = setTimeout(() => { this.undo = null; this.render(); }, 10000);
    victims.forEach((v) => delete this.files[v]);
    if (!(this.current in this.files)) this.current = 'main.py';
    this.selectedDir = this.current.includes('/') ? this.current.slice(0, this.current.lastIndexOf('/')) : '';
    this.dirTarget = false;
    this.onChange(); this.open(this.current);
  }
  /** 마지막 삭제 되돌리기 */
  restore() {
    const u = this.undo;
    if (!u) return;
    clearTimeout(u.timer);
    this.undo = null;
    Object.assign(this.files, u.files);
    this.selectedDir = u.selectedDir;
    this.dirTarget = u.dirTarget;
    this.onChange(); this.open(u.current in this.files ? u.current : this.current);
  }
  /** 업로드: FileList. 폴더 업로드면 webkitRelativePath 유지 */
  async upload(list) {
    const added = [], skipped = [];
    for (const f of list) {
      const rel = f.webkitRelativePath || f.name;
      const p = cleanPath(this.base() + rel);
      if (!p || !TEXT_EXT.test(p)) { skipped.push(`${rel} (텍스트/파이썬 파일만)`); continue; }
      if (/(^|\/)(__pycache__|\.git|venv|\.venv)(\/|$)/.test(p)) { skipped.push(rel); continue; }
      if (f.size > MAX_UPLOAD) { skipped.push(`${rel} (200KB 초과)`); continue; }
      this.files[p] = await f.text();
      added.push(p);
    }
    if (added.length) { this.onChange(); this.open(added.find((p) => p.endsWith('.py')) || added[0]); }
    return { added, skipped };
  }
}
