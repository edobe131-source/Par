// 색상 선택기: 채도/밝기 사각형 + 색조 막대 + 16진 입력. 모든 색(#rrggbb)을 고를 수 있다.

function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return '#' + [f(5), f(3), f(1)].map((c) => c.toString(16).padStart(2, '0')).join('');
}

function hexToHsv(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: max ? d / max : 0, v: max };
}

class ColorPicker {
  // onChange(hex): 사용자가 색을 바꿀 때마다 호출
  constructor(container, { onChange }) {
    this.onChange = onChange;
    this.h = 0;
    this.s = 0;
    this.v = 1;

    container.classList.add('color-picker');
    this.sv = document.createElement('canvas');
    this.sv.className = 'cp-sv';
    this.sv.width = 200;
    this.sv.height = 120;
    this.hue = document.createElement('canvas');
    this.hue.className = 'cp-hue';
    this.hue.width = 200;
    this.hue.height = 14;
    const row = document.createElement('div');
    row.className = 'cp-row';
    this.swatch = document.createElement('span');
    this.swatch.className = 'cp-swatch';
    this.hex = document.createElement('input');
    this.hex.className = 'cp-hex';
    this.hex.maxLength = 7;
    this.hex.spellcheck = false;
    row.append(this.swatch, this.hex);
    container.append(this.sv, this.hue, row);

    this.drag(this.sv, (x, y) => {
      this.s = x;
      this.v = 1 - y;
    });
    this.drag(this.hue, (x) => {
      this.h = Math.min(359.9, x * 360);
    });
    this.hex.addEventListener('input', () => {
      const m = /^#?([0-9a-fA-F]{6})$/.exec(this.hex.value.trim());
      if (!m) return;
      Object.assign(this, hexToHsv('#' + m[1].toLowerCase()));
      this.draw(false);
      this.onChange(this.color);
    });
    this.draw();
  }

  get color() {
    return hsvToHex(this.h, this.s, this.v);
  }

  // 밖에서 색을 정할 때 (onChange는 부르지 않음)
  setColor(hex) {
    Object.assign(this, hexToHsv(hex));
    this.draw();
  }

  drag(canvas, apply) {
    const handle = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      apply(x, y);
      this.draw();
      this.onChange(this.color);
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      handle(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (canvas.hasPointerCapture(e.pointerId)) handle(e);
    });
  }

  draw(updateHex = true) {
    const { width: w, height: h } = this.sv;
    const ctx = this.sv.getContext('2d');
    ctx.fillStyle = hsvToHex(this.h, 1, 1);
    ctx.fillRect(0, 0, w, h);
    const white = ctx.createLinearGradient(0, 0, w, 0);
    white.addColorStop(0, '#fff');
    white.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = white;
    ctx.fillRect(0, 0, w, h);
    const black = ctx.createLinearGradient(0, 0, 0, h);
    black.addColorStop(0, 'rgba(0, 0, 0, 0)');
    black.addColorStop(1, '#000');
    ctx.fillStyle = black;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = this.v > 0.5 && this.s < 0.5 ? '#000' : '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.s * w, (1 - this.v) * h, 6, 0, Math.PI * 2);
    ctx.stroke();

    const hc = this.hue.getContext('2d');
    const hw = this.hue.width;
    const grad = hc.createLinearGradient(0, 0, hw, 0);
    for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, hsvToHex((i * 60) % 360, 1, 1));
    hc.fillStyle = grad;
    hc.fillRect(0, 0, hw, this.hue.height);
    const hx = (this.h / 360) * hw;
    hc.fillStyle = '#fff';
    hc.fillRect(hx - 2, 0, 4, this.hue.height);
    hc.strokeStyle = '#000';
    hc.lineWidth = 1;
    hc.strokeRect(hx - 2.5, 0.5, 5, this.hue.height - 1);

    this.swatch.style.background = this.color;
    if (updateHex) this.hex.value = this.color;
  }
}
