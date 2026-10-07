// 맵 데이터(무한 크기), 문자열 직렬화, 저장소.
//
// 칸마다 두 겹이 있다.
//   - 타일: 블록·스타트·체크포인트·별·밧줄 중 하나
//   - 구역: 노란 구역(2단 점프) · 보라 구역(무한 점프) · 물 중 하나 (타일과 겹쳐 놓을 수 있음)
//
// 맵 문자열 형식 (하나의 문자열, ';'로 나뉜 8부분):
//   PAR5;<배경>;<디자인들>;<타일 목록>;<원점x>,<원점y>;<행들>;<구역 원점x>,<구역 원점y>;<구역 행들>
//
//   배경: p0 / p1 / p2 (기본 배경 초원·노을·밤) · s<색> (단색) · g<색>+<색>+<방향> (그라데이션)
//         방향: v 위→아래 · h 왼→오른 · d 왼쪽 위→오른쪽 아래 · u 왼쪽 아래→오른쪽 위
//   디자인들: 쉼표로 구분. 각 디자인 = <종류><색들>:<픽셀 64자>:<블록 태그>:<설정>:<코드>
//     종류: B 일반 블록 · D 빈칸(장식) · T 가시 · U 단일 가시 · K 큰 가시 · I 얼음 · M 머신
//           W 벽 · C 구름 · N 먹구름 · H 사다리 · O 공점
//     색들: 16진 색상을 '+'로 연결 (예: 7bd67f+4caf50)
//     픽셀: 위 행부터 8x8, '.' 비움(판정 없음) · '~' 투명(판정 있음) · 나머지는 색 번호(0-9a-zA-Z-_)
//     설정: 'k' 죽어도 진행 (없으면 빈칸)
//     코드: encodeURIComponent로 감싼 블록 코드 (없으면 빈칸)
//   타일 목록: 행에서 쓰는 블록 글자의 뜻. 쉼표로 구분하고 순서대로 A, B, D, E, ... 글자가 배정된다.
//     <디자인 번호>[p<위치 0-2>][r<회전 0-3>][m<방향 0 왼쪽 · 1 오른쪽>]  (예: 3p0r1)
//     ~<길이>  밧줄 (예: ~5)
//     c<이름>  이름 붙은 체크포인트 (이름은 encodeURIComponent)
//   원점: 맨 위 행 맨 왼쪽 칸의 좌표 (음수 가능)
//   행들: '/'로 구분. 칸마다 한 글자, 앞에 숫자가 붙으면 그만큼 반복 (예: 12. = 빈칸 12개)
//     '.' 빈칸 · 'S' 스타트(정확히 1개) · 'C' 이름 없는 체크포인트 · '*' 별 · 그 외는 타일 목록의 글자
//   구역 행들: 행들과 같은 방식. '.' 없음 · 'Y' 노란 구역 · 'P' 보라 구역 · 'W' 물
//
// 이전 형식 PAR4(설정·투명 픽셀 없음), PAR3(태그·코드·체크포인트 이름 없음), PAR2, PAR1도 읽을 수 있다.

const TILE_SIZE = 32;
const VIEW_W = 960; // 화면(캔버스) 크기
const VIEW_H = 540;

const START = Object.freeze({ kind: 'start' });
const CHECKPOINT = Object.freeze({ kind: 'checkpoint' });
const STAR = Object.freeze({ kind: 'star' });
const SPECIAL_TILES = { start: START, checkpoint: CHECKPOINT, star: STAR };

const ZoneTypes = {
  double: { code: 'Y', label: '노란 구역', desc: '안에서 2단 점프', color: 'rgba(255, 214, 0, 0.3)' },
  infinite: { code: 'P', label: '보라 구역', desc: '안에서 무한 점프', color: 'rgba(170, 80, 255, 0.3)' },
  water: { code: 'W', label: '물', desc: '천천히 가라앉고 계속 점프', color: 'rgba(40, 140, 255, 0.38)' },
};

const MAX_ROPE_LENGTH = 1000;

// 블록 타일. 종류에 맞는 속성만 쓰고 나머지는 기본값으로 둔다.
//   pos: 단일 가시 위치 (0 왼쪽, 1 가운데, 2 오른쪽) · rot: 가시 회전 (0~3, 시계 방향 90도씩)
//   dir: 머신 방향 (0 왼쪽, 1 오른쪽)
function designTile(design, { pos = 1, rot = 0, dir = 1 } = {}) {
  const t = DesignTypes[design.type];
  return {
    kind: 'design',
    design,
    pos: t.positioned ? pos : 1,
    rot: t.rotatable ? rot : 0,
    dir: t.directional ? dir : 1,
  };
}

function ropeTile(length) {
  return { kind: 'rope', length };
}

function checkpointTile(name = '') {
  return name ? { kind: 'checkpoint', name } : CHECKPOINT;
}

function sameTile(a, b) {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'rope') return a.length === b.length;
  if (a.kind === 'checkpoint') return (a.name || '') === (b.name || '');
  return a.kind === 'design' && a.design === b.design && a.pos === b.pos && a.rot === b.rot && a.dir === b.dir;
}

const cellKey = (x, y) => `${x},${y}`;

class GameMap {
  constructor(designs = [], background = DEFAULT_BACKGROUND) {
    this.designs = []; // 이 맵에서 쓰는 블록 디자인 (팔레트 순서)
    this.background = background;
    this.cells = new Map(); // "x,y" → { x, y, tile }
    this.zones = new Map(); // "x,y" → { x, y, zone }
    this.start = null; // { x, y }
    this.version = 0; // 바뀔 때마다 증가 (캐시 갱신용)
    this.cache = {};
    for (const d of designs) this.addDesign(d);
  }

  changed() {
    this.version++;
    this.cache = {};
  }

  get(x, y) {
    const cell = this.cells.get(cellKey(x, y));
    return cell ? cell.tile : null;
  }

  // 스타트를 놓으면 기존 스타트는 사라진다 (항상 1개).
  set(x, y, tile) {
    if (tile.kind === 'start' && this.start) this.cells.delete(cellKey(this.start.x, this.start.y));
    if (this.get(x, y)?.kind === 'start') this.start = null;
    this.cells.set(cellKey(x, y), { x, y, tile });
    if (tile.kind === 'start') this.start = { x, y };
    this.changed();
  }

  remove(x, y) {
    if (this.get(x, y)?.kind === 'start') this.start = null;
    this.cells.delete(cellKey(x, y));
    this.changed();
  }

  zone(x, y) {
    const cell = this.zones.get(cellKey(x, y));
    return cell ? cell.zone : null;
  }

  setZone(x, y, zone) {
    this.zones.set(cellKey(x, y), { x, y, zone });
    this.changed();
  }

  removeZone(x, y) {
    this.zones.delete(cellKey(x, y));
    this.changed();
  }

  designType(x, y) {
    const tile = this.get(x, y);
    return tile && tile.kind === 'design' ? tile.design.type : null;
  }

  isSolid(x, y) {
    const type = this.designType(x, y);
    return !!type && !!DesignTypes[type].solid;
  }

  // 타일과 구역 전체를 감싸는 범위
  bounds() {
    if (!this.cache.bounds) {
      const b = layerBounds(this.cells.values());
      const z = layerBounds(this.zones.values());
      this.cache.bounds = !b ? z || { minX: 0, minY: 0, maxX: 0, maxY: 0 } : !z ? b : {
        minX: Math.min(b.minX, z.minX), minY: Math.min(b.minY, z.minY),
        maxX: Math.max(b.maxX, z.maxX), maxY: Math.max(b.maxY, z.maxY),
      };
    }
    return this.cache.bounds;
  }

  // 해당 종류 타일의 좌표 목록 (왼쪽 → 오른쪽, 위 → 아래 순). 밧줄은 tile도 함께.
  positions(kind) {
    const key = 'pos:' + kind;
    if (!this.cache[key]) {
      const list = [];
      for (const { x, y, tile } of this.cells.values()) if (tile.kind === kind) list.push({ x, y, tile });
      this.cache[key] = list.sort((a, b) => a.x - b.x || a.y - b.y);
    }
    return this.cache[key];
  }

  nextTag() {
    return this.designs.reduce((max, d) => Math.max(max, d.tag), 0) + 1;
  }

  findDesign(tag) {
    return this.designs.find((d) => d.tag === tag) || null;
  }

  // 디자인을 팔레트에 넣는다. 태그가 없거나 이미 쓰는 태그면 새 태그를 붙인다.
  addDesign(design, index = this.designs.length) {
    if (!design.tag || this.findDesign(design.tag)) design.tag = this.nextTag();
    this.designs.splice(index, 0, design);
    this.changed();
    return design;
  }

  countUses(design) {
    let n = 0;
    for (const { tile } of this.cells.values()) if (tile.design === design) n++;
    return n;
  }

  // 디자인을 지우면 그 디자인으로 놓은 블록도 함께 지운다.
  removeDesign(design) {
    for (const [key, { tile }] of this.cells) if (tile.design === design) this.cells.delete(key);
    this.designs = this.designs.filter((d) => d !== design);
    this.changed();
  }

  // 디자인까지 복사한 독립 사본
  clone() {
    const copies = new Map(this.designs.map((d) => [d, d.clone()]));
    const map = new GameMap([...copies.values()], { ...this.background });
    for (const { x, y, tile } of this.cells.values()) {
      map.set(x, y, tile.kind === 'design' ? { ...tile, design: copies.get(tile.design) } : tile);
    }
    for (const { x, y, zone } of this.zones.values()) map.setZone(x, y, zone);
    return map;
  }
}

function layerBounds(cells) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { x, y } of cells) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

// ---- 문자열 변환 ----

const TILE_CODE_LETTERS = 'ABDEFGHIJKLMNOPQRTUVWXYZabcdefghijklmnopqrstuvwxyz';
const COLOR_INDEX = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
const MAX_RUN = 100000;

// 코드·이름을 맵 문자열에 넣을 때: 구분 기호(; , / :)와 따옴표(')까지 감싼다 (worlds.js에 '...'로 붙여넣어도 안전)
const encodeText = (text) => encodeURIComponent(text).replace(/'/g, '%27');

// 블록 글자: 영문자를 다 쓰면 À(U+00C0)부터 이어서 쓴다.
function tileCodeChar(i) {
  return i < TILE_CODE_LETTERS.length
    ? TILE_CODE_LETTERS[i]
    : String.fromCharCode(0xc0 + i - TILE_CODE_LETTERS.length);
}

function encodeDesign(design) {
  const colors = [];
  const index = new Map();
  const pixels = design.pixels.map((color) => {
    if (!color) return '.';
    if (color === CLEAR) return '~';
    if (!index.has(color)) {
      index.set(color, colors.length);
      colors.push(color.slice(1));
    }
    return COLOR_INDEX[index.get(color)];
  });
  const flags = design.keep ? 'k' : '';
  return [DesignTypes[design.type].code + colors.join('+'), pixels.join(''), design.tag, flags, encodeText(design.code || '')].join(':');
}

// version: PAR5 (태그·설정·코드) · PAR4 (태그·코드) · 그 이전 (픽셀만)
function decodeDesign(entry, n, version) {
  const type = DESIGN_TYPE_ORDER.find((t) => DesignTypes[t].code === entry[0]);
  if (!type) throw new Error(`${n}번째 디자인의 종류 '${entry[0]}'를 알 수 없습니다.`);
  const fields = entry.split(':');
  const ok = version === 'PAR5' ? fields.length === 5 : version === 'PAR4' ? fields.length === 3 || fields.length === 4 : fields.length === 2;
  if (!ok) throw new Error(`${n}번째 디자인의 형식이 올바르지 않습니다.`);
  const [head, pixelPart, tagPart] = fields;
  const flagPart = version === 'PAR5' ? fields[3] : '';
  const codePart = version === 'PAR5' ? fields[4] : fields[3];
  const colorPart = head.slice(1);
  const colors = colorPart ? colorPart.split('+') : [];
  for (const c of colors) {
    if (!/^[0-9a-fA-F]{6}$/.test(c)) throw new Error(`${n}번째 디자인의 색 '${c}'가 올바르지 않습니다.`);
  }
  if (pixelPart.length !== DESIGN_SIZE * DESIGN_SIZE) {
    throw new Error(`${n}번째 디자인의 픽셀은 ${DESIGN_SIZE * DESIGN_SIZE}자여야 합니다. (현재 ${pixelPart.length}자)`);
  }
  const pixels = [...pixelPart].map((ch) => {
    if (ch === '.') return null;
    if (ch === '~' && version === 'PAR5') return CLEAR;
    const i = COLOR_INDEX.indexOf(ch);
    if (i < 0 || i >= colors.length) throw new Error(`${n}번째 디자인에 없는 색 번호 '${ch}'가 있습니다.`);
    return '#' + colors[i].toLowerCase();
  });
  if (version !== 'PAR4' && version !== 'PAR5') return new Design(type, pixels);
  const tag = Number(tagPart);
  if (!Number.isInteger(tag) || tag < 1) throw new Error(`${n}번째 디자인의 블록 태그 '${tagPart}'가 올바르지 않습니다.`);
  let code = '';
  try {
    code = codePart ? decodeURIComponent(codePart) : '';
  } catch {
    throw new Error(`${n}번째 디자인의 코드가 깨졌습니다.`);
  }
  return new Design(type, pixels, { tag, code, keep: flagPart.includes('k') });
}

function decodeDesigns(part, version) {
  const designs = part ? part.split(',').map((e, i) => decodeDesign(e, i + 1, version)) : [];
  const seen = new Set();
  for (const d of designs) {
    if (d.tag && seen.has(d.tag)) throw new Error(`블록 태그 ${d.tag}이(가) 두 번 쓰였습니다.`);
    seen.add(d.tag);
  }
  return designs;
}

function encodeBackground(bg) {
  if (bg.type === 'solid') return 's' + bg.color.slice(1);
  if (bg.type === 'gradient') return `g${bg.from.slice(1)}+${bg.to.slice(1)}+${bg.dir}`;
  return 'p' + bg.id;
}

function decodeBackground(str) {
  let m = /^p([0-2])$/.exec(str);
  if (m) return { type: 'preset', id: Number(m[1]) };
  m = /^s([0-9a-fA-F]{6})$/.exec(str);
  if (m) return { type: 'solid', color: '#' + m[1].toLowerCase() };
  m = /^g([0-9a-fA-F]{6})\+([0-9a-fA-F]{6})\+([vhdu])$/.exec(str);
  if (m) return { type: 'gradient', from: '#' + m[1].toLowerCase(), to: '#' + m[2].toLowerCase(), dir: m[3] };
  throw new Error(`배경 '${str}'를 알 수 없습니다.`);
}

function tileSpec(tile, designIndex) {
  if (tile.kind === 'rope') return '~' + tile.length;
  if (tile.kind === 'checkpoint') return 'c' + encodeText(tile.name);
  const t = DesignTypes[tile.design.type];
  let spec = String(designIndex.get(tile.design));
  if (t.positioned) spec += 'p' + tile.pos;
  if (t.rotatable) spec += 'r' + tile.rot;
  if (t.directional) spec += 'm' + tile.dir;
  return spec;
}

function parseTileSpec(spec, designs, n) {
  if (spec[0] === 'c') {
    try {
      return checkpointTile(decodeURIComponent(spec.slice(1)));
    } catch {
      throw new Error(`타일 목록 ${n}번째의 체크포인트 이름이 깨졌습니다.`);
    }
  }
  let m = /^~(\d+)$/.exec(spec);
  if (m) {
    const length = Number(m[1]);
    if (length < 1 || length > MAX_ROPE_LENGTH) throw new Error(`밧줄 길이 ${length}이(가) 올바르지 않습니다.`);
    return ropeTile(length);
  }
  m = /^(\d+)(?:p([0-2]))?(?:r([0-3]))?(?:m([01]))?$/.exec(spec);
  if (!m) throw new Error(`타일 목록 ${n}번째 '${spec}'를 알 수 없습니다.`);
  const design = designs[Number(m[1])];
  if (!design) throw new Error(`타일 목록 ${n}번째가 없는 디자인 ${m[1]}번을 가리킵니다.`);
  const num = (v, def) => (v === undefined ? def : Number(v));
  return designTile(design, { pos: num(m[2], 1), rot: num(m[3], 0), dir: num(m[4], 1) });
}

// 한 겹(타일 또는 구역)을 원점 + 런 길이 압축 행들로. 글자는 행 순서대로 codeOf가 정한다.
function encodeLayer(cells, codeOf) {
  const b = layerBounds(cells.values());
  if (!b) return { origin: '0,0', rows: '' };
  const byRow = new Map();
  for (const cell of cells.values()) {
    if (!byRow.has(cell.y)) byRow.set(cell.y, []);
    byRow.get(cell.y).push(cell);
  }
  const rows = [];
  for (let y = b.minY; y <= b.maxY; y++) {
    let row = '';
    let run = null;
    let count = 0;
    const push = (code, n) => {
      if (code === run) {
        count += n;
        return;
      }
      if (count) row += (count > 1 ? count : '') + run;
      run = code;
      count = n;
    };
    let cursor = b.minX;
    for (const cell of (byRow.get(y) || []).sort((p, q) => p.x - q.x)) {
      if (cell.x > cursor) push('.', cell.x - cursor);
      push(codeOf(cell), 1);
      cursor = cell.x + 1;
    }
    push(null, 0); // 남은 런 내보내기 (줄 끝 빈칸은 생략됨)
    rows.push(row);
  }
  return { origin: `${b.minX},${b.minY}`, rows: rows.join('/') };
}

// encodeLayer의 반대. 칸마다 put(x, y, 글자) 호출.
function decodeLayer(originPart, rowPart, what, put) {
  const origin = originPart.split(',').map(Number);
  if (origin.length !== 2 || !origin.every(Number.isInteger)) throw new Error(`${what} 원점 좌표가 올바르지 않습니다.`);
  const [ox, oy] = origin;
  rowPart.split('/').forEach((row, r) => {
    const y = oy + r;
    let x = ox;
    let digits = '';
    for (const ch of row) {
      if (ch >= '0' && ch <= '9') {
        digits += ch;
        continue;
      }
      const n = digits ? Number(digits) : 1;
      digits = '';
      if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${what} ${r + 1}번째 행의 반복 횟수 ${n}이(가) 올바르지 않습니다.`);
      if (ch === '.') {
        x += n; // 빈칸은 건너뛰기만 하므로 개수 제한 없음 (무한 맵)
        continue;
      }
      if (n > MAX_RUN) throw new Error(`${what} ${r + 1}번째 행의 반복 횟수 ${n}이(가) 너무 큽니다.`);
      for (let k = 0; k < n; k++) put(x++, y, ch, r);
    }
    if (digits) throw new Error(`${what} ${r + 1}번째 행이 숫자로 끝납니다.`);
  });
}

const MapCodec = {
  PREFIX: 'PAR5',

  encode(map) {
    const designIndex = new Map(map.designs.map((d, i) => [d, i]));
    const legend = [];
    const codeOfSpec = new Map();
    const tiles = encodeLayer(map.cells, ({ tile }) => {
      if (tile.kind === 'start') return 'S';
      if (tile.kind === 'checkpoint' && !tile.name) return 'C';
      if (tile.kind === 'star') return '*';
      const spec = tileSpec(tile, designIndex);
      if (!codeOfSpec.has(spec)) {
        codeOfSpec.set(spec, tileCodeChar(legend.length));
        legend.push(spec);
      }
      return codeOfSpec.get(spec);
    });
    const zones = encodeLayer(map.zones, ({ zone }) => ZoneTypes[zone].code);
    return [
      this.PREFIX, encodeBackground(map.background), map.designs.map(encodeDesign).join(','), legend.join(','),
      tiles.origin, tiles.rows, zones.origin, zones.rows,
    ].join(';');
  },

  // 잘못된 문자열이면 사유를 담은 Error를 던진다.
  decode(str) {
    str = String(str).trim();
    if (str.startsWith('PAR1:')) return decodePar1(str);
    if (str.startsWith('PAR2;')) return decodePar2(str);

    const parts = str.split(';');
    if (!['PAR3', 'PAR4', 'PAR5'].includes(parts[0]) || parts.length !== 8) {
      throw new Error(`맵 문자열은 "${this.PREFIX};"로 시작하고 ';'로 나뉜 8부분이어야 합니다.`);
    }
    const [version, bgPart, designPart, legendPart, originPart, rowPart, zoneOriginPart, zoneRowPart] = parts;

    const designs = decodeDesigns(designPart, version);
    const map = new GameMap(designs, decodeBackground(bgPart));

    const tileOf = new Map([['S', START], ['C', CHECKPOINT], ['*', STAR]]);
    (legendPart ? legendPart.split(',') : []).forEach((spec, i) => {
      tileOf.set(tileCodeChar(i), parseTileSpec(spec, designs, i + 1));
    });

    let starts = 0;
    decodeLayer(originPart, rowPart, '타일', (x, y, ch, r) => {
      const tile = tileOf.get(ch);
      if (!tile) throw new Error(`${r + 1}번째 행에 알 수 없는 타일 '${ch}'가 있습니다.`);
      if (tile === START) starts++;
      map.set(x, y, tile);
    });

    const zoneOf = new Map(Object.entries(ZoneTypes).map(([name, z]) => [z.code, name]));
    decodeLayer(zoneOriginPart, zoneRowPart, '구역', (x, y, ch, r) => {
      const zone = zoneOf.get(ch);
      if (!zone) throw new Error(`구역 ${r + 1}번째 행에 알 수 없는 구역 '${ch}'가 있습니다.`);
      map.setZone(x, y, zone);
    });

    if (starts !== 1) throw new Error(`스타트는 정확히 1개여야 합니다. (현재 ${starts}개)`);
    return map;
  },
};

// 이전 형식 PAR2: 타일 목록 없이 디자인 순서대로 글자 배정 (단일 가시는 위치별 3글자)
function decodePar2(str) {
  const parts = str.split(';');
  if (parts.length !== 4) throw new Error('PAR2 맵 문자열은 ;로 나뉜 4부분이어야 합니다.');
  const [, designPart, originPart, rowPart] = parts;
  const designs = decodeDesigns(designPart, 'PAR2');
  const tileOf = new Map([['S', START], ['C', CHECKPOINT], ['*', STAR]]);
  let i = 0;
  for (const design of designs) {
    for (const pos of design.type === 'spike1' ? [0, 1, 2] : [1]) tileOf.set(tileCodeChar(i++), designTile(design, { pos }));
  }
  const map = new GameMap(designs);
  let starts = 0;
  decodeLayer(originPart, rowPart, '타일', (x, y, ch, r) => {
    const tile = tileOf.get(ch);
    if (!tile) throw new Error(`${r + 1}번째 행에 알 수 없는 타일 '${ch}'가 있습니다.`);
    if (tile === START) starts++;
    map.set(x, y, tile);
  });
  if (starts !== 1) throw new Error(`스타트는 정확히 1개여야 합니다. (현재 ${starts}개)`);
  return map;
}

// 가장 처음 형식 PAR1: '.', '#', 'S'만 있는 고정 크기 맵.
// 위에 블록이 없는 '#'은 잔디 블록, 있으면 흙 블록이 된다.
function decodePar1(str) {
  const lines = str.slice('PAR1:'.length).split('/');
  const designs = defaultDesigns();
  const [grass, dirt] = designs.filter((d) => d.type === 'block');
  const map = new GameMap(designs);
  let starts = 0;
  lines.forEach((line, y) => {
    [...line].forEach((ch, x) => {
      if (ch === '#') map.set(x, y, designTile(lines[y - 1]?.[x] === '#' ? dirt : grass));
      else if (ch === 'S') {
        starts++;
        map.set(x, y, START);
      } else if (ch !== '.') throw new Error(`알 수 없는 타일 '${ch}' (${x}, ${y})`);
    });
  });
  if (starts !== 1) throw new Error(`스타트는 정확히 1개여야 합니다. (현재 ${starts}개)`);
  return map;
}

// 브라우저 localStorage에 월드별로 저장한다. 저장소를 못 쓰는 환경이면 실패를 반환.
const MapStore = {
  key(worldId) {
    return `par.world${worldId}.map`;
  },

  load(worldId) {
    try {
      const str = localStorage.getItem(this.key(worldId));
      return str ? MapCodec.decode(str) : null;
    } catch (err) {
      console.warn('저장된 맵을 불러오지 못했습니다:', err);
      return null;
    }
  },

  save(worldId, map) {
    try {
      localStorage.setItem(this.key(worldId), MapCodec.encode(map));
      return true;
    } catch (err) {
      console.warn('맵 저장 실패:', err);
      return false;
    }
  },
};
