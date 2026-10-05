// 맵 데이터(무한 크기), 문자열 직렬화, 저장소.
//
// 맵 문자열 형식 (하나의 문자열):
//   PAR2;<디자인들>;<원점x>,<원점y>;<행들>
//
//   디자인들: 쉼표로 구분. 각 디자인 = <종류><색들>:<픽셀 64자>
//     종류: B 일반 블록 · D 빈칸(장식) · T 가시 · U 단일 가시 · K 큰 가시
//     색들: 16진 색상을 '+'로 연결 (예: 7bd67f+4caf50)
//     픽셀: 위 행부터 8x8, '.'은 투명, 나머지는 색 번호(0-9a-zA-Z-_)
//   원점: 맨 위 행 맨 왼쪽 칸의 좌표 (음수 가능)
//   행들: '/'로 구분. 칸마다 한 글자, 앞에 숫자가 붙으면 그만큼 반복 (예: 12. = 빈칸 12개)
//     '.' 빈칸 · 'S' 스타트(정확히 1개) · 'C' 체크포인트 · '*' 별
//     그 외 글자는 디자인 블록: 디자인 순서대로 A, B, D, E, ...가 배정되고
//     단일 가시 디자인은 위치(왼쪽·가운데·오른쪽)별로 글자 3개를 차지한다.

const TILE_SIZE = 32;

const START = Object.freeze({ kind: 'start' });
const CHECKPOINT = Object.freeze({ kind: 'checkpoint' });
const STAR = Object.freeze({ kind: 'star' });
const SPECIAL_TILES = { start: START, checkpoint: CHECKPOINT, star: STAR };

// pos: 단일 가시의 위치 (0 왼쪽, 1 가운데, 2 오른쪽). 다른 종류는 항상 1.
function designTile(design, pos = 1) {
  return { kind: 'design', design, pos: design.type === 'spike1' ? pos : 1 };
}

function sameTile(a, b) {
  if (a === b) return true;
  return !!a && !!b && a.kind === 'design' && b.kind === 'design' && a.design === b.design && a.pos === b.pos;
}

const cellKey = (x, y) => `${x},${y}`;

class GameMap {
  constructor(designs = []) {
    this.designs = designs; // 이 맵에서 쓰는 블록 디자인 (팔레트 순서)
    this.cells = new Map(); // "x,y" → { x, y, tile }
    this.start = null; // { x, y }
    this.boundsCache = null;
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
    this.boundsCache = null;
  }

  remove(x, y) {
    if (this.get(x, y)?.kind === 'start') this.start = null;
    this.cells.delete(cellKey(x, y));
    this.boundsCache = null;
  }

  isSolid(x, y) {
    const tile = this.get(x, y);
    return !!tile && tile.kind === 'design' && !!DesignTypes[tile.design.type].solid;
  }

  // 무언가 놓인 칸들을 감싸는 범위
  bounds() {
    if (!this.boundsCache) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const { x, y } of this.cells.values()) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      this.boundsCache = minX === Infinity ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY };
    }
    return this.boundsCache;
  }

  // 해당 종류 타일의 좌표 목록 (왼쪽 → 오른쪽, 위 → 아래 순)
  positions(kind) {
    const list = [];
    for (const { x, y, tile } of this.cells.values()) if (tile.kind === kind) list.push({ x, y });
    return list.sort((a, b) => a.x - b.x || a.y - b.y);
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
    this.boundsCache = null;
  }

  // 디자인까지 복사한 독립 사본
  clone() {
    const copies = new Map(this.designs.map((d) => [d, d.clone()]));
    const map = new GameMap([...copies.values()]);
    for (const { x, y, tile } of this.cells.values()) {
      map.set(x, y, tile.kind === 'design' ? designTile(copies.get(tile.design), tile.pos) : tile);
    }
    return map;
  }
}

const TILE_CODE_LETTERS = 'ABDEFGHIJKLMNOPQRTUVWXYZabcdefghijklmnopqrstuvwxyz';
const COLOR_INDEX = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
const MAX_RUN = 100000;

// 디자인 블록 글자: 영문자를 다 쓰면 À(U+00C0)부터 이어서 쓴다.
function tileCodeChar(i) {
  return i < TILE_CODE_LETTERS.length
    ? TILE_CODE_LETTERS[i]
    : String.fromCharCode(0xc0 + i - TILE_CODE_LETTERS.length);
}

// 디자인 순서대로 글자 배정. 반환: [{ code, design, pos }]
function assignTileCodes(designs) {
  const list = [];
  for (const design of designs) {
    const positions = design.type === 'spike1' ? [0, 1, 2] : [1];
    for (const pos of positions) list.push({ code: tileCodeChar(list.length), design, pos });
  }
  return list;
}

function encodeDesign(design) {
  const colors = [];
  const index = new Map();
  const pixels = design.pixels.map((color) => {
    if (!color) return '.';
    if (!index.has(color)) {
      index.set(color, colors.length);
      colors.push(color.slice(1));
    }
    return COLOR_INDEX[index.get(color)];
  });
  return DesignTypes[design.type].code + colors.join('+') + ':' + pixels.join('');
}

function decodeDesign(entry, n) {
  const type = DESIGN_TYPE_ORDER.find((t) => DesignTypes[t].code === entry[0]);
  if (!type) throw new Error(`${n}번째 디자인의 종류 '${entry[0]}'를 알 수 없습니다.`);
  const sep = entry.indexOf(':');
  if (sep < 0) throw new Error(`${n}번째 디자인에 ':'가 없습니다.`);
  const colorPart = entry.slice(1, sep);
  const colors = colorPart ? colorPart.split('+') : [];
  for (const c of colors) {
    if (!/^[0-9a-fA-F]{6}$/.test(c)) throw new Error(`${n}번째 디자인의 색 '${c}'가 올바르지 않습니다.`);
  }
  const pixelPart = entry.slice(sep + 1);
  if (pixelPart.length !== DESIGN_SIZE * DESIGN_SIZE) {
    throw new Error(`${n}번째 디자인의 픽셀은 ${DESIGN_SIZE * DESIGN_SIZE}자여야 합니다. (현재 ${pixelPart.length}자)`);
  }
  const pixels = [...pixelPart].map((ch) => {
    if (ch === '.') return null;
    const i = COLOR_INDEX.indexOf(ch);
    if (i < 0 || i >= colors.length) throw new Error(`${n}번째 디자인에 없는 색 번호 '${ch}'가 있습니다.`);
    return '#' + colors[i].toLowerCase();
  });
  return new Design(type, pixels);
}

const MapCodec = {
  PREFIX: 'PAR2',

  encode(map) {
    const codes = assignTileCodes(map.designs);
    const codeOf = (tile) => {
      if (tile.kind === 'start') return 'S';
      if (tile.kind === 'checkpoint') return 'C';
      if (tile.kind === 'star') return '*';
      return codes.find((c) => c.design === tile.design && c.pos === tile.pos).code;
    };

    const b = map.bounds();
    const byRow = new Map();
    for (const { x, y, tile } of map.cells.values()) {
      if (!byRow.has(y)) byRow.set(y, []);
      byRow.get(y).push([x, codeOf(tile)]);
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
      for (const [x, code] of (byRow.get(y) || []).sort((p, q) => p[0] - q[0])) {
        if (x > cursor) push('.', x - cursor);
        push(code, 1);
        cursor = x + 1;
      }
      push(null, 0); // 남은 런 내보내기 (줄 끝 빈칸은 생략됨)
      rows.push(row);
    }

    return [this.PREFIX, map.designs.map(encodeDesign).join(','), `${b.minX},${b.minY}`, rows.join('/')].join(';');
  },

  // 잘못된 문자열이면 사유를 담은 Error를 던진다.
  decode(str) {
    str = String(str).trim();
    if (str.startsWith('PAR1:')) return decodeLegacyMap(str);

    const parts = str.split(';');
    if (parts[0] !== this.PREFIX || parts.length !== 4) {
      throw new Error(`맵 문자열은 "${this.PREFIX};"로 시작하고 ';'로 나뉜 4부분이어야 합니다.`);
    }
    const [, designPart, originPart, rowPart] = parts;

    const designs = designPart ? designPart.split(',').map((e, i) => decodeDesign(e, i + 1)) : [];
    const origin = originPart.split(',').map(Number);
    if (origin.length !== 2 || !origin.every(Number.isInteger)) throw new Error('원점 좌표가 올바르지 않습니다.');
    const [ox, oy] = origin;

    const tileOf = new Map([['S', START], ['C', CHECKPOINT], ['*', STAR]]);
    for (const { code, design, pos } of assignTileCodes(designs)) tileOf.set(code, designTile(design, pos));

    const map = new GameMap(designs);
    let starts = 0;
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
        if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${r + 1}번째 행의 반복 횟수 ${n}이(가) 올바르지 않습니다.`);
        if (ch === '.') {
          x += n; // 빈칸은 건너뛰기만 하므로 개수 제한 없음 (무한 맵)
          continue;
        }
        if (n > MAX_RUN) throw new Error(`${r + 1}번째 행의 블록 반복 횟수 ${n}이(가) 너무 큽니다.`);
        const tile = tileOf.get(ch);
        if (!tile) throw new Error(`${r + 1}번째 행에 알 수 없는 타일 '${ch}'가 있습니다.`);
        for (let k = 0; k < n; k++) {
          if (tile === START) starts++;
          map.set(x++, y, tile);
        }
      }
      if (digits) throw new Error(`${r + 1}번째 행이 숫자로 끝납니다.`);
    });

    if (starts !== 1) throw new Error(`스타트는 정확히 1개여야 합니다. (현재 ${starts}개)`);
    return map;
  },
};

// 이전 형식(PAR1: '.', '#', 'S'만 있는 고정 크기 맵)을 기본 디자인으로 변환.
// 위에 블록이 없는 '#'은 잔디 블록, 있으면 흙 블록이 된다.
function decodeLegacyMap(str) {
  const lines = str.slice('PAR1:'.length).split('/');
  const designs = defaultDesigns();
  const grass = designs.find((d) => d.type === 'block');
  const dirt = designs.filter((d) => d.type === 'block')[1] || grass;
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
