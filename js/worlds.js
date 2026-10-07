// 기본 월드 목록. 개발자가 게임 안에서 추가·수정한 월드는 브라우저에 저장된다 (WorldStore).
// 월드 선택 화면의 'worlds.js로 내보내기'로 만든 내용을 여기에 붙여넣으면 모든 사람에게 그대로 보인다.
//   name: 이름 · stars: 열리는 데 필요한 별 (모든 월드에서 모은 별 합계)
//   defaultMap: 저장된 맵이 없을 때 쓰는 기본 맵 (형식은 map.js 참고)

const WORLDS = [
  {
    id: 1,
    name: '월드 1',
    stars: 0,
    defaultMap: 'PAR5;p0;B7bd67f+4caf50+9a6640+7e5032:0000000010110110212212212223222223222223222223223222222222232222:1::,B9a6640+7e5032:0001000001000001000001001000000000010000000000100100000000001000:2::,Dff8fb1+ffd23f+4caf50:...................0......010......0..2..2.2.2....222.2..222222.:3::,Te8ebf2+a3abbd:.........................................0.01.0.0010100100101001:4::,Ue8ebf2+a3abbd:...........................................01......01.....0011..:5::,Ke8ebf2+a3abbd:...01......01.....0011....0011...000111..000111.0000111100001111:6::,Ieefaff+a6dcf2+78c2e6:0000000001111101111110111111011111101111110111111011111222222222:7::,M3d4250+ffd23f+7a8194+c4cad6+4a4f5c:0100010000100010010001000000000022222222232222322222222244444444:8::,W8b8fa3+585c6e:0000100000001000000010001111111100100000001000000010000011111111:9::,Cffffff+d6e4f0:..0000...000000.00000000000000000000000010000001.111111.........:10::,N5d6273+41454f+7fb2e5:..0000...000000.00000000000000000000000010000001.111111..2..2.2.:11::,H8a5a34+c48a52:0......0011111100......00......00......0011111100......00......0:12::,O1f9d5c+8ef0b5:..0000...011110.01....1001....1001....1001....10.011110...0000..:13::,B9fd6ff+5aa9e6+9a6640+7e5032:0000000010110110212212212223222223222223222223223222222222232222:14::%23%20%EC%A2%8C%EC%9A%B0%EB%A1%9C%20%EC%99%94%EB%8B%A4%20%EA%B0%94%EB%8B%A4%20%ED%95%98%EB%8A%94%20%EB%B0%9C%ED%8C%90%0AwT%3A%0A%20%20%20%20until%20cooX()%20%3E%3D%20241%3A%0A%20%20%20%20%20%20%20%20move(0.04%2C%200)%0A%20%20%20%20wait(0.5)%0A%20%20%20%20until%20cooX()%20%3C%3D%20235%3A%0A%20%20%20%20%20%20%20%20move(-0.04%2C%200)%0A%20%20%20%20wait(0.5),Bf0b0d0+d97aa8+9a6640+7e5032:0000000010110110212212212223222223222223222223223222222222232222:15::%23%20%EC%9C%84%EC%97%90%EC%84%9C%20%EC%A0%90%ED%94%84%ED%95%98%EB%A9%B4%20%EC%9E%A0%EA%B9%90%20%EC%82%AC%EB%9D%BC%EC%A7%90%0AwT%3A%0A%20%20%20%20if%20jump%3A%0A%20%20%20%20%20%20%20%20wait(0.2)%0A%20%20%20%20%20%20%20%20disapp()%0A%20%20%20%20%20%20%20%20wait(2)%0A%20%20%20%20%20%20%20%20appear(),Bb8860b+ffd23f+7a4b00:0000000001111110011221100111121001112110011111100111211000000000:16::%23%20%EB%A8%B8%EB%A6%AC%EB%A1%9C%20%EB%B0%95%EC%9C%BC%EB%A9%B4%20%ED%9D%99%20%EB%B8%94%EB%A1%9D(%ED%83%9C%EA%B7%B8%202)%EC%9C%BC%EB%A1%9C%20%EB%B0%94%EB%80%9C%0Auntil%20headbutt%3A%0A%20%20%20%20wait(0.05)%0Aconvert(2),Ke8ebf2+a3abbd:...01......01.....0011....0011...000111..000111.0000111100001111:17::%23%20%EA%B3%84%EC%86%8D%20%EB%8F%8C%EA%B8%B0%0AwT%3A%0A%20%20%20%20rot(4);8r0,0r0,~7,11r0,1r0,10r0,12r0,5r2,15r0,16r0,3r3,13r0,14r0,2r0,3r0,5r0,4p1r0,4p0r0,4p2r0,6r0,7m1,9r0;0,1;163.*////112.*/108.A6B71.3B/108.A25.*52.D/15.*39.*16.*35.A21.E5B18.2B/14.3B37.4B13.4B33.A9.*11.E23.2F/31.*76.A21.E23.2F50.5F6.B20.*/31.B76.A14.3G4.E9.H2.H10.2F50.5I6.F40.J3.K/8.4B8.*9.BF16.4B14.2B40.A21.E23.2F60.LF/29.B2F34.2F40.A21.E23.2F60.LF17.M13.N.N.N/3.S.O6.O11.C.O.B3F4.2P8.C5.Q4.R.O4.C.2F8.TU23.C6.A21.E17.C5.2F40.C19.LF4.5O38.C/19B3.19B3.17B2.17B10V10W8BA6.3B2X17B10.21B9.5B12.41B10.3B7.12B/19F3.19F3.17F2.46F6.22F10.21F9.5F12.41F10.3F7.12F/167.F9.F/167.F9.F/167.F4.*4.F/168.9F;150,0;12.4P/12.4P/12.4P/12.4P/8Y4.4P/8Y4.4P/8Y4.4P/8Y4.4P/8Y4.4P/8Y4.4P/8Y4.4P/8Y4.4P/8Y4.4P/8Y4.4P/8Y4.4P/18.9W/18.9W/18.9W/18.9W/18.9W',
  },
];

// 개발자가 추가하거나 이름·필요한 별을 고친 월드 정보 (localStorage 'par.worlds')
const WorldStore = {
  KEY: 'par.worlds',

  read() {
    try {
      const list = JSON.parse(localStorage.getItem(this.KEY));
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  },

  write(list) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(list));
    } catch (err) {
      console.warn('월드 정보 저장 실패:', err);
    }
  },

  // 모든 월드 (번호 순). builtin: 코드(WORLDS)에 있는 월드라 지울 수 없음
  list() {
    const stored = new Map(this.read().map((w) => [w.id, w]));
    const worlds = WORLDS.map((base) => {
      const s = stored.get(base.id);
      stored.delete(base.id);
      return { ...base, stars: base.stars || 0, ...(s ? { name: s.name, stars: s.stars } : {}), builtin: true };
    });
    for (const s of stored.values()) worlds.push({ id: s.id, name: s.name, stars: s.stars || 0, builtin: false });
    return worlds.sort((a, b) => a.id - b.id);
  },

  nextId() {
    return Math.max(0, ...this.list().map((w) => w.id)) + 1;
  },

  // 추가하거나 이름·필요한 별 바꾸기
  save({ id, name, stars }) {
    const list = this.read().filter((w) => w.id !== id);
    list.push({ id, name, stars });
    this.write(list);
  },

  // 직접 추가한 월드만 지울 수 있음. 그 월드의 맵·진행 상황도 지운다.
  remove(id) {
    this.write(this.read().filter((w) => w.id !== id));
    try {
      localStorage.removeItem(MapStore.key(id));
      localStorage.removeItem(ProgressStore.key(id));
    } catch {
      // 저장소를 못 쓰면 무시
    }
  },
};

// 새로 만든 월드의 처음 맵: 스타트와 작은 땅
function blankWorldMap() {
  const designs = defaultDesigns();
  const map = new GameMap(designs);
  const [grass, dirt] = designs;
  for (let x = 0; x <= 15; x++) {
    map.set(x, 10, designTile(grass));
    map.set(x, 11, designTile(dirt));
  }
  map.set(2, 9, START);
  return map;
}

// 저장된 맵이 있으면 그것을, 없거나 깨졌으면 기본 맵(없으면 빈 맵)을 쓴다.
function loadWorldMap(world) {
  return MapStore.load(world.id) || (world.defaultMap ? MapCodec.decode(world.defaultMap) : blankWorldMap());
}

// 그 월드에서 먹은 별 / 전체 별
function worldStars(world) {
  const map = loadWorldMap(world);
  const progress = ProgressStore.load(world.id);
  const stars = map.positions('star');
  return { got: stars.filter((p) => progress.stars.has(cellKey(p.x, p.y))).length, total: stars.length };
}

// 지금 이 브라우저의 월드들(이름·필요한 별·맵)을 worlds.js에 붙여넣을 코드로
function exportWorldsCode() {
  const items = WorldStore.list().map((w) => [
    '  {',
    `    id: ${w.id},`,
    `    name: ${JSON.stringify(w.name)},`,
    `    stars: ${w.stars},`,
    `    defaultMap: '${MapCodec.encode(loadWorldMap(w))}',`,
    '  },',
  ].join('\n'));
  return `const WORLDS = [\n${items.join('\n')}\n];`;
}
