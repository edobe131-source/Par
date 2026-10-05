// 블록 디자인: 8x8 픽셀에 색을 찍어 만든 블록.
// 사각형이 아닌 블록(가시류)은 모양 밖 픽셀이 투명으로 고정되고, 그릴 때도 모양대로 잘린다.

const DESIGN_SIZE = 8;

const DesignTypes = {
  block: { code: 'B', label: '일반 블록', solid: true },
  deco: { code: 'D', label: '빈칸 (장식)' },
  spike3: { code: 'T', label: '가시', hazard: true },
  spike1: { code: 'U', label: '단일 가시', hazard: true },
  bigspike: { code: 'K', label: '큰 가시', hazard: true },
};
const DESIGN_TYPE_ORDER = Object.keys(DesignTypes);
const SPIKE_POSITIONS = ['왼쪽', '가운데', '오른쪽'];

function pointInTriangle(x, y, [a, b, c]) {
  const d1 = (x - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (y - b[1]);
  const d2 = (x - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (y - c[1]);
  const d3 = (x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y - a[1]);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

const Shapes = {
  // 칸 안 좌표(0~1)의 삼각형 목록. null이면 칸 전체를 채우는 사각형.
  // 가시(1/3 크기 삼각형 3개), 단일 가시(1/3 크기 1개, pos 0 왼쪽 · 1 가운데 · 2 오른쪽), 큰 가시(칸 크기 1개)
  triangles(type, pos = 1) {
    const small = (i) => [[i / 3, 1], [(i + 0.5) / 3, 2 / 3], [(i + 1) / 3, 1]];
    switch (type) {
      case 'spike3': return [small(0), small(1), small(2)];
      case 'spike1': return [small(pos)];
      case 'bigspike': return [[[0, 1], [0.5, 0], [1, 1]]];
      default: return null;
    }
  },

  // 칠할 수 있는 픽셀: 모양과 5% 넘게 겹치는 픽셀. 단일 가시는 가운데 위치 기준.
  maskCache: {},
  mask(type) {
    if (!this.maskCache[type]) {
      const tris = this.triangles(type);
      const N = DESIGN_SIZE;
      const SUB = 8; // 픽셀당 8x8 표본
      this.maskCache[type] = Array.from({ length: N * N }, (_, i) => {
        if (!tris) return true;
        const px = i % N;
        const py = Math.floor(i / N);
        let hits = 0;
        for (let sy = 0; sy < SUB; sy++) {
          for (let sx = 0; sx < SUB; sx++) {
            const u = (px + (sx + 0.5) / SUB) / N;
            const v = (py + (sy + 0.5) / SUB) / N;
            if (tris.some((t) => pointInTriangle(u, v, t))) hits++;
          }
        }
        return hits / (SUB * SUB) > 0.05;
      });
    }
    return this.maskCache[type];
  },
};

class Design {
  // pixels: 64칸, 각 칸은 '#rrggbb' 또는 null(투명)
  constructor(type, pixels = new Array(DESIGN_SIZE * DESIGN_SIZE).fill(null)) {
    this.type = type;
    this.version = 0; // 바뀔 때마다 증가 (그림 캐시 갱신용)
    this.setPixels(pixels);
  }

  setPixels(pixels) {
    const mask = Shapes.mask(this.type);
    this.pixels = pixels.map((c, i) => (mask[i] ? c : null));
    this.version++;
  }

  clone() {
    return new Design(this.type, this.pixels);
  }
}

// 기본 디자인 견본. 글자 하나가 픽셀 하나, '.'은 투명.
const DESIGN_TEMPLATES = {
  grass: {
    type: 'block',
    colors: { G: '#7bd67f', g: '#4caf50', d: '#9a6640', D: '#7e5032' },
    rows: ['GGGGGGGG', 'gGggGggG', 'dgddgddg', 'dddDdddd', 'dDdddddD', 'dddddDdd', 'Dddddddd', 'dddDdddd'],
  },
  dirt: {
    type: 'block',
    colors: { d: '#9a6640', D: '#7e5032' },
    rows: ['dddDdddd', 'dDdddddD', 'dddddDdd', 'Dddddddd', 'dddDdddd', 'ddddddDd', 'dDdddddd', 'ddddDddd'],
  },
  flower: {
    type: 'deco',
    colors: { p: '#ff8fb1', y: '#ffd23f', g: '#4caf50' },
    rows: ['........', '........', '...p....', '..pyp...', '...p..g.', '.g.g.g..', '..ggg.g.', '.gggggg.'],
  },
  spike3: {
    type: 'spike3',
    colors: { l: '#e8ebf2', h: '#a3abbd' },
    rows: ['........', '........', '........', '........', '........', '.h.lh.l.', 'lh.lh.lh', 'lhhlhllh'],
  },
  spike1: {
    type: 'spike1',
    colors: { l: '#e8ebf2', h: '#a3abbd' },
    rows: ['........', '........', '........', '........', '........', '...lh...', '...lh...', '..llhh..'],
  },
  bigspike: {
    type: 'bigspike',
    colors: { l: '#e8ebf2', h: '#a3abbd' },
    rows: ['...lh...', '...lh...', '..llhh..', '..llhh..', '.lllhhh.', '.lllhhh.', 'llllhhhh', 'llllhhhh'],
  },
};

function designFromTemplate(name) {
  const t = DESIGN_TEMPLATES[name];
  const pixels = [...t.rows.join('')].map((ch) => (ch === '.' ? null : t.colors[ch]));
  return new Design(t.type, pixels);
}

function defaultDesigns() {
  return ['grass', 'dirt', 'flower', 'spike3', 'spike1', 'bigspike'].map(designFromTemplate);
}

// 새 디자인을 만들 때 시작 그림 (장식은 빈 상태로 시작)
const NEW_DESIGN_TEMPLATE = { block: 'grass', deco: null, spike3: 'spike3', spike1: 'spike1', bigspike: 'bigspike' };

function newDesignPixels(type) {
  const name = NEW_DESIGN_TEMPLATE[type];
  return name ? designFromTemplate(name).pixels : new Array(DESIGN_SIZE * DESIGN_SIZE).fill(null);
}

const DesignArt = {
  cache: new WeakMap(),

  // 디자인을 (x, y)에 size 크기로 그린다. 모양 밖은 잘라낸다.
  draw(ctx, design, x, y, size, pos = 1) {
    const tris = Shapes.triangles(design.type, pos);
    const s = size / DESIGN_SIZE;
    // 단일 가시는 가운데 기준으로 그린 그림을 위치만큼 옮긴다.
    const offset = design.type === 'spike1' ? ((pos - 1) * size) / 3 : 0;
    ctx.save();
    if (tris) {
      ctx.beginPath();
      for (const [a, b, c] of tris) {
        ctx.moveTo(x + a[0] * size, y + a[1] * size);
        ctx.lineTo(x + b[0] * size, y + b[1] * size);
        ctx.lineTo(x + c[0] * size, y + c[1] * size);
        ctx.closePath();
      }
      ctx.clip();
    }
    design.pixels.forEach((color, i) => {
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x + offset + (i % DESIGN_SIZE) * s, y + Math.floor(i / DESIGN_SIZE) * s, s, s);
    });
    ctx.restore();
  },

  // 칸 크기로 미리 그려둔 캔버스 (디자인이 바뀌면 다시 그림). 단일 가시는 가운데 위치.
  tile(design) {
    let entry = this.cache.get(design);
    if (!entry || entry.version !== design.version) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = TILE_SIZE;
      this.draw(canvas.getContext('2d'), design, 0, 0, TILE_SIZE);
      entry = { version: design.version, canvas };
      this.cache.set(design, entry);
    }
    return entry.canvas;
  },
};
