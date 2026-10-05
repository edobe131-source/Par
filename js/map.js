// 맵 데이터, 문자열 직렬화, 저장소.
//
// 맵 문자열 형식: "PAR1:" + 각 행을 '/'로 이어 붙인 것 (위쪽 행부터)
//   '.' 빈칸   '#' 일반 블록   'S' 스타트 (맵 전체에 정확히 1개)
//   예) PAR1:....../..S.../######

const TILE_SIZE = 32;

const Tile = Object.freeze({
  EMPTY: '.',
  BLOCK: '#',
  START: 'S',
});

const SOLID_TILES = new Set([Tile.BLOCK]);
const KNOWN_TILES = new Set(Object.values(Tile));

class GameMap {
  constructor(rows) {
    this.rows = rows; // rows[y][x] = 타일 문자
    this.height = rows.length;
    this.width = rows[0].length;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x, y) {
    return this.inBounds(x, y) ? this.rows[y][x] : null;
  }

  set(x, y, tile) {
    if (this.inBounds(x, y)) this.rows[y][x] = tile;
  }

  // 좌우 바깥은 벽, 위쪽 바깥은 열린 하늘, 아래쪽 바깥은 낭떠러지.
  isSolid(x, y) {
    if (x < 0 || x >= this.width) return true;
    if (y < 0 || y >= this.height) return false;
    return SOLID_TILES.has(this.rows[y][x]);
  }

  findStart() {
    for (let y = 0; y < this.height; y++) {
      const x = this.rows[y].indexOf(Tile.START);
      if (x !== -1) return { x, y };
    }
    return null;
  }

  clone() {
    return new GameMap(this.rows.map((row) => row.slice()));
  }
}

const MapCodec = {
  PREFIX: 'PAR1:',

  encode(map) {
    return this.PREFIX + map.rows.map((row) => row.join('')).join('/');
  },

  // 잘못된 문자열이면 사유를 담은 Error를 던진다.
  decode(str) {
    str = String(str).trim();
    if (!str.startsWith(this.PREFIX)) {
      throw new Error(`맵 문자열은 "${this.PREFIX}"로 시작해야 합니다.`);
    }
    const lines = str.slice(this.PREFIX.length).split('/');
    const width = lines[0].length;
    if (width === 0) throw new Error('맵이 비어 있습니다.');

    let starts = 0;
    const rows = lines.map((line, y) => {
      if (line.length !== width) {
        throw new Error(`${y + 1}번째 행의 길이(${line.length})가 첫 행(${width})과 다릅니다.`);
      }
      const row = line.split('');
      row.forEach((ch, x) => {
        if (!KNOWN_TILES.has(ch)) throw new Error(`알 수 없는 타일 '${ch}' (${x}, ${y})`);
        if (ch === Tile.START) starts++;
      });
      return row;
    });

    if (starts !== 1) throw new Error(`스타트는 정확히 1개여야 합니다. (현재 ${starts}개)`);
    return new GameMap(rows);
  },
};

// 브라우저 localStorage에 월드별로 저장한다. 저장소를 못 쓰는 환경이면 조용히 실패를 반환.
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
