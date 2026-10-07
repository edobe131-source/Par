// 블록 디자인: 8x8 픽셀에 색을 찍어 만든 블록. 어떤 종류든 8x8 전체를 쓸 수 있다.
// 픽셀 값: '#rrggbb' 색 · 'clear' 투명(안 보이지만 판정 있음) · null 비움(판정 없음)
// 블록의 판정은 그린 픽셀 모양 그대로다 (Hitbox 참고).

const DESIGN_SIZE = 8;
const PIXEL = TILE_SIZE / DESIGN_SIZE; // 픽셀 한 칸 = 4px
const CLEAR = 'clear';

// solid: 단단함 · hazard: 닿으면 사망 · rotatable: 90도 회전 · positioned: 왼/가운데/오른 위치 · directional: 좌우 방향
const DesignTypes = {
  block: { code: 'B', label: '일반 블록', desc: '단단한 블록 · R 회전', solid: true, rotatable: true },
  deco: { code: 'D', label: '빈칸 (장식)', desc: '통과할 수 있는 장식 · R 회전', rotatable: true },
  spike3: { code: 'T', label: '가시', desc: '닿으면 죽음 · R 회전', hazard: true, rotatable: true },
  spike1: { code: 'U', label: '단일 가시', desc: '닿으면 죽음 · Q 위치 · R 회전', hazard: true, rotatable: true, positioned: true },
  bigspike: { code: 'K', label: '큰 가시', desc: '닿으면 죽음 · R 회전', hazard: true, rotatable: true },
  ice: { code: 'I', label: '얼음', desc: '위에서 미끄러짐 · R 회전', solid: true, rotatable: true },
  machine: { code: 'M', label: '머신', desc: '위에 있으면 저절로 이동 · R 방향', solid: true, directional: true },
  wall: { code: 'W', label: '벽', desc: '옆에 딱 붙어 있으면 계속 점프 · R 회전', solid: true, rotatable: true },
  cloud: { code: 'C', label: '구름', desc: '닿기만 하면 저절로 튀어오름 · R 회전', rotatable: true },
  darkcloud: { code: 'N', label: '먹구름', desc: '닿으면 빠르게 떨어짐 · R 회전', rotatable: true },
  ladder: { code: 'H', label: '사다리', desc: '↑↓로 오르내림 (Space로 점프) · R 회전', rotatable: true },
  airjump: { code: 'O', label: '공점', desc: '겹친 채로 점프하면 공중에서 점프 · R 회전', rotatable: true },
};
const DESIGN_TYPE_ORDER = Object.keys(DesignTypes);
const SPIKE_POSITIONS = ['왼쪽', '가운데', '오른쪽'];

// 판정 종류: pixels(그린 픽셀 하나하나) · area(비어 있지 않은 픽셀을 감싸는 범위 하나) · none(판정 없음)
// 통과하는 특수 블록(구름·먹구름·사다리·공점)은 가운데가 빈 그림(사다리 칸 사이, 고리 가운데)도 쓸 수 있게 범위로 판정한다.
function hitKind(type) {
  const t = DesignTypes[type];
  if (t.solid || t.hazard) return 'pixels';
  return type === 'deco' ? 'none' : 'area';
}

// 가로로 이어진 픽셀을 묶고, 같은 폭이 아래로 이어지면 한 사각형으로 (픽셀 단위)
function mergedPixelRects(pixels) {
  const N = DESIGN_SIZE;
  const out = [];
  let open = [];
  for (let y = 0; y < N; y++) {
    const next = [];
    for (let x = 0; x < N;) {
      if (pixels[y * N + x] == null) {
        x++;
        continue;
      }
      const start = x;
      while (x < N && pixels[y * N + x] != null) x++;
      const above = open.find((r) => r.x === start && r.w === x - start);
      if (above) {
        above.h++;
        next.push(above);
      } else {
        const r = { x: start, y, w: x - start, h: 1 };
        out.push(r);
        next.push(r);
      }
    }
    open = next;
  }
  return out;
}

function pixelBounds(pixels) {
  const N = DESIGN_SIZE;
  let x0 = N, y0 = N, x1 = -1, y1 = -1;
  pixels.forEach((c, i) => {
    if (c == null) return;
    const x = i % N, y = Math.floor(i / N);
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  });
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const Hitbox = {
  // 판정 사각형들 (칸 왼쪽 위 기준 px). angle: 칸 가운데를 축으로 시계 방향 회전(도).
  // 90도 단위가 아닌 각도는 픽셀마다 돌린 사각형의 바깥 상자로 판정한다.
  rects(pixels, type, pos = 1, angle = 0) {
    const kind = hitKind(type);
    if (kind === 'none') return [];
    const N = DESIGN_SIZE;
    const shift = type === 'spike1' ? ((pos - 1) * N) / 3 : 0; // 단일 가시 위치
    const a = ((angle % 360) + 360) % 360;
    const bounds = kind === 'area' ? pixelBounds(pixels) : null;
    let units;
    if (a % 90 === 0) {
      units = (kind === 'area' ? (bounds ? [bounds] : []) : mergedPixelRects(pixels)).map((r) => ({ ...r, x: r.x + shift }));
      for (let k = 0; k < a / 90; k++) units = units.map((r) => ({ x: N - r.y - r.h, y: r.x, w: r.h, h: r.w }));
    } else {
      const c = Math.cos((a * Math.PI) / 180);
      const s = Math.sin((a * Math.PI) / 180);
      const boxes = kind === 'area'
        ? (bounds ? [bounds] : [])
        : pixels.flatMap((p, i) => (p == null ? [] : [{ x: i % N, y: Math.floor(i / N), w: 1, h: 1 }]));
      units = boxes.map((b) => {
        const xs = [];
        const ys = [];
        for (const [px, py] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) {
          const dx = px + shift - N / 2;
          const dy = py - N / 2;
          xs.push(N / 2 + dx * c - dy * s);
          ys.push(N / 2 + dx * s + dy * c);
        }
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
      });
    }
    return units.map((r) => ({ x: r.x * PIXEL, y: r.y * PIXEL, w: r.w * PIXEL, h: r.h * PIXEL }));
  },

  // 칸에 놓인 블록용 (디자인이 바뀔 때까지 기억)
  cache: new WeakMap(),
  forTile(tile) {
    const { design } = tile;
    let entry = this.cache.get(design);
    if (!entry || entry.version !== design.version) {
      entry = { version: design.version, byKey: new Map() };
      this.cache.set(design, entry);
    }
    const key = tile.pos * 4 + tile.rot;
    if (!entry.byKey.has(key)) entry.byKey.set(key, this.rects(design.pixels, design.type, tile.pos, tile.rot * 90));
    return entry.byKey.get(key);
  },
};

class Design {
  // pixels: 64칸 (값은 위 설명 참고)
  // tag: 블록 태그 (맵 안에서 디자인마다 다른 번호, 0이면 맵에 넣을 때 배정) · code: 블록 코드 (없으면 '')
  // keep: '죽어도 진행' — 캐릭터가 죽어도 이 블록의 코드는 처음부터 다시 하지 않고 계속 실행
  constructor(type, pixels = new Array(DESIGN_SIZE * DESIGN_SIZE).fill(null), { tag = 0, code = '', keep = false } = {}) {
    this.type = type;
    this.tag = tag;
    this.code = code;
    this.keep = keep;
    this.version = 0; // 바뀔 때마다 증가 (그림·판정 캐시 갱신용)
    this.setPixels(pixels);
  }

  setPixels(pixels) {
    this.pixels = pixels.slice();
    this.version++;
  }

  // 태그·코드·설정까지 그대로 복사 (맵 복사용). 팔레트에서 복제할 땐 맵이 새 태그를 붙인다.
  clone() {
    return new Design(this.type, this.pixels, { tag: this.tag, code: this.code, keep: this.keep });
  }
}

// 기본 디자인 견본. 글자 하나가 픽셀 하나, '.'은 비움.
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
    rows: ['........', '........', '........', '........', '........', '.l.lh.l.', 'llhlhllh', 'llhlhllh'],
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

  // 디자인을 (x, y)에 size 크기로 그린다 (회전 없음). design은 { type, pixels }만 있어도 된다.
  // ghost: 에디터에서 투명 픽셀(판정만 있음)을 옅게 보여 줌
  draw(ctx, design, x, y, size, pos = 1, ghost = false) {
    const s = size / DESIGN_SIZE;
    // 단일 가시는 가운데 기준으로 그린 그림을 위치만큼 옮긴다.
    const offset = design.type === 'spike1' ? ((pos - 1) * size) / 3 : 0;
    design.pixels.forEach((color, i) => {
      if (!color) return;
      const px = x + offset + (i % DESIGN_SIZE) * s;
      const py = y + Math.floor(i / DESIGN_SIZE) * s;
      if (color === CLEAR) {
        if (!ghost) return;
        ctx.fillStyle = 'rgba(127, 224, 255, 0.35)';
        ctx.fillRect(px, py, s, s);
        return;
      }
      ctx.fillStyle = color;
      ctx.fillRect(px, py, s, s);
    });
  },

  // 칸 크기로 미리 그려둔 캔버스 (디자인이 바뀌면 다시 그림). 단일 가시는 가운데 위치.
  tile(design, ghost = false) {
    let entry = this.cache.get(design);
    if (!entry || entry.version !== design.version) {
      entry = { version: design.version, canvases: {} };
      this.cache.set(design, entry);
    }
    if (!entry.canvases[ghost]) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = TILE_SIZE;
      this.draw(canvas.getContext('2d'), design, 0, 0, TILE_SIZE, 1, ghost);
      entry.canvases[ghost] = canvas;
    }
    return entry.canvases[ghost];
  },
};
