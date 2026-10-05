// 에디터 왼쪽 팔레트: 도구, 구역, 블록 디자인 목록, 선택한 것의 설명과 놓을 때 속성(위치·회전·방향).

const PANEL_TOOLS = [
  { tool: { kind: 'erase' }, label: '지우개', desc: '타일을 지우고, 타일이 없으면 구역을 지움' },
  { tool: { kind: 'start' }, label: '스타트', desc: '맵에 딱 1개 · 놓으면 옮겨짐' },
  { tool: { kind: 'checkpoint' }, label: '체크포인트', desc: '닿으면 등록 · C로 이동' },
  { tool: { kind: 'star' }, label: '별', desc: '한 번만 먹을 수 있음' },
  { tool: { kind: 'rope' }, label: '밧줄', desc: '고정점을 누르고 아래로 끌어서 길이 정하기' },
  ...Object.entries(ZoneTypes).map(([zone, z]) => ({ tool: { kind: 'zone', zone }, label: z.label, desc: `${z.desc} · 타일과 겹쳐 놓임` })),
];

const toolId = (tool) => (tool.kind === 'zone' ? 'zone:' + tool.zone : tool.kind);

class EditorPanel {
  constructor(root, { onNewDesign, onEditDesign }) {
    this.root = root;
    this.toolsEl = root.querySelector('#palette-tools');
    this.designsEl = root.querySelector('#palette-designs');
    this.infoEl = root.querySelector('#palette-info');
    this.posRow = root.querySelector('#attr-pos');
    this.rotRow = root.querySelector('#attr-rot');
    this.dirRow = root.querySelector('#attr-dir');
    this.btnEdit = root.querySelector('#btn-design-edit');
    this.btnDup = root.querySelector('#btn-design-dup');
    this.btnDel = root.querySelector('#btn-design-del');
    this.editor = null;
    this.thumbs = new WeakMap(); // design → { version, url }
    this.shown = null;

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
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'palette-item';
    btn.title = title;
    const img = document.createElement('img');
    img.src = src;
    img.alt = title;
    btn.append(img);
    return btn;
  }

  iconURL(tool) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TILE_SIZE;
    const ctx = canvas.getContext('2d');
    if (tool.kind === 'erase') Render.eraser(ctx, 0, 0);
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
    const signature = map.designs.map((d) => d.version);
    const same = this.shown && this.shown.designs.length === map.designs.length
      && map.designs.every((d, i) => d === this.shown.designs[i] && signature[i] === this.shown.signature[i]);
    if (!same) {
      this.buildDesignList(map.designs);
      this.shown = { designs: map.designs.slice(), signature };
    }
    for (const btn of this.designsEl.querySelectorAll('[data-design]')) {
      btn.classList.toggle('active', tool.design === map.designs[Number(btn.dataset.design)]);
    }

    // 선택한 것 설명
    const design = this.selectedDesign();
    const info = design
      ? DesignTypes[design.type]
      : PANEL_TOOLS.find((t) => toolId(t.tool) === toolId(tool));
    this.infoEl.replaceChildren();
    const name = document.createElement('strong');
    name.textContent = info.label;
    this.infoEl.append(name, document.createTextNode(' · ' + info.desc));

    // 놓을 때 속성
    const type = design ? DesignTypes[design.type] : {};
    const rows = [[this.posRow, !!type.positioned, attrs.pos], [this.rotRow, !!type.rotatable, attrs.rot], [this.dirRow, !!type.directional, attrs.dir]];
    for (const [row, visible, value] of rows) {
      row.classList.toggle('hidden', !visible);
      for (const btn of row.querySelectorAll('[data-value]')) btn.classList.toggle('active', Number(btn.dataset.value) === value);
    }
    for (const btn of [this.btnEdit, this.btnDup, this.btnDel]) btn.disabled = !design;
  }

  // 종류 순서대로 한 격자에 (이름은 마우스를 올리거나 선택하면 보임)
  buildDesignList(designs) {
    const items = [];
    for (const type of DESIGN_TYPE_ORDER) {
      designs.forEach((design, i) => {
        if (design.type !== type) return;
        const btn = this.itemButton(this.thumbURL(design), `${DesignTypes[type].label} (더블클릭: 편집)`);
        btn.dataset.design = i;
        items.push(btn);
      });
    }
    this.designsEl.replaceChildren(...items);
  }
}
