// 블록 디자인 편집 창: 8x8 픽셀에 색을 찍는다. 어떤 종류든 8x8 전체를 쓸 수 있다.
// '투명'은 안 보이지만 판정이 있고, '비우기'는 판정도 없다.

class DesignDialog {
  constructor() {
    const $ = (sel) => document.querySelector(sel);
    this.el = $('#modal-design');
    this.titleEl = $('#design-title');
    this.typeRow = $('#design-type-row');
    this.typeSelect = $('#design-type');
    this.grid = $('#design-grid');
    this.preview = $('#design-preview');
    this.btnTransparent = $('#design-transparent');
    this.btnEmpty = $('#design-empty');
    this.hoverEl = $('#design-hover');
    this.usedEl = $('#design-used');

    this.type = 'block';
    this.pixels = [];
    this.color = '#ffffff'; // CLEAR(투명) · null(비우기)도 됨
    this.paintValue = undefined; // 드래그 중에 칠하는 값 (undefined면 칠하는 중 아님)
    this.onSave = null;

    this.picker = new ColorPicker($('#design-picker'), {
      onChange: (hex) => {
        this.color = hex;
        this.renderUsed();
      },
    });

    for (const type of DESIGN_TYPE_ORDER) {
      const opt = document.createElement('option');
      opt.value = type;
      opt.textContent = DesignTypes[type].label;
      this.typeSelect.append(opt);
    }
    this.typeSelect.addEventListener('change', () => {
      this.type = this.typeSelect.value;
      this.pixels = newDesignPixels(this.type);
      this.render();
    });

    // 좌클릭 칠하기 · 우클릭 투명 · Alt+클릭 그 칸의 색 집기
    this.grid.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button === 0 && e.altKey) {
        const i = this.pixelAt(e);
        if (i !== null) this.setColor(this.pixels[i]);
        return;
      }
      this.paintValue = e.button === 2 ? null : this.color; // 우클릭: 비우기
      this.paintAt(e);
    });
    this.grid.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.paintValue !== undefined) this.paintAt(e);
    });
    this.grid.addEventListener('mousemove', (e) => {
      const i = this.pixelAt(e);
      this.hoverEl.textContent = i === null ? '' : `${i + 1}번 픽셀`; // 코드의 px(A, 색)·pxColor(A) 번호
    });
    this.grid.addEventListener('mouseleave', () => {
      this.hoverEl.textContent = '';
    });
    window.addEventListener('mouseup', () => {
      this.paintValue = undefined;
    });

    this.btnTransparent.addEventListener('click', () => this.setColor(CLEAR));
    this.btnEmpty.addEventListener('click', () => this.setColor(null));
    this.usedEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-color]');
      if (btn) this.setColor(btn.dataset.color);
    });
    $('#design-fill').addEventListener('click', () => {
      this.pixels = this.pixels.map(() => this.color);
      this.render();
    });
    $('#design-save').addEventListener('click', () => {
      this.onSave(this.type, this.pixels);
      Modal.close();
    });
  }

  // isNew면 종류를 고를 수 있다. 이미 있는 디자인은 놓인 블록의 성질이 바뀌지 않도록 종류 고정.
  open({ title, type, pixels, isNew, onSave }) {
    this.titleEl.textContent = title;
    this.type = type;
    this.pixels = pixels.slice();
    this.onSave = onSave;
    this.typeSelect.value = type;
    this.typeRow.classList.toggle('hidden', !isNew);
    this.render();
    Modal.open(this.el);
  }

  setColor(color) {
    this.color = color;
    if (color && color !== CLEAR) this.picker.setColor(color);
    this.renderUsed();
  }

  pixelAt(e) {
    const rect = this.grid.getBoundingClientRect();
    const px = Math.floor(((e.clientX - rect.left) / rect.width) * DESIGN_SIZE);
    const py = Math.floor(((e.clientY - rect.top) / rect.height) * DESIGN_SIZE);
    if (px < 0 || py < 0 || px >= DESIGN_SIZE || py >= DESIGN_SIZE) return null;
    return py * DESIGN_SIZE + px;
  }

  paintAt(e) {
    const i = this.pixelAt(e);
    if (i === null || this.pixels[i] === this.paintValue) return;
    this.pixels[i] = this.paintValue;
    this.render();
  }

  render() {
    this.renderGrid();
    this.renderPreview();
    this.renderUsed();
  }

  renderGrid() {
    const ctx = this.grid.getContext('2d');
    const size = this.grid.width;
    const cell = size / DESIGN_SIZE;
    ctx.clearRect(0, 0, size, size);
    this.pixels.forEach((color, i) => {
      const x = (i % DESIGN_SIZE) * cell;
      const y = Math.floor(i / DESIGN_SIZE) * cell;
      if (!color || color === CLEAR) {
        // 비움·투명: 체크무늬
        const h = cell / 2;
        ctx.fillStyle = '#d5d9e3';
        ctx.fillRect(x, y, cell, cell);
        ctx.fillStyle = '#f1f3f7';
        ctx.fillRect(x, y, h, h);
        ctx.fillRect(x + h, y + h, h, h);
        if (color === CLEAR) {
          // 투명(판정 있음): 하늘색 빗금
          ctx.fillStyle = 'rgba(80, 180, 255, 0.35)';
          ctx.fillRect(x, y, cell, cell);
          ctx.strokeStyle = 'rgba(40, 120, 220, 0.7)';
          ctx.lineWidth = 2;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, cell, cell);
          ctx.clip();
          ctx.beginPath();
          for (let k = -cell; k < cell; k += 8) {
            ctx.moveTo(x + k, y + cell);
            ctx.lineTo(x + k + cell, y);
          }
          ctx.stroke();
          ctx.restore();
        }
      } else {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, cell, cell);
      }
    });

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k <= DESIGN_SIZE; k++) {
      const p = Math.round(k * cell) + 0.5;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
    }
    ctx.stroke();
  }

  // 왼쪽: 크게 한 칸, 오른쪽: 실제 크기로 2x2 붙여놓은 모습
  renderPreview() {
    const ctx = this.preview.getContext('2d');
    const { width, height } = this.preview;
    const design = new Design(this.type, this.pixels);
    ctx.fillStyle = '#8fd3fb';
    ctx.fillRect(0, 0, width, height);
    DesignArt.draw(ctx, design, 0, 0, height);
    const T = TILE_SIZE;
    const ox = height + 16;
    const oy = height - T * 2;
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) DesignArt.draw(ctx, design, ox + x * T, oy + y * T, T);
  }

  // 이 디자인에 쓴 색들 (눌러서 다시 고르기)
  renderUsed() {
    const colors = [...new Set(this.pixels.filter((c) => c && c !== CLEAR))];
    this.usedEl.replaceChildren(
      ...colors.map((c) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'swatch' + (c === this.color ? ' active' : '');
        btn.dataset.color = c;
        btn.style.background = c;
        btn.title = c;
        return btn;
      }),
    );
    this.btnTransparent.classList.toggle('active', this.color === CLEAR);
    this.btnEmpty.classList.toggle('active', this.color === null);
  }
}
