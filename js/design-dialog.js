// 블록 디자인 편집 창: 8x8 픽셀에 색을 찍는다. 빗금 칸은 모양 밖이라 투명으로 고정.

const PRESET_COLORS = [
  '#000000', '#5b5b66', '#a3abbd', '#e8ebf2', '#ffffff', '#7e5032', '#9a6640', '#d9a066',
  '#2e7d32', '#4caf50', '#7bd67f', '#1e88e5', '#5ab8f5', '#9c27b0', '#ff8fb1', '#e53935',
  '#ff6b4a', '#ff9800', '#ffd23f', '#fff3a3',
];

class DesignDialog {
  constructor() {
    const $ = (sel) => document.querySelector(sel);
    this.el = $('#modal-design');
    this.titleEl = $('#design-title');
    this.typeRow = $('#design-type-row');
    this.typeSelect = $('#design-type');
    this.grid = $('#design-grid');
    this.preview = $('#design-preview');
    this.colorInput = $('#design-color');
    this.btnTransparent = $('#design-transparent');
    this.swatches = $('#design-swatches');

    this.type = 'block';
    this.pixels = [];
    this.color = '#ffffff'; // null이면 투명
    this.paintValue = undefined; // 드래그 중에 칠하는 값 (undefined면 칠하는 중 아님)
    this.onSave = null;

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

    this.grid.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.paintValue = e.button === 2 ? null : this.color;
      this.paintAt(e);
    });
    this.grid.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.paintValue !== undefined) this.paintAt(e);
    });
    window.addEventListener('mouseup', () => {
      this.paintValue = undefined;
    });

    this.colorInput.addEventListener('input', () => this.setColor(this.colorInput.value));
    this.btnTransparent.addEventListener('click', () => this.setColor(null));
    this.swatches.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-color]');
      if (btn) this.setColor(btn.dataset.color);
    });
    $('#design-fill').addEventListener('click', () => {
      const mask = Shapes.mask(this.type);
      this.pixels = this.pixels.map((c, i) => (mask[i] ? this.color : null));
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
    if (color) this.colorInput.value = color;
    this.renderSwatches();
  }

  paintAt(e) {
    const rect = this.grid.getBoundingClientRect();
    const px = Math.floor(((e.clientX - rect.left) / rect.width) * DESIGN_SIZE);
    const py = Math.floor(((e.clientY - rect.top) / rect.height) * DESIGN_SIZE);
    if (px < 0 || py < 0 || px >= DESIGN_SIZE || py >= DESIGN_SIZE) return;
    const i = py * DESIGN_SIZE + px;
    if (!Shapes.mask(this.type)[i] || this.pixels[i] === this.paintValue) return;
    this.pixels[i] = this.paintValue;
    this.render();
  }

  render() {
    this.renderGrid();
    this.renderPreview();
    this.renderSwatches();
  }

  renderGrid() {
    const ctx = this.grid.getContext('2d');
    const size = this.grid.width;
    const cell = size / DESIGN_SIZE;
    const mask = Shapes.mask(this.type);
    ctx.clearRect(0, 0, size, size);
    this.pixels.forEach((color, i) => {
      const x = (i % DESIGN_SIZE) * cell;
      const y = Math.floor(i / DESIGN_SIZE) * cell;
      if (!mask[i]) {
        // 고정된 투명 영역: 빗금
        ctx.fillStyle = '#262b40';
        ctx.fillRect(x, y, cell, cell);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
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
      } else if (!color) {
        // 투명: 체크무늬
        const h = cell / 2;
        ctx.fillStyle = '#d5d9e3';
        ctx.fillRect(x, y, cell, cell);
        ctx.fillStyle = '#f1f3f7';
        ctx.fillRect(x, y, h, h);
        ctx.fillRect(x + h, y + h, h, h);
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

    // 실제 모양 외곽선
    const tris = Shapes.triangles(this.type);
    if (tris) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (const [a, b, c] of tris) {
        ctx.moveTo(a[0] * size, a[1] * size);
        ctx.lineTo(b[0] * size, b[1] * size);
        ctx.lineTo(c[0] * size, c[1] * size);
        ctx.closePath();
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
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

  renderSwatches() {
    const used = this.pixels.filter(Boolean);
    const colors = [...new Set([...PRESET_COLORS, ...used])];
    this.swatches.replaceChildren(
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
    this.btnTransparent.classList.toggle('active', this.color === null);
  }
}
