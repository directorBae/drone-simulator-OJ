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
    this.collapsed = new Set();
    this.render();
  }
  setFiles(files) { this.files = files; if (!(this.current in files)) this.current = 'main.py'; this.render(); }
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
        html.push(`<div class="ft-row ft-dir${this.selectedDir === full ? ' sel' : ''}" data-dir="${esc(full)}" style="padding-left:${8 + depth * 14}px">${closed ? '▸' : '▾'} 📁 ${esc(name)}</div>`);
        if (!closed) walk(node.dirs[name], full + '/', depth + 1);
      }
      for (const p of node.files) {
        const name = p.split('/').pop();
        const icon = p === 'main.py' ? '▶' : name.endsWith('.py') ? '🐍' : '📄';
        html.push(`<div class="ft-row ft-file${p === this.current ? ' cur' : ''}" data-file="${esc(p)}" style="padding-left:${8 + depth * 14}px">${icon} ${esc(name)}</div>`);
      }
    };
    walk(tree, '', 0);
    this.root.innerHTML = html.join('');
    this.root.querySelectorAll('.ft-file').forEach((el) => {
      el.onclick = () => { const p = el.dataset.file; this.selectedDir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''; this.open(p); };
    });
    this.root.querySelectorAll('.ft-dir').forEach((el) => {
      el.onclick = () => {
        const d = el.dataset.dir;
        if (this.selectedDir === d) { if (this.collapsed.has(d)) this.collapsed.delete(d); else this.collapsed.add(d); }
        this.selectedDir = d;
        this.render();
      };
    });
  }
  open(p) { this.current = p; this.render(); this.onOpen(p); }
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
    this.onChange(); this.open(init);
  }
  rename() {
    const target = prompt('이름을 바꿀 파일 경로 (폴더 전체를 옮기려면 폴더 경로)\n예: planner/solver.py  또는  planner', this.current);
    if (target == null) return;
    const from = cleanPath(target);
    if (!from) return;
    const isFolder = !(from in this.files) && Object.keys(this.files).some((p) => p.startsWith(from + '/'));
    if (!(from in this.files) && !isFolder) return alert('없는 파일/폴더입니다');
    if (from === 'main.py') return alert('main.py 는 진입점이라 이름을 바꿀 수 없습니다');
    const to = cleanPath(prompt('새 경로', from));
    if (!to || to === from) return;
    const moves = isFolder ? Object.keys(this.files).filter((p) => p.startsWith(from + '/')).map((p) => [p, to + p.slice(from.length)]) : [[from, to]];
    if (moves.some(([, b]) => b in this.files)) return alert('같은 이름이 이미 있습니다');
    for (const [a, b] of moves) { this.files[b] = this.files[a]; delete this.files[a]; }
    if (moves.some(([a]) => a === this.current)) this.current = moves.find(([a]) => a === this.current)[1];
    this.selectedDir = isFolder ? to : this.selectedDir;
    this.onChange(); this.open(this.current);
  }
  remove() {
    const target = prompt('삭제할 파일 또는 폴더 경로', this.selectedDir && !this.current.startsWith(this.selectedDir + '/') ? this.selectedDir : this.current);
    if (target == null) return;
    const p = cleanPath(target);
    if (!p) return;
    if (p === 'main.py') return alert('main.py 는 지울 수 없습니다');
    const victims = p in this.files ? [p] : Object.keys(this.files).filter((x) => x.startsWith(p + '/'));
    if (!victims.length) return alert('없는 파일/폴더입니다');
    if (victims.includes('main.py')) return alert('main.py 가 들어 있는 폴더는 지울 수 없습니다');
    if (!confirm(`${victims.length}개 파일을 지울까요?\n${victims.slice(0, 10).join('\n')}`)) return;
    victims.forEach((v) => delete this.files[v]);
    if (!(this.current in this.files)) this.current = 'main.py';
    this.selectedDir = '';
    this.onChange(); this.open(this.current);
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
