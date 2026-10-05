// 배경 고르기 창: 기본 배경 3개 + 단색 + 그라데이션. 고르는 대로 바로 보이고, 취소하면 되돌린다.

class BackgroundDialog {
  constructor() {
    const $ = (sel) => document.querySelector(sel);
    this.el = $('#modal-bg');
    this.optionsEl = $('#bg-options');
    this.customEl = $('#bg-custom');
    this.slotsEl = $('#bg-slots');
    this.dirRow = $('#bg-dir-row');
    this.dirSelect = $('#bg-dir');
    this.bg = DEFAULT_BACKGROUND;
    this.slot = 'color'; // 색상 선택기가 바꾸는 색: color(단색) · from · to(그라데이션)
    this.apply = null;
    this.confirmed = false;
    // 단색/그라데이션으로 바꿀 때 쓸 색 (마지막으로 고른 색을 기억)
    this.custom = { color: '#4a90d9', from: '#5ab8f5', to: '#1d2a5a', dir: 'v' };

    this.picker = new ColorPicker($('#bg-picker'), {
      onChange: (hex) => {
        this.custom[this.slot] = hex;
        this.set(this.customBackground(this.bg.type), false);
      },
    });

    const choices = [
      ...BACKGROUND_PRESETS.map((p, id) => ({ label: p.name, bg: { type: 'preset', id } })),
      { label: '단색', bg: null, type: 'solid' },
      { label: '그라데이션', bg: null, type: 'gradient' },
    ];
    for (const choice of choices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bg-option';
      btn.dataset.choice = choice.bg ? `preset${choice.bg.id}` : choice.type;
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 68;
      const label = document.createElement('span');
      label.textContent = choice.label;
      btn.append(canvas, label);
      btn.addEventListener('click', () => {
        const bg = choice.bg || this.customBackground(choice.type);
        this.slot = bg.type === 'gradient' ? 'from' : 'color';
        this.set(bg);
      });
      this.optionsEl.append(btn);
      choice.canvas = canvas;
    }
    this.choices = choices;

    for (const [dir, d] of Object.entries(GRADIENT_DIRS)) {
      const opt = document.createElement('option');
      opt.value = dir;
      opt.textContent = d.label;
      this.dirSelect.append(opt);
    }
    this.dirSelect.addEventListener('change', () => {
      this.custom.dir = this.dirSelect.value;
      this.set(this.customBackground('gradient'));
    });
    this.slotsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-slot]');
      if (!btn) return;
      this.slot = btn.dataset.slot;
      this.render();
    });
    $('#bg-ok').addEventListener('click', () => {
      this.confirmed = true;
      Modal.close();
    });
  }

  customBackground(type) {
    const c = this.custom;
    return type === 'solid' ? { type, color: c.color } : { type: 'gradient', from: c.from, to: c.to, dir: c.dir };
  }

  // apply(bg): 고를 때마다 호출 (맵에 바로 반영)
  open(current, apply) {
    const original = current;
    this.apply = apply;
    this.confirmed = false;
    if (current.type === 'solid') this.custom.color = current.color;
    if (current.type === 'gradient') Object.assign(this.custom, { from: current.from, to: current.to, dir: current.dir });
    this.slot = current.type === 'gradient' ? 'from' : 'color';
    this.bg = current;
    this.render();
    Modal.open(this.el, {
      onClose: () => {
        if (!this.confirmed) apply(original);
      },
    });
  }

  // syncPicker: 색상 선택기를 지금 색으로 맞출지 (선택기를 끄는 중엔 맞추지 않아야 색조가 안 튐)
  set(bg, syncPicker = true) {
    this.bg = bg;
    this.apply(bg);
    this.render(syncPicker);
  }

  render(syncPicker = true) {
    const bg = this.bg;
    const current = bg.type === 'preset' ? `preset${bg.id}` : bg.type;
    for (const choice of this.choices) {
      const btn = choice.canvas.parentElement;
      btn.classList.toggle('active', btn.dataset.choice === current);
      const preview = choice.bg || this.customBackground(choice.type);
      Backgrounds.draw(choice.canvas.getContext('2d'), preview, 0, choice.canvas.width, choice.canvas.height);
    }

    const custom = bg.type !== 'preset';
    this.customEl.classList.toggle('hidden', !custom);
    if (!custom) return;
    const slots = bg.type === 'solid' ? [['color', '색']] : [['from', '시작 색'], ['to', '끝 색']];
    this.slotsEl.replaceChildren(
      ...slots.map(([slot, label]) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bg-slot' + (slot === this.slot ? ' active' : '');
        btn.dataset.slot = slot;
        const sw = document.createElement('span');
        sw.className = 'cp-swatch';
        sw.style.background = this.custom[slot];
        btn.append(sw, document.createTextNode(label));
        return btn;
      }),
    );
    this.dirRow.classList.toggle('hidden', bg.type !== 'gradient');
    this.dirSelect.value = this.custom.dir;
    if (syncPicker) this.picker.setColor(this.custom[this.slot]);
  }
}
