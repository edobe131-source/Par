// 블록 코드 편집 창: 줄 번호, 명령어 목록(눌러서 넣기), 입력하는 동안 문법 검사.
// Tab 들여쓰기 · Shift+Tab 내어쓰기 · Enter는 들여쓰기 유지(':'로 끝나면 한 단계 더) · Ctrl+S 저장

const CODE_HELP = [
  ['블록', [
    ['blockTag()', '이 블록의 블록 태그'],
    ['convert(A)', '블록 태그가 A인 블록으로 변환'],
    ['rot(A)', 'A도만큼 회전'],
    ['Tran(A)', '투명도를 A로 (0 불투명 ~ 100 투명)'],
    ['TranPlus(A)', '투명도를 A만큼 바꾸기'],
    ['move(A, B)', 'x로 A칸, y로 B칸 이동'],
    ['rotMove(A, B)', 'A도 방향으로 B칸 이동 (0 위 · 90 오른쪽)'],
    ['cooX()', '블록 x좌표 (칸)'],
    ['cooY()', '블록 y좌표 (칸, 아래로 갈수록 커짐)'],
    ['px(A, #ff0000)', 'A번 픽셀(1~64)을 그 색으로'],
    ['pxColor(A)', 'A번 픽셀의 색 (투명이면 "")'],
    ['disapp()', '사라지기 (통과·안 보임)'],
    ['appear()', '나타나기'],
  ]],
  ['조건', [
    ['dis', '사라져 있는가?'],
    ['app', '나타나 있는가?'],
    ['jump', '캐릭터가 이 블록 위에서 점프했는가?'],
    ['headbutt', '캐릭터가 머리를 여기 박았는가?'],
    ['stick', '캐릭터가 이 블록 옆면에 붙어 있는가?'],
  ]],
  ['캐릭터', [
    ['caCooX()', '캐릭터 x좌표 (칸)'],
    ['caCooY()', '캐릭터 y좌표 (칸)'],
    ['caTp(A, B)', '캐릭터를 칸 (A, B)로 보내기'],
    ['kill()', '캐릭터 죽이기'],
    ['noKey(left)', '키 막기: left right up down jump space 알파벳'],
    ['yesKey(left)', '막은 키 다시 풀기'],
  ]],
  ['흐름', [
    ['if 조건:\n    ', '만일 조건이라면'],
    ['else:\n    ', '아니면'],
    ['wT:\n    ', '계속 반복 (한 바퀴에 한 프레임)'],
    ['until 조건:\n    ', '조건이 될 때까지 반복'],
    ['wait(A)', 'A초 기다리기'],
  ]],
  ['변수 · 계산', [
    ['A = B', '변수 A를 B로'],
    ['A += B', '변수 A에 B만큼 더하기 (-=도 됨)'],
    ['+ - * /', '사칙연산'],
    ['//', '몫'],
    ['%', '나머지'],
    ['== != < > <= >=', '비교'],
    ['and or not', '그리고 · 또는 · 아니다'],
    ['sin(A)', '사인 (각도는 도)'],
    ['cos(A)', '코사인'],
    ['tan(A)', '탄젠트'],
    ['abs(A)', '절대값'],
  ]],
];

class CodeDialog {
  constructor() {
    const $ = (sel) => document.querySelector(sel);
    this.el = $('#modal-code');
    this.titleEl = $('#code-title');
    this.noteEl = $('#code-note');
    this.text = $('#code-text');
    this.lines = $('#code-lines');
    this.statusEl = $('#code-status');
    this.onSave = null;
    this.checkTimer = 0;
    this.errorLine = 0;

    const help = $('#code-help');
    for (const [group, items] of CODE_HELP) {
      help.append(el('div', { className: 'code-help-title', textContent: group }));
      for (const [snippet, desc] of items) {
        const btn = el('button', { type: 'button', className: 'code-help-item', title: '눌러서 넣기' },
          el('code', { textContent: snippet.replace(/\n\s*$/, '') }), el('span', { textContent: desc }));
        btn.addEventListener('click', () => this.insert(snippet));
        help.append(btn);
      }
    }

    this.text.addEventListener('input', () => this.changed());
    this.text.addEventListener('scroll', () => {
      this.lines.scrollTop = this.text.scrollTop;
    });
    this.text.addEventListener('keydown', (e) => this.onKey(e));
    $('#code-save').addEventListener('click', () => this.save());
  }

  // isNew: 코드가 없던 블록이라 저장하면 코드가 든 새 블록이 생김
  open({ design, isNew, onSave }) {
    const label = DesignTypes[design.type].label;
    this.titleEl.textContent = `코드 · ${label} (태그 ${design.tag})`;
    this.noteEl.textContent = isNew
      ? '저장하면 이 코드가 든 새 블록(새 태그)이 팔레트에 생깁니다.'
      : '이 블록 태그로 놓은 모든 블록의 코드가 함께 바뀝니다.';
    this.text.value = design.code || '';
    this.onSave = onSave;
    this.changed();
    Modal.open(this.el, {
      focus: this.text,
      escape: false, // 실수로 Esc를 눌러 쓴 코드를 잃지 않게 (취소 버튼으로 닫기)
      onKey: (e) => {
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') this.save();
      },
    });
  }

  save() {
    this.onSave(this.text.value);
    Modal.close();
  }

  changed() {
    this.renderLines();
    clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => this.check(), 150);
  }

  check() {
    const problem = Script.check(this.text.value);
    this.errorLine = problem ? problem.line : 0;
    this.statusEl.className = 'code-status ' + (problem ? 'bad' : 'ok');
    this.statusEl.textContent = problem
      ? `⚠ ${problem.line}번째 줄: ${problem.message}`
      : this.text.value.trim() ? '✓ 문법 문제 없음' : '코드를 지우고 저장하면 코드가 없는 블록이 됩니다.';
    this.renderLines();
  }

  renderLines() {
    const n = this.text.value.split('\n').length;
    if (this.lines.childElementCount !== n || this.lines.dataset.error !== String(this.errorLine)) {
      this.lines.replaceChildren(...Array.from({ length: n }, (_, i) =>
        el('div', { textContent: i + 1, className: i + 1 === this.errorLine ? 'bad' : '' })));
      this.lines.dataset.error = this.errorLine;
    }
    this.lines.scrollTop = this.text.scrollTop;
  }

  // 커서 자리에 넣기. 여러 줄 조각은 지금 줄의 들여쓰기를 이어받는다.
  insert(snippet) {
    const t = this.text;
    const start = t.selectionStart;
    const lineStart = t.value.lastIndexOf('\n', start - 1) + 1;
    const indent = /^ */.exec(t.value.slice(lineStart))[0];
    const text = snippet.replace(/\n/g, '\n' + indent);
    t.setRangeText(text, start, t.selectionEnd, 'end');
    t.focus();
    this.changed();
  }

  onKey(e) {
    const t = this.text;
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = t.selectionStart;
      const lineStart = t.value.lastIndexOf('\n', start - 1) + 1;
      if (e.shiftKey) {
        const remove = /^ {1,4}/.exec(t.value.slice(lineStart))?.[0].length || 0;
        if (remove) {
          t.setRangeText('', lineStart, lineStart + remove, 'preserve');
          t.selectionStart = t.selectionEnd = Math.max(lineStart, start - remove);
        }
      } else t.setRangeText('    ', start, t.selectionEnd, 'end');
      this.changed();
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      const start = t.selectionStart;
      const lineStart = t.value.lastIndexOf('\n', start - 1) + 1;
      const line = t.value.slice(lineStart, start);
      let indent = /^ */.exec(line)[0];
      if (/:\s*$/.test(line)) indent += '    ';
      t.setRangeText('\n' + indent, start, t.selectionEnd, 'end');
      this.changed();
    }
  }
}
