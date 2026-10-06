// 블록 디자인: 8x8 픽셀에 색을 찍어 만든 블록.
// 사각형이 아닌 블록(가시류)은 모양 밖 픽셀이 투명으로 고정되고, 그릴 때도 모양대로 잘린다.

const DESIGN_SIZE = 8;

// solid: 단단함 · hazard: 닿으면 사망 · rotatable: 90도 회전 · positioned: 왼/가운데/오른 위치 · directional: 좌우 방향
const DesignTypes = {
  block: { code: 'B', label: '일반 블록', desc: '단단한 블록', solid: true },
  deco: { code: 'D', label: '빈칸 (장식)', desc: '통과할 수 있는 장식' },
  spike3: { code: 'T', label: '가시', desc: '닿으면 죽음 · R 회전', hazard: true, rotatable: true },
  spike1: { code: 'U', label: '단일 가시', desc: '닿으면 죽음 · Q 위치 · R 회전', hazard: true, rotatable: true, positioned: true },
  bigspike: { code: 'K', label: '큰 가시', desc: '닿으면 죽음 · R 회전', hazard: true, rotatable: true },
  ice: { code: 'I', label: '얼음', desc: '위에서 미끄러짐', solid: true },
  machine: { code: 'M', label: '머신', desc: '위에 있으면 저절로 이동 · R 방향', solid: true, directional: true },
  wall: { code: 'W', label: '벽', desc: '옆에 딱 붙어 있으면 계속 점프', solid: true },
  cloud: { code: 'C', label: '구름', desc: '닿기만 하면 저절로 튀어오름' },
  darkcloud: { code: 'N', label: '먹구름', desc: '닿으면 빠르게 떨어짐' },
  ladder: { code: 'H', label: '사다리', desc: '↑↓로 오르내림 (Space로 점프)' },
  airjump: { code: 'O', label: '공점', desc: '겹친 채로 점프하면 공중에서 점프' },
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

// 칸 중심 기준 시계 방향 90도 회전을 rot번
function rotateUnitPoint([u, v], rot) {
  for (let i = 0; i < rot; i++) [u, v] = [1 - v, u];
  return [u, v];
}

const Shapes = {
  // 칸 안 좌표(0~1)의 삼각형 목록. null이면 칸 전체를 채우는 사각형.
  // 가시(1/3 크기 삼각형 3개), 단일 가시(1/3 크기 1개, pos 0 왼쪽 · 1 가운데 · 2 오른쪽), 큰 가시(칸 크기 1개)
  // rot: 0 위 · 1 오른쪽 · 2 아래 · 3 왼쪽 (가시 끝이 향하는 방향)
  triangles(type, pos = 1, rot = 0) {
    const small = (i) => [[i / 3, 1], [(i + 0.5) / 3, 2 / 3], [(i + 1) / 3, 1]];
    let tris;
    switch (type) {
      case 'spike3': tris = [small(0), small(1), small(2)]; break;
      case 'spike1': tris = [small(pos)]; break;
      case 'bigspike': tris = [[[0, 1], [0.5, 0], [1, 1]]]; break;
      default: return null;
    }
    return rot ? tris.map((tri) => tri.map((pt) => rotateUnitPoint(pt, rot))) : tris;
  },

  // 칠할 수 있는 픽셀: 모양과 5% 넘게 겹치는 픽셀. 단일 가시는 가운데, 회전 없는 상태 기준.
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
  // tag: 블록 태그 (맵 안에서 디자인마다 다른 번호, 0이면 맵에 넣을 때 배정) · code: 블록 코드 (없으면 '')
  constructor(type, pixels = new Array(DESIGN_SIZE * DESIGN_SIZE).fill(null), { tag = 0, code = '' } = {}) {
    this.type = type;
    this.tag = tag;
    this.code = code;
    this.version = 0; // 바뀔 때마다 증가 (그림 캐시 갱신용)
    this.setPixels(pixels);
  }

  setPixels(pixels) {
    const mask = Shapes.mask(this.type);
    this.pixels = pixels.map((c, i) => (mask[i] ? c : null));
    this.version++;
  }

  // 태그와 코드까지 그대로 복사 (맵 복사용). 팔레트에서 복제할 땐 맵이 새 태그를 붙인다.
  clone() {
    return new Design(this.type, this.pixels, { tag: this.tag, code: this.code });
  }
}

// 기본 디자인 견본. 글자 하나가 픽셀 하나, '.'은 투명.
const SPIKE_COLORS = { l: '#e8ebf2', h: '#a3abbd' };
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
    colors: SPIKE_COLORS,
    rows: ['........', '........', '........', '........', '........', '.h.lh.l.', 'lh.lh.lh', 'lhhlhllh'],
  },
  spike1: {
    type: 'spike1',
    colors: SPIKE_COLORS,
    rows: ['........', '........', '........', '........', '........', '...lh...', '...lh...', '..llhh..'],
  },
  bigspike: {
    type: 'bigspike',
    colors: SPIKE_COLORS,
    rows: ['...lh...', '...lh...', '..llhh..', '..llhh..', '.lllhhh.', '.lllhhh.', 'llllhhhh', 'llllhhhh'],
  },
  ice: {
    type: 'ice',
    colors: { W: '#eefaff', l: '#a6dcf2', L: '#78c2e6' },
    rows: ['WWWWWWWW', 'WlllllWl', 'lllllWll', 'llllWlll', 'lllWllll', 'llWlllll', 'lWlllllL', 'LLLLLLLL'],
  },
  machine: {
    // 화살표가 오른쪽을 향하게 그린다. 왼쪽으로 놓으면 좌우 반전되어 그려짐.
    type: 'machine',
    colors: { D: '#3d4250', a: '#ffd23f', g: '#7a8194', o: '#c4cad6', k: '#4a4f5c' },
    rows: ['DaDDDaDD', 'DDaDDDaD', 'DaDDDaDD', 'DDDDDDDD', 'gggggggg', 'goggggog', 'gggggggg', 'kkkkkkkk'],
  },
  wall: {
    type: 'wall',
    colors: { b: '#8b8fa3', d: '#585c6e' },
    rows: ['bbbbdbbb', 'bbbbdbbb', 'bbbbdbbb', 'dddddddd', 'bbdbbbbb', 'bbdbbbbb', 'bbdbbbbb', 'dddddddd'],
  },
  cloud: {
    type: 'cloud',
    colors: { w: '#ffffff', s: '#d6e4f0' },
    rows: ['..wwww..', '.wwwwww.', 'wwwwwwww', 'wwwwwwww', 'wwwwwwww', 'swwwwwws', '.ssssss.', '........'],
  },
  darkcloud: {
    type: 'darkcloud',
    colors: { d: '#5d6273', k: '#41454f', r: '#7fb2e5' },
    rows: ['..dddd..', '.dddddd.', 'dddddddd', 'dddddddd', 'dddddddd', 'kddddddk', '.kkkkkk.', '.r..r.r.'],
  },
  ladder: {
    type: 'ladder',
    colors: { b: '#8a5a34', r: '#c48a52' },
    rows: ['b......b', 'brrrrrrb', 'b......b', 'b......b', 'b......b', 'brrrrrrb', 'b......b', 'b......b'],
  },
  airjump: {
    type: 'airjump',
    colors: { o: '#1f9d5c', i: '#8ef0b5' },
    rows: ['..oooo..', '.oiiiio.', 'oi....io', 'oi....io', 'oi....io', 'oi....io', '.oiiiio.', '..oooo..'],
  },
};

function designFromTemplate(name) {
  const t = DESIGN_TEMPLATES[name];
  const pixels = [...t.rows.join('')].map((ch) => (ch === '.' ? null : t.colors[ch]));
  return new Design(t.type, pixels);
}

const DEFAULT_DESIGN_ORDER = [
  'grass', 'dirt', 'flower', 'spike3', 'spike1', 'bigspike',
  'ice', 'machine', 'wall', 'cloud', 'darkcloud', 'ladder', 'airjump',
];

function defaultDesigns() {
  return DEFAULT_DESIGN_ORDER.map(designFromTemplate);
}

// 새 디자인을 만들 때 시작 그림 (장식은 빈 상태로 시작)
const NEW_DESIGN_TEMPLATE = {
  block: 'grass', deco: null, spike3: 'spike3', spike1: 'spike1', bigspike: 'bigspike',
  ice: 'ice', machine: 'machine', wall: 'wall', cloud: 'cloud', darkcloud: 'darkcloud', ladder: 'ladder', airjump: 'airjump',
};

// 종류마다 기본으로 쓰는 디자인 (맵에 그 종류가 하나도 없을 때 팔레트에 채워 넣음)
const TYPE_DEFAULT_TEMPLATE = { ...NEW_DESIGN_TEMPLATE, deco: 'flower' };

function newDesignPixels(type) {
  const name = NEW_DESIGN_TEMPLATE[type];
  return name ? designFromTemplate(name).pixels : new Array(DESIGN_SIZE * DESIGN_SIZE).fill(null);
}

const DesignArt = {
  cache: new WeakMap(),

  // 디자인을 (x, y)에 size 크기로 그린다 (회전 없음). 모양 밖은 잘라낸다.
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
