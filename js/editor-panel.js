// 에디터 왼쪽 팔레트: 도구, 구역, 블록 디자인 목록, 선택한 것의 설명과 놓을 때 속성(위치·회전·방향),
// 선택 도구로 고른 영역(복사·붙여넣기)과 칸 속성(체크포인트 이름·밧줄 길이·코드).

const PANEL_TOOLS = [
  { tool: { kind: 'select' }, label: '선택', desc: '끌어서 영역 선택 · 영역 안을 끌면 복사본 놓기(Shift: 옮기기) · 한 칸을 고르면 속성' },
  { tool: { kind: 'erase' }, label: '지우개', desc: '타일을 지우고, 타일이 없으면 구역을 지움' },
  { tool: { kind: 'start' }, label: '스타트', desc: '맵에 딱 1개 · 놓으면 옮겨짐' },
  { tool: { kind: 'checkpoint' }, label: '체크포인트', desc: '닿으면 등록 · C로 이동 · 선택 도구로 이름 붙이기' },
  { tool: { kind: 'star' }, label: '별', desc: '한 번만 먹을 수 있음' },
  { tool: { kind: 'rope' }, label: '밧줄', desc: '고정점을 누르고 아래로 끌어서 길이 정하기 · 선택 도구로 길이 바꾸기' },
  ...Object.entries(ZoneTypes).map(([zone, z]) => ({ tool: { kind: 'zone', zone }, label: z.label, desc: `${z.desc} · 타일과 겹쳐 놓임` })),
];

const toolId = (tool) => (tool.kind === 'zone' ? 'zone:' + tool.zone : tool.kind);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

class EditorPanel {
  constructor(root, { onNewDesign, onEditDesign, onEditCode }) {
    this.root = root;
    this.onEditCode = onEditCode;
    this.toolsEl = root.querySelector('#palette-tools');
    this.designsEl = root.querySelector('#palette-designs');
    this.infoEl = root.querySelector('#palette-info');
    this.selEl = root.querySelector('#sel-panel');
    this.posRow = root.querySelector('#attr-pos');
    this.rotRow = root.querySelector('#attr-rot');
    this.dirRow = root.querySelector('#attr-dir');
    this.btnCode = root.querySelector('#btn-design-code');
    this.btnEdit = root.querySelector('#btn-design-edit');
    this.btnDup = root.querySelector('#btn-design-dup');
    this.btnDel = root.querySelector('#btn-design-del');
    this.editor = null;
    this.thumbs = new WeakMap(); // design → { version, url }
    this.shown = null;
    this.selShown = null;

    for (const { tool, label } of PANEL_TOOLS) {
      const btn = this.itemButton(this.iconURL(tool), label);
      btn.dataset.tool = toolId(tool);
      this.toolsEl.append(btn);
    }

    this.toolsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tool]');
      if (btn) this.editor.setTool(PANEL_TOOLS.find((t) => toolId(t.tool) === btn.dataset.tool).tool);
    });
    this.designsEl.addEventListener('click', (e) => {
      const design = this.designOf(e.target);
      if (design) this.editor.setTool({ kind: 'design', design });
    });
    this.designsEl.addEventListener('dblclick', (e) => {
      const design = this.designOf(e.target);
      if (design) onEditDesign(design);
    });
    for (const [row, attr] of [[this.posRow, 'pos'], [this.rotRow, 'rot'], [this.dirRow, 'dir']]) {
      row.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-value]');
        if (btn) this.editor.setAttr(attr, Number(btn.dataset.value));
      });
    }
    root.querySelector('#btn-design-new').addEventListener('click', () => onNewDesign(this.selectedDesign()?.type || 'block'));
    this.btnCode.addEventListener('click', () => onEditCode(this.selectedDesign(), null));
    this.btnEdit.addEventListener('click', () => onEditDesign(this.selectedDesign()));
    this.btnDup.addEventListener('click', () => {
      const design = this.selectedDesign();
      this.editor.addDesign(design.clone(), design);
    });
    this.btnDel.addEventListener('click', () => {
      const design = this.selectedDesign();
      const uses = this.editor.map.countUses(design);
      const msg = uses
        ? `이 디자인으로 놓은 블록 ${uses}개도 함께 지워집니다. 삭제할까요?`
        : '이 디자인을 삭제할까요?';
      if (confirm(msg)) this.editor.deleteDesign(design);
    });
  }

  attach(editor) {
    this.editor = editor;
    this.shown = this.selShown = null;
    this.render();
  }

  selectedDesign() {
    return this.editor.tool.kind === 'design' ? this.editor.tool.design : null;
  }

  designOf(target) {
    const btn = target.closest('[data-design]');
    return btn ? this.editor.map.designs[Number(btn.dataset.design)] : null;
  }

  itemButton(src, title) {
    const btn = el('button', { type: 'button', className: 'palette-item', title });
    btn.append(el('img', { src, alt: title }));
    return btn;
  }

  iconURL(tool) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TILE_SIZE;
    const ctx = canvas.getContext('2d');
    if (tool.kind === 'select') Render.selectIcon(ctx);
    else if (tool.kind === 'erase') Render.eraser(ctx, 0, 0);
    else if (tool.kind === 'zone') Render.zoneIcon(ctx, tool.zone);
    else if (tool.kind === 'rope') Render.rope(ctx, 0, 0, 1, 0.35, 0, 0);
    else Render.tile(ctx, SPECIAL_TILES[tool.kind], 0, 0, '', null);
    return canvas.toDataURL();
  }

  thumbURL(design) {
    let entry = this.thumbs.get(design);
    if (!entry || entry.version !== design.version) {
      entry = { version: design.version, url: DesignArt.tile(design).toDataURL() };
      this.thumbs.set(design, entry);
    }
    return entry.url;
  }

  render() {
    const { tool, map, attrs } = this.editor;

    for (const btn of this.toolsEl.children) btn.classList.toggle('active', btn.dataset.tool === toolId(tool));

    // 디자인 목록은 바뀌었을 때만 다시 만든다 (선택만 바뀔 때 다시 만들면 더블클릭이 끊김).
    const signature = map.designs.map((d) => `${d.version}:${d.tag}:${d.code ? 1 : 0}:${d.keep ? 1 : 0}`);
    const same = this.shown && this.shown.designs.length === map.designs.length
      && map.designs.every((d, i) => d === this.shown.designs[i] && signature[i] === this.shown.signature[i]);
    if (!same) {
      this.buildDesignList(map.designs);
      this.shown = { designs: map.designs.slice(), signature };
    }
    for (const btn of this.designsEl.querySelectorAll('[data-design]')) {
      btn.classList.toggle('active', tool.design === map.designs[Number(btn.dataset.design)]);
    }

    // 선택한 것 설명 (블록이면 블록 태그도)
    const design = this.selectedDesign();
    this.infoEl.replaceChildren();
    if (design) {
      const t = DesignTypes[design.type];
      this.infoEl.append(
        el('strong', { textContent: t.label }),
        el('span', { className: 'tag-chip', textContent: `태그 ${design.tag}` }),
        design.code ? el('span', { className: 'code-chip', textContent: '코드' }) : '',
        design.code && design.keep ? el('span', { className: 'code-chip', textContent: '죽어도 진행' }) : '',
        document.createTextNode(' ' + t.desc),
      );
    } else {
      const info = PANEL_TOOLS.find((t) => toolId(t.tool) === toolId(tool));
      this.infoEl.append(el('strong', { textContent: info.label }), document.createTextNode(' · ' + info.desc));
    }

    // 놓을 때 속성
    const type = design ? DesignTypes[design.type] : {};
    const rows = [[this.posRow, !!type.positioned, attrs.pos], [this.rotRow, !!type.rotatable, attrs.rot], [this.dirRow, !!type.directional, attrs.dir]];
    for (const [row, visible, value] of rows) {
      row.classList.toggle('hidden', !visible);
      for (const btn of row.querySelectorAll('[data-value]')) btn.classList.toggle('active', Number(btn.dataset.value) === value);
    }
    for (const btn of [this.btnCode, this.btnEdit, this.btnDup, this.btnDel]) btn.disabled = !design;

    this.renderSelection();
  }

  // 종류 순서대로 한 격자에 (이름·태그는 마우스를 올리거나 선택하면 보임). 코드가 든 블록은 {} 표시.
  buildDesignList(designs) {
    const items = [];
    for (const type of DESIGN_TYPE_ORDER) {
      designs.forEach((design, i) => {
        if (design.type !== type) return;
        const title = `${DesignTypes[type].label} · 태그 ${design.tag}${design.code ? ' · 코드 있음' : ''} (더블클릭: 그림 편집)`;
        const btn = this.itemButton(this.thumbURL(design), title);
        btn.dataset.design = i;
        if (design.code) btn.classList.add('coded');
        items.push(btn);
      });
    }
    this.designsEl.replaceChildren(...items);
  }

  // 선택 영역 / 칸 속성. 입력칸에 쓰는 중에 다시 만들면 커서가 사라지므로 내용이 바뀔 때만 다시 만든다.
  renderSelection() {
    const editor = this.editor;
    const sel = editor.selection;
    const cell = editor.selectedCell();
    const t = cell?.tile;
    const key = sel
      ? [sel.x0, sel.y0, sel.x1, sel.y1, !!editor.clipboard, t?.kind, t?.design?.tag, t?.design?.code ? 1 : 0, t?.design?.keep ? 1 : 0, t?.name, t?.length, cell?.zone].join('|')
      : (editor.clipboard ? 'clip' : '');
    if (key === this.selShown) return;
    this.selShown = key;
    this.selEl.classList.toggle('hidden', !sel && !editor.clipboard);
    this.selEl.replaceChildren();
    if (!sel && !editor.clipboard) return;

    const button = (text, onClick, title = '') => {
      const b = el('button', { type: 'button', className: 'small', textContent: text, title });
      b.addEventListener('click', onClick);
      return b;
    };
    const head = sel ? `선택 ${sel.x1 - sel.x0 + 1}×${sel.y1 - sel.y0 + 1}칸` : '복사해 둔 영역 있음';
    this.selEl.append(el('div', { className: 'panel-title', textContent: head }));
    const actions = el('div', { className: 'panel-actions' });
    if (sel) {
      actions.append(
        button('복사', () => editor.copy(), 'Ctrl+C'),
        button('잘라내기', () => editor.cut(), 'Ctrl+X'),
        button('지우기', () => editor.deleteSelection(), 'Delete'),
      );
    }
    if (editor.clipboard) actions.append(button('붙여넣기', () => editor.startPaste(), 'Ctrl+V · 클릭해서 찍기'));
    this.selEl.append(actions);
    if (!cell) return;

    // 한 칸 속성
    const props = el('div', { className: 'props' });
    if (t?.kind === 'design') {
      const d = t.design;
      props.append(
        el('div', { className: 'prop-line' },
          el('strong', { textContent: DesignTypes[d.type].label }),
          el('span', { className: 'tag-chip', textContent: `태그 ${d.tag}` }),
          d.code ? el('span', { className: 'code-chip', textContent: '코드' }) : '',
          d.code && d.keep ? el('span', { className: 'code-chip', textContent: '죽어도 진행' }) : ''),
        button(d.code ? '코드 편집' : '코드 넣기', () => this.onEditCode(d, { x: cell.x, y: cell.y })),
      );
    } else if (t?.kind === 'checkpoint') {
      const input = el('input', { type: 'text', value: t.name || '', placeholder: '이름 (비우면 번호)', maxLength: 30 });
      input.addEventListener('input', () => editor.setCheckpointName(cell.x, cell.y, input.value));
      props.append(el('label', { className: 'prop-field' }, '체크포인트 이름', input));
    } else if (t?.kind === 'rope') {
      const input = el('input', { type: 'number', min: 1, max: MAX_ROPE_LENGTH, value: t.length });
      const set = (v) => {
        editor.setRopeLength(cell.x, cell.y, v);
        input.value = editor.map.get(cell.x, cell.y).length;
      };
      input.addEventListener('input', () => {
        if (input.value) set(Number(input.value));
      });
      props.append(el('label', { className: 'prop-field' }, '밧줄 길이 (칸)',
        el('span', { className: 'stepper' },
          button('−', () => set(Number(input.value) - 1)), input, button('+', () => set(Number(input.value) + 1)))));
    } else {
      const names = { start: '스타트', star: '별' };
      const text = t ? names[t.kind] : cell.zone ? ZoneTypes[cell.zone].label : '빈칸';
      props.append(el('div', { className: 'prop-line', textContent: `칸 (${cell.x}, ${cell.y}) · ${text}` }));
    }
    this.selEl.append(props);
  }
}
