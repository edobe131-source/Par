// 에디터 왼쪽 팔레트: 도구(지우개·스타트·체크포인트·별)와 블록 디자인 목록.

const PANEL_TOOLS = [
  { kind: 'erase', label: '지우개' },
  { kind: 'start', label: '스타트' },
  { kind: 'checkpoint', label: '체크포인트' },
  { kind: 'star', label: '별' },
];

class EditorPanel {
  constructor(root, { onNewDesign, onEditDesign }) {
    this.root = root;
    this.toolsEl = root.querySelector('#palette-tools');
    this.designsEl = root.querySelector('#palette-designs');
    this.posRow = root.querySelector('#spike-pos');
    this.btnEdit = root.querySelector('#btn-design-edit');
    this.btnDup = root.querySelector('#btn-design-dup');
    this.btnDel = root.querySelector('#btn-design-del');
    this.editor = null;
    this.thumbs = new WeakMap(); // design → { version, url }

    for (const tool of PANEL_TOOLS) {
      const btn = this.itemButton(this.iconURL(tool.kind), tool.label);
      btn.dataset.tool = tool.kind;
      this.toolsEl.append(btn);
    }

    this.toolsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tool]');
      if (btn) this.editor.setTool({ kind: btn.dataset.tool });
    });
    this.designsEl.addEventListener('click', (e) => {
      const design = this.designOf(e.target);
      if (design) this.editor.setTool({ kind: 'design', design });
    });
    this.designsEl.addEventListener('dblclick', (e) => {
      const design = this.designOf(e.target);
      if (design) onEditDesign(design);
    });
    this.posRow.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pos]');
      if (btn) this.editor.setSpikePos(Number(btn.dataset.pos));
    });
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

  iconURL(kind) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TILE_SIZE;
    const ctx = canvas.getContext('2d');
    if (kind === 'erase') Render.eraser(ctx, 0, 0);
    else Render.tile(ctx, SPECIAL_TILES[kind], 0, 0, '', null);
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
    const { tool, map, spikePos } = this.editor;

    for (const btn of this.toolsEl.children) btn.classList.toggle('active', tool.kind === btn.dataset.tool);

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

    const design = this.selectedDesign();
    this.posRow.classList.toggle('hidden', design?.type !== 'spike1');
    for (const btn of this.posRow.querySelectorAll('[data-pos]')) {
      btn.classList.toggle('active', Number(btn.dataset.pos) === spikePos);
    }
    for (const btn of [this.btnEdit, this.btnDup, this.btnDel]) btn.disabled = !design;
  }

  buildDesignList(designs) {
    const groups = DESIGN_TYPE_ORDER.map((type) => {
      const items = [];
      designs.forEach((design, i) => {
        if (design.type !== type) return;
        const btn = this.itemButton(this.thumbURL(design), `${DesignTypes[type].label} (더블클릭: 편집)`);
        btn.dataset.design = i;
        items.push(btn);
      });
      if (!items.length) return null;
      const group = document.createElement('div');
      group.className = 'palette-group';
      const label = document.createElement('div');
      label.className = 'palette-label';
      label.textContent = DesignTypes[type].label;
      const grid = document.createElement('div');
      grid.className = 'palette-grid';
      grid.append(...items);
      group.append(label, grid);
      return group;
    }).filter(Boolean);
    this.designsEl.replaceChildren(...groups);
  }
}
