// 플레이 세션: 플레이어 물리, 특수 블록, 코드 블록, 체크포인트·별·가시, 카메라.
//
// 플레이어 상태(mode)
//   normal: 걷기·점프·낙하 (구역, 얼음, 머신, 벽, 먹구름, 공점은 이 상태에서 처리)
//   climb:  사다리 타는 중
//   cloud:  구름에 파묻히는 중 → 바닥까지 내려가면 저절로 튀어오름
//   rope:   밧줄에 매달려 흔드는 중 (점프 키를 누르고 있는 동안)
//
// 코드가 들어 있는 블록은 칸에서 빼내 "움직이는 블록"(entity)으로 다룬다.
//   좌표는 칸 단위 실수, 회전(도)·투명도·숨김·픽셀 색을 블록마다 따로 가지며 자기 코드를 돌린다.
//   단단한 블록 판정은 회전과 상관없이 칸 크기 사각형, 가시 판정은 회전한 삼각형.

const PHYS = {
  gravity: 2200,
  maxFall: 950,
  moveSpeed: 270,
  groundAccel: 2600,
  groundFriction: 2800,
  airAccel: 1700,
  airFriction: 600,
  iceAccel: 450, // 얼음 위: 느리게 붙고
  iceFriction: 120, // 잘 안 멈춤
  jumpSpeed: 760, // 최고 높이 약 4칸
  jumpCut: 0.45, // 점프 키를 일찍 떼면 상승 속도를 줄여 낮게 뜀
  coyoteTime: 0.1,
  jumpBuffer: 0.12,
  conveyorSpeed: 150, // 머신 위 자동 이동 속도
  waterGravity: 450,
  waterMaxFall: 90, // 물속에서 아주 천천히 가라앉음
  waterJump: 330,
  waterExitJump: 650, // 머리가 물 밖일 때(수면) 점프하면 물 밖으로
  darkCloudFall: 1150,
  cloudSinkTime: 0.18,
  cloudBounce: 900, // 약 5.7칸
  climbSpeed: 170,
  ropePump: 700, // 좌우 키로 흔들 때 더하는 힘
  ropeDamping: 0.7, // 아무것도 안 하면 줄어드는 정도 (초당)
  ropeMaxAngle: 1.45, // 약 83도
  ropeJump: 420, // 놓을 때 위로 더하는 힘
  ropeRegrab: 0.3, // 놓은 뒤 다시 잡기까지
};

const JUMP_KEYS = ['Space', 'ArrowUp', 'KeyW'];
const EPS = 0.001;
const FALL_DEATH_DEPTH = 10; // 맵의 가장 아래 칸보다 이만큼(칸) 더 떨어지면 사망

// noKey/yesKey에 쓰는 키 이름
const KEY_GROUPS = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'],
  jump: JUMP_KEYS, space: ['Space'],
};
Object.assign(KEY_GROUPS, {
  왼쪽: KEY_GROUPS.left, 오른쪽: KEY_GROUPS.right, 위: KEY_GROUPS.up, 아래: KEY_GROUPS.down,
  점프: KEY_GROUPS.jump, 스페이스: KEY_GROUPS.space,
});

function keyCodes(name) {
  const key = String(name);
  if (KEY_GROUPS[key] || KEY_GROUPS[key.toLowerCase()]) return KEY_GROUPS[key] || KEY_GROUPS[key.toLowerCase()];
  if (/^[a-zA-Z]$/.test(key)) return ['Key' + key.toUpperCase()];
  if (/^[0-9]$/.test(key)) return ['Digit' + key];
  throw new Error(`알 수 없는 키 '${key}' (left, right, up, down, jump, space, 알파벳 한 글자 중 하나)`);
}

const approach = (value, target, delta) =>
  value < target ? Math.min(value + delta, target) : Math.max(value - delta, target);

function boxesOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// 분리축 검사: 삼각형(꼭짓점 3개)과 축 정렬 사각형이 겹치는지
function triangleHitsBox(tri, box) {
  const corners = [
    [box.x, box.y], [box.x + box.w, box.y],
    [box.x, box.y + box.h], [box.x + box.w, box.y + box.h],
  ];
  const axes = [[1, 0], [0, 1]];
  for (let i = 0; i < 3; i++) {
    const [ax, ay] = tri[i];
    const [bx, by] = tri[(i + 1) % 3];
    axes.push([by - ay, ax - bx]);
  }
  for (const [nx, ny] of axes) {
    let tMin = Infinity, tMax = -Infinity, bMin = Infinity, bMax = -Infinity;
    for (const [x, y] of tri) {
      const d = x * nx + y * ny;
      tMin = Math.min(tMin, d);
      tMax = Math.max(tMax, d);
    }
    for (const [x, y] of corners) {
      const d = x * nx + y * ny;
      bMin = Math.min(bMin, d);
      bMax = Math.max(bMax, d);
    }
    if (tMax <= bMin || bMax <= tMin) return false;
  }
  return true;
}

// 밧줄 고정점과 길이(px)
const ropePivot = (r) => ({ x: r.x * TILE_SIZE + TILE_SIZE / 2, y: r.y * TILE_SIZE + 6 });
const ropeLength = (r) => r.length * TILE_SIZE - 8;

const isSolidType = (type) => !!type && !!DesignTypes[type].solid;
const entityBox = (e) => ({ x: e.x * TILE_SIZE, y: e.y * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE });

class PlaySession {
  // onProgress: 진행 상황이 바뀔 때 호출 (저장용). 테스트 플레이에서는 생략.
  constructor(map, progress = new Progress(), onProgress = null) {
    this.progress = progress;
    this.onProgress = onProgress;
    this.player = {
      w: 22, h: 28, x: 0, y: 0, vx: 0, vy: 0, facing: 1, mode: 'normal',
      onGround: false, groundType: null, groundDir: 1, groundEntity: null, lastGroundEntity: null,
      coyote: 0, jumpBuffer: 0, jumpCut: false, airJumps: 0,
    };
    this.cam = { x: 0, y: 0 };
    this.flash = 0; // 사망 시 화면 붉게
    this.cloud = null; // 파묻히는 중인 구름 { key | entity, startY, endY, t }
    this.cloudPress = null; // 구름 눌림 연출 { key | entity, amount }
    this.rope = null; // 매달린 밧줄 { r, d }
    this.ropeCooldown = 0;
    this.blockedKeys = new Set(); // noKey로 막힌 키
    this.scriptErrors = []; // { tag, x, y, line, message }

    const bottom = (map.bounds().maxY + 1) * TILE_SIZE;
    this.deathY = bottom + FALL_DEATH_DEPTH * TILE_SIZE;
    this.camMaxY = bottom - VIEW_H; // 맵 아래 허공은 비추지 않음

    // 코드 블록이 있으면 맵을 복사해 그 칸들을 움직이는 블록으로 옮긴다 (원래 맵은 그대로).
    this.entities = [];
    const hasCode = (tile) => tile.kind === 'design' && tile.design.code.trim();
    if ([...map.cells.values()].some((c) => hasCode(c.tile))) {
      map = map.clone();
      const programs = new Map();
      for (const { x, y, tile } of [...map.cells.values()].sort((a, b) => a.y - b.y || a.x - b.x)) {
        if (!hasCode(tile)) continue;
        map.remove(x, y);
        this.addEntity(x, y, tile, programs);
      }
    }
    this.map = map;

    // 밧줄마다 흔들림 상태
    this.ropes = map.positions('rope').map(({ x, y, tile }) => ({ x, y, length: tile.length, key: cellKey(x, y), angle: 0, omega: 0 }));
    this.starKeys = map.positions('star').map((p) => cellKey(p.x, p.y));
    // 스타트 + 체크포인트 (번호는 왼쪽부터, 이름을 붙였으면 이름)
    this.checkpointList = [
      { ...map.start, key: cellKey(map.start.x, map.start.y), label: '시작 지점', isStart: true },
      ...map.positions('checkpoint').map((p, i) => ({
        x: p.x, y: p.y, key: cellKey(p.x, p.y), label: p.tile.name || `체크포인트 ${i + 1}`,
      })),
    ];

    this.respawn();
  }

  get starTotal() {
    return this.starKeys.length;
  }

  get starCount() {
    return this.starKeys.filter((k) => this.progress.stars.has(k)).length;
  }

  isRegistered(cp) {
    return cp.isStart || this.progress.checkpoints.has(cp.key);
  }

  currentCheckpoint() {
    return this.checkpointList.find((cp) => cp.key === this.progress.current && this.isRegistered(cp))
      || this.checkpointList[0];
  }

  checkpoints() {
    const current = this.currentCheckpoint();
    return this.checkpointList.map((cp) => ({ ...cp, registered: this.isRegistered(cp), current: cp === current }));
  }

  isFalling() {
    const p = this.player;
    return p.mode === 'normal' && !p.onGround && p.vy > 0;
  }

  // 등록된 체크포인트로 이동. 떨어지는 중이면 거부.
  teleport(key) {
    const cp = this.checkpointList.find((c) => c.key === key);
    if (!cp || !this.isRegistered(cp) || this.isFalling()) return false;
    this.setCurrent(cp.key);
    this.placeAt(cp);
    return true;
  }

  respawn() {
    this.blockedKeys.clear();
    this.placeAt(this.currentCheckpoint());
  }

  die() {
    this.flash = 0.35;
    this.respawn();
  }

  // 칸 (x, y)에 서 있도록 놓는다. 좌표는 실수여도 됨.
  placeAt({ x, y }) {
    const p = this.player;
    p.x = x * TILE_SIZE + (TILE_SIZE - p.w) / 2;
    p.y = (y + 1) * TILE_SIZE - p.h;
    p.vx = p.vy = 0;
    p.mode = 'normal';
    p.onGround = false;
    p.groundEntity = p.lastGroundEntity = null;
    p.coyote = p.jumpBuffer = 0;
    p.airJumps = 0;
    this.cloud = this.rope = null;
    this.cam = this.cameraTarget();
  }

  setCurrent(key) {
    if (this.progress.current === key) return;
    this.progress.current = key;
    this.changed();
  }

  changed() {
    if (this.onProgress) this.onProgress(this.progress);
  }

  // ---- 키 (noKey로 막힌 키는 안 눌린 것으로) ----

  keyDown(...codes) {
    return Input.isDown(...codes.filter((c) => !this.blockedKeys.has(c)));
  }

  keyPressed(...codes) {
    return Input.wasPressed(...codes.filter((c) => !this.blockedKeys.has(c)));
  }

  // ---- 매 스텝 ----

  update(dt) {
    const p = this.player;
    this.flash = Math.max(0, this.flash - dt);
    this.ropeCooldown = Math.max(0, this.ropeCooldown - dt);
    if (this.cloudPress && !this.cloud) {
      this.cloudPress.amount -= dt * 5;
      if (this.cloudPress.amount <= 0) this.cloudPress = null;
    }
    // '위에서 점프'·'머리 박기'는 코드가 한 번 읽을 때까지 켜 두고, 읽은 다음 프레임에 끈다
    // (wait 중에 일어나도 놓치지 않도록)
    for (const e of this.entities) {
      for (const ev of ['jump', 'headbutt']) {
        if (e.seen[ev]) e.flags[ev] = e.seen[ev] = false;
      }
    }
    this.swingFreeRopes(dt);
    if (this.keyPressed('KeyR')) this.respawn();

    const env = this.sense();
    // 사다리에 겹쳐 있으면 ↑/W는 오르기에 쓰고 점프는 Space로만
    const jumpKeys = env.ladder && p.mode !== 'rope' ? ['Space'] : JUMP_KEYS;
    const input = {
      dir: (this.keyDown('ArrowRight', 'KeyD') ? 1 : 0) - (this.keyDown('ArrowLeft', 'KeyA') ? 1 : 0),
      up: this.keyDown('ArrowUp', 'KeyW'),
      down: this.keyDown('ArrowDown', 'KeyS'),
      jumpPressed: this.keyPressed(...jumpKeys),
      jumpHeld: this.keyDown(...jumpKeys),
    };
    if (input.dir) p.facing = input.dir;

    if (p.mode === 'rope') this.updateRope(dt, input);
    else if (p.mode === 'cloud') this.updateCloud(dt, input);
    else {
      this.updateMove(dt, input, env);
      this.tryGrabRope(input);
    }
    if (p.onGround) p.lastGroundEntity = p.groundEntity;
    else if (p.coyote <= 0) p.lastGroundEntity = null;

    if (!this.touchTiles() && p.y > this.deathY) this.die();

    this.runScripts(dt);

    const target = this.cameraTarget();
    const k = 1 - Math.exp(-dt * 10);
    this.cam.x += (target.x - this.cam.x) * k;
    this.cam.y += (target.y - this.cam.y) * k;
  }

  // ---- 블록 찾기 (칸에 고정된 블록 + 움직이는 블록) ----

  // 몸과 겹치는 보이는 움직이는 블록들
  entitiesTouching(box, test = () => true) {
    return this.entities.filter((e) => e.visible && test(e) && boxesOverlap(box, entityBox(e)));
  }

  // 점 (px, py)에 사다리가 있는지
  ladderAt(px, py) {
    const T = TILE_SIZE;
    if (this.map.designType(Math.floor(px / T), Math.floor(py / T)) === 'ladder') return true;
    return this.entities.some((e) => e.visible && e.type === 'ladder'
      && px >= e.x * T && px < (e.x + 1) * T && py >= e.y * T && py < (e.y + 1) * T);
  }

  // 플레이어 주변 상황. 움직이는 블록의 '옆면에 붙어 있음'(stick)도 여기서 갱신.
  sense() {
    const p = this.player;
    const T = TILE_SIZE;
    const map = this.map;
    const env = { double: false, infinite: false, airjump: false, darkcloud: false, ladder: false, ladderX: null };
    const body = { x: p.x, y: p.y, w: p.w, h: p.h };
    const x0 = Math.floor(p.x / T), x1 = Math.floor((p.x + p.w - EPS) / T);
    const y0 = Math.floor(p.y / T), y1 = Math.floor((p.y + p.h - EPS) / T);
    const orbBox = (x, y) => ({ x: x * T + 4, y: y * T + 4, w: T - 8, h: T - 8 });
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const zone = map.zone(tx, ty);
        if (zone === 'double') env.double = true;
        if (zone === 'infinite') env.infinite = true;
        const type = map.designType(tx, ty);
        if (type === 'darkcloud') env.darkcloud = true;
        if (type === 'airjump' && boxesOverlap(body, orbBox(tx, ty))) env.airjump = true;
      }
    }
    for (const e of this.entitiesTouching(body)) {
      if (e.type === 'darkcloud') env.darkcloud = true;
      if (e.type === 'airjump' && boxesOverlap(body, orbBox(e.x, e.y))) env.airjump = true;
    }
    // 물은 몸 중심 기준, 머리가 물 밖이면 수면
    const cxPx = p.x + p.w / 2;
    const cx = Math.floor(cxPx / T);
    env.water = map.zone(cx, Math.floor((p.y + p.h / 2) / T)) === 'water';
    env.headOut = map.zone(cx, Math.floor((p.y + 2) / T)) !== 'water';
    // 사다리는 몸 중심 세로줄 기준
    for (let ty = y0; ty <= y1; ty++) {
      if (map.designType(cx, ty) === 'ladder') {
        env.ladder = true;
        env.ladderX = cx;
      }
    }
    for (const e of this.entities) {
      if (e.visible && e.type === 'ladder' && cxPx >= e.x * T && cxPx < (e.x + 1) * T && p.y < (e.y + 1) * T && p.y + p.h > e.y * T) {
        env.ladder = true;
        env.ladderX = e.x;
      }
    }
    env.ladderBelow = this.ladderAt(cxPx, p.y + p.h + 1);
    // 벽: 몸 옆면이 벽 블록에 딱 붙어 있음
    const isWall = (tx) => {
      for (let ty = y0; ty <= y1; ty++) if (map.designType(tx, ty) === 'wall') return true;
      return false;
    };
    env.wall = isWall(Math.floor((p.x - 0.5) / T)) || isWall(Math.floor((p.x + p.w + 0.5) / T));
    for (const e of this.entities) {
      const b = entityBox(e);
      e.flags.stick = e.visible && p.y < b.y + b.h && p.y + p.h > b.y
        && (Math.abs(p.x + p.w - b.x) < 0.5 || Math.abs(p.x - (b.x + b.w)) < 0.5);
      if (e.flags.stick && e.type === 'wall') env.wall = true;
    }
    return env;
  }

  jump(speed, noCut = false) {
    const p = this.player;
    const from = p.onGround || p.coyote > 0 ? p.lastGroundEntity || p.groundEntity : null;
    if (from) from.flags.jump = true; // 이 블록 위에서 점프했음
    p.vy = -speed;
    p.jumpBuffer = p.coyote = 0;
    p.jumpCut = noCut;
    p.onGround = false;
    p.groundEntity = null;
  }

  updateMove(dt, input, env) {
    const p = this.player;

    // 사다리 타기 시작: 겹친 채 ↑, 또는 ↓ (사다리 꼭대기 위에 서 있을 때 포함)
    if (p.mode === 'normal') {
      const wantClimb = (env.ladder && input.up) || (input.down && (env.ladderBelow || (env.ladder && !p.onGround)));
      if (wantClimb) p.mode = 'climb';
    }
    if (p.mode === 'climb') {
      if (input.jumpPressed) {
        p.mode = 'normal';
        this.jump(PHYS.jumpSpeed);
      } else if (!env.ladder && !(input.down && env.ladderBelow)) {
        p.mode = 'normal'; // 사다리에서 벗어남
      } else {
        if (input.dir) {
          p.vx = input.dir * PHYS.moveSpeed * 0.5;
          this.moveX(p.vx * dt);
        } else if (env.ladderX !== null) {
          // 좌우 입력이 없으면 사다리 가운데로 붙는다 (옆 블록에 머리가 걸리지 않게)
          const target = env.ladderX * TILE_SIZE + (TILE_SIZE - p.w) / 2;
          p.vx = 0;
          this.moveX(approach(p.x, target, 200 * dt) - p.x);
        }
        p.vy = ((input.down ? 1 : 0) - (input.up ? 1 : 0)) * PHYS.climbSpeed;
        p.airJumps = 0;
        this.moveY(p.vy * dt, { climbing: true });
        return;
      }
    }

    // 좌우: 얼음 위는 미끄럽게. 공중에서 빠르게 날아갈 땐(밧줄 반동 등) 그 속도를 살린다.
    const onIce = p.onGround && p.groundType === 'ice';
    const target = input.dir * PHYS.moveSpeed;
    let accel;
    if (!p.onGround && Math.abs(p.vx) > PHYS.moveSpeed && Math.sign(p.vx) === input.dir) accel = PHYS.airFriction;
    else if (input.dir) accel = p.onGround ? (onIce ? PHYS.iceAccel : PHYS.groundAccel) : PHYS.airAccel;
    else accel = p.onGround ? (onIce ? PHYS.iceFriction : PHYS.groundFriction) : PHYS.airFriction;
    p.vx = approach(p.vx, target, accel * dt);

    // 점프: 물(헤엄) → 땅·벽·공점·보라 구역(무한) → 노란 구역(공중 1번 더)
    p.jumpBuffer = input.jumpPressed ? PHYS.jumpBuffer : Math.max(0, p.jumpBuffer - dt);
    p.coyote = p.onGround ? PHYS.coyoteTime : Math.max(0, p.coyote - dt);
    if (p.onGround || env.water || env.wall) p.airJumps = 0;
    if (p.jumpBuffer > 0) {
      if (env.water) this.jump(env.headOut ? PHYS.waterExitJump : PHYS.waterJump, true);
      else if (p.coyote > 0 || env.wall || env.airjump || env.infinite) this.jump(PHYS.jumpSpeed);
      else if (env.double && p.airJumps < 1) {
        p.airJumps++;
        this.jump(PHYS.jumpSpeed);
      }
    }
    if (p.vy < 0 && !p.jumpCut && !input.jumpHeld) {
      p.vy *= PHYS.jumpCut;
      p.jumpCut = true;
    }

    // 세로: 먹구름은 강제로 빠르게 아래로, 물은 아주 천천히
    if (env.darkcloud) p.vy = PHYS.darkCloudFall;
    else if (env.water) {
      p.vy += PHYS.waterGravity * dt;
      if (p.vy > PHYS.waterMaxFall) p.vy = approach(p.vy, PHYS.waterMaxFall, 4000 * dt);
    } else p.vy = Math.min(p.vy + PHYS.gravity * dt, PHYS.maxFall);

    const conveyor = p.onGround && p.groundType === 'machine' ? (p.groundDir ? 1 : -1) * PHYS.conveyorSpeed : 0;
    this.moveX(p.vx * dt);
    if (conveyor) this.moveX(conveyor * dt);
    this.moveY(p.vy * dt);
  }

  updateCloud(dt, input) {
    const p = this.player;
    const c = this.cloud;
    c.t += dt;
    p.vx = approach(p.vx, input.dir * PHYS.moveSpeed, PHYS.airAccel * dt);
    this.moveX(p.vx * dt);
    // 움직이는 구름이면 지금 위치 기준으로 바닥을 다시 잡음
    const endY = c.entity ? (c.entity.y + 1) * TILE_SIZE - p.h : c.endY;
    const startY = c.entity ? c.entity.y * TILE_SIZE - p.h : c.startY;
    const k = Math.min(1, c.t / PHYS.cloudSinkTime);
    const ease = 1 - (1 - k) * (1 - k);
    p.y = startY + (endY - startY) * ease; // 끝에선 캐릭터가 구름 칸 안에 완전히 겹침
    this.cloudPress = { key: c.key, entity: c.entity, amount: ease };
    if (k >= 1 || (c.entity && !c.entity.visible)) {
      this.cloud = null;
      p.mode = 'normal';
      p.airJumps = 0;
      this.jump(PHYS.cloudBounce, true);
    }
  }

  // 점프 키를 누른 채 밧줄에 닿으면 잡는다.
  tryGrabRope(input) {
    const p = this.player;
    if (p.mode !== 'normal' || p.onGround || !input.jumpHeld || this.ropeCooldown > 0) return;
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    for (const r of this.ropes) {
      const pv = ropePivot(r);
      const L = ropeLength(r);
      const ex = pv.x + Math.sin(r.angle) * L;
      const ey = pv.y + Math.cos(r.angle) * L;
      const t = Math.max(0, Math.min(1, ((cx - pv.x) * (ex - pv.x) + (cy - pv.y) * (ey - pv.y)) / (L * L)));
      if (Math.hypot(cx - (pv.x + (ex - pv.x) * t), cy - (pv.y + (ey - pv.y) * t)) > 14) continue;
      const d = Math.max(TILE_SIZE * 0.75, Math.min(L, Math.hypot(cx - pv.x, cy - pv.y)));
      const angle = Math.atan2(cx - pv.x, cy - pv.y);
      // 지금 속도 중 밧줄 방향에 수직인 성분을 흔들림으로 이어받음
      const before = { angle: r.angle, omega: r.omega };
      r.angle = angle;
      r.omega = (p.vx * Math.cos(angle) - p.vy * Math.sin(angle)) / d;
      this.rope = { r, d };
      if (!this.placeOnRope()) {
        // 잡을 자리가 블록과 겹치면 못 잡음
        Object.assign(r, before);
        this.rope = null;
        continue;
      }
      p.mode = 'rope';
      p.airJumps = 0;
      return;
    }
  }

  updateRope(dt, input) {
    const { r, d } = this.rope;
    if (!input.jumpHeld) return this.releaseRope();

    let alpha = -(PHYS.gravity / d) * Math.sin(r.angle);
    if (input.dir) {
      // 흔들리는 방향으로 밀 때만 힘을 더해 각도가 점점 커진다
      if (Math.sign(r.omega) === input.dir || Math.abs(r.omega) < 0.3) alpha += (input.dir * PHYS.ropePump) / d;
    } else {
      r.omega *= Math.max(0, 1 - PHYS.ropeDamping * dt); // 가만히 있으면 점점 작아짐
    }
    r.omega += alpha * dt;
    let next = r.angle + r.omega * dt;
    if (Math.abs(next) > PHYS.ropeMaxAngle) {
      next = Math.sign(next) * PHYS.ropeMaxAngle;
      r.omega = 0;
    }
    const prev = r.angle;
    r.angle = next;
    if (!this.placeOnRope()) {
      // 블록에 부딪히면 되튕김
      r.angle = prev;
      r.omega = -r.omega * 0.3;
      this.placeOnRope();
    }
  }

  // 밧줄 위치에 플레이어를 놓는다. 단단한 블록과 겹치면 false.
  placeOnRope() {
    const p = this.player;
    const { r, d } = this.rope;
    const pv = ropePivot(r);
    const x = pv.x + Math.sin(r.angle) * d - p.w / 2;
    const y = pv.y + Math.cos(r.angle) * d - p.h / 2;
    if (this.boxHitsSolid(x, y)) return false;
    p.x = x;
    p.y = y;
    const v = r.omega * d;
    p.vx = v * Math.cos(r.angle);
    p.vy = -v * Math.sin(r.angle);
    return true;
  }

  // 점프 키를 떼면 밧줄 반동으로 튀어나간다.
  releaseRope() {
    const p = this.player;
    const { r, d } = this.rope;
    const v = r.omega * d;
    p.vx = v * Math.cos(r.angle);
    p.vy = -v * Math.sin(r.angle) - PHYS.ropeJump;
    p.mode = 'normal';
    p.jumpCut = true;
    p.coyote = p.jumpBuffer = 0;
    this.rope = null;
    this.ropeCooldown = PHYS.ropeRegrab;
  }

  // 아무도 안 매달린 밧줄은 흔들리다 멈춘다.
  swingFreeRopes(dt) {
    for (const r of this.ropes) {
      if (this.rope?.r === r || (!r.angle && !r.omega)) continue;
      r.omega += -(PHYS.gravity / ropeLength(r)) * Math.sin(r.angle) * dt;
      r.omega *= Math.max(0, 1 - 1.2 * dt);
      r.angle += r.omega * dt;
      if (Math.abs(r.angle) < 0.002 && Math.abs(r.omega) < 0.01) r.angle = r.omega = 0;
    }
  }

  // (x, y)에 플레이어 몸을 두면 단단한 블록과 겹치는지. ignore: 무시할 움직이는 블록
  boxHitsSolid(x, y, ignore = null) {
    const p = this.player;
    const T = TILE_SIZE;
    for (let ty = Math.floor(y / T); ty <= Math.floor((y + p.h - EPS) / T); ty++) {
      for (let tx = Math.floor(x / T); tx <= Math.floor((x + p.w - EPS) / T); tx++) {
        if (this.map.isSolid(tx, ty)) return true;
      }
    }
    return this.entitiesTouching({ x, y, w: p.w, h: p.h }, (e) => e !== ignore && isSolidType(e.type)).length > 0;
  }

  // 가시: 칸 블록은 칸 회전(rot), 움직이는 블록은 거기에 코드로 돌린 각도까지 더해 판정
  hazardTriangles(type, tile, x, y, angle = 0) {
    let tris = Shapes.triangles(type, tile.pos, tile.rot);
    if (angle) {
      const c = Math.cos(angle * DEG);
      const s = Math.sin(angle * DEG);
      tris = tris.map((tri) => tri.map(([u, v]) => [0.5 + (u - 0.5) * c - (v - 0.5) * s, 0.5 + (u - 0.5) * s + (v - 0.5) * c]));
    }
    return tris.map((tri) => tri.map(([u, v]) => [(x + u) * TILE_SIZE, (y + v) * TILE_SIZE]));
  }

  // 겹친 칸 처리: 가시 → 사망, 별 → 획득, 체크포인트 → 등록. 죽었으면 true.
  touchTiles() {
    const p = this.player;
    const T = TILE_SIZE;
    const body = { x: p.x, y: p.y, w: p.w, h: p.h };
    const hurt = { x: p.x + 2, y: p.y + 2, w: p.w - 4, h: p.h - 3 }; // 가시 판정은 조금 너그럽게
    const x0 = Math.floor(p.x / T), x1 = Math.floor((p.x + p.w - EPS) / T);
    const y0 = Math.floor(p.y / T), y1 = Math.floor((p.y + p.h - EPS) / T);

    for (const e of this.entitiesTouching(body, (e) => DesignTypes[e.type].hazard)) {
      if (this.hazardTriangles(e.type, e.tile, e.x, e.y, e.angle).some((tri) => triangleHitsBox(tri, hurt))) {
        this.die();
        return true;
      }
    }

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const tile = this.map.get(tx, ty);
        if (!tile) continue;

        if (tile.kind === 'design') {
          if (!DesignTypes[tile.design.type].hazard) continue;
          if (this.hazardTriangles(tile.design.type, tile, tx, ty).some((tri) => triangleHitsBox(tri, hurt))) {
            this.die();
            return true;
          }
        } else if (tile.kind === 'star') {
          const key = cellKey(tx, ty);
          const inner = { x: tx * T + 6, y: ty * T + 6, w: T - 12, h: T - 12 };
          if (!this.progress.stars.has(key) && boxesOverlap(body, inner)) {
            this.progress.stars.add(key);
            this.changed();
          }
        } else if (tile.kind === 'start' || tile.kind === 'checkpoint') {
          // 닿으면 등록되고 부활 지점이 된다.
          const key = cellKey(tx, ty);
          if (tile.kind === 'checkpoint' && !this.progress.checkpoints.has(key)) {
            this.progress.checkpoints.add(key);
            this.changed();
          }
          this.setCurrent(key);
        }
      }
    }
    return false;
  }

  // 한 스텝 이동량이 칸 크기보다 작으므로 칸 블록은 진행 방향의 앞쪽 가장자리만 검사하면 된다.
  // ignore: 무시할 움직이는 블록 (그 블록에 실려 갈 때)
  moveX(dx, ignore = null) {
    const p = this.player;
    p.x += dx;
    if (!dx) return;
    const top = Math.floor(p.y / TILE_SIZE);
    const bottom = Math.floor((p.y + p.h - EPS) / TILE_SIZE);
    if (dx > 0) {
      const tx = Math.floor((p.x + p.w - EPS) / TILE_SIZE);
      for (let ty = top; ty <= bottom; ty++) {
        if (this.map.isSolid(tx, ty)) { p.x = tx * TILE_SIZE - p.w; p.vx = 0; break; }
      }
    } else {
      const tx = Math.floor(p.x / TILE_SIZE);
      for (let ty = top; ty <= bottom; ty++) {
        if (this.map.isSolid(tx, ty)) { p.x = (tx + 1) * TILE_SIZE; p.vx = 0; break; }
      }
    }
    for (const e of this.entities) {
      if (e === ignore || !e.visible || !isSolidType(e.type)) continue;
      const b = entityBox(e);
      if (!boxesOverlap({ x: p.x, y: p.y, w: p.w, h: p.h }, b)) continue;
      p.x = dx > 0 ? b.x - p.w : b.x + b.w;
      p.vx = 0;
    }
  }

  // climbing: 사다리 타는 중이면 사다리 꼭대기를 발판으로 쓰지 않음
  moveY(dy, { climbing = false, ignore = null } = {}) {
    const p = this.player;
    const T = TILE_SIZE;
    const prevBottom = p.y + p.h;
    p.y += dy;
    p.onGround = false;
    p.groundEntity = null;
    const left = Math.floor(p.x / T);
    const right = Math.floor((p.x + p.w - EPS) / T);
    const solidEntities = () => this.entities.filter((e) => e !== ignore && e.visible && isSolidType(e.type));
    const overlapsNow = (b) => boxesOverlap({ x: p.x, y: p.y, w: p.w, h: p.h }, b);

    if (dy > 0) {
      let landed = false;
      const ty = Math.floor((p.y + p.h - EPS) / T);
      for (let tx = left; tx <= right; tx++) {
        if (this.map.isSolid(tx, ty)) {
          this.land(ty * T, this.map.get(tx, ty), null, tx, ty);
          landed = true;
          break;
        }
      }
      for (const e of solidEntities()) {
        const b = entityBox(e);
        if (!overlapsNow(b)) continue;
        this.land(b.y, e.tile, e);
        landed = true;
      }
      if (landed || climbing) return;

      // 구름 윗면 → 파묻히기 시작 · 사다리 꼭대기 → 발판 (위에서 넘어올 때만)
      const top = ty * T;
      if (prevBottom <= top + EPS) {
        for (let tx = left; tx <= right; tx++) {
          const type = this.map.designType(tx, ty);
          if (type === 'cloud') return this.enterCloud({ key: cellKey(tx, ty), top, bottom: top + T });
          if (type === 'ladder' && this.map.designType(tx, ty - 1) !== 'ladder') return this.land(top, this.map.get(tx, ty), null, tx, ty);
        }
      }
      for (const e of this.entities) {
        if (!e.visible || e === ignore || (e.type !== 'cloud' && e.type !== 'ladder')) continue;
        const b = entityBox(e);
        if (prevBottom > b.y + EPS || p.y + p.h <= b.y || p.x >= b.x + b.w || p.x + p.w <= b.x) continue;
        if (e.type === 'cloud') return this.enterCloud({ entity: e });
        if (!this.ladderAt(b.x + T / 2, b.y - 1)) return this.land(b.y, e.tile, e);
      }
    } else if (dy < 0) {
      const ty = Math.floor(p.y / T);
      for (let tx = left; tx <= right; tx++) {
        if (this.map.isSolid(tx, ty)) { p.y = (ty + 1) * T; p.vy = 0; break; }
      }
      for (const e of solidEntities()) {
        const b = entityBox(e);
        if (!overlapsNow(b)) continue;
        p.y = b.y + b.h;
        p.vy = 0;
        e.flags.headbutt = true; // 머리를 박음
      }
    }
  }

  enterCloud({ key = null, entity = null, top, bottom }) {
    const p = this.player;
    p.vy = 0;
    p.mode = 'cloud';
    if (entity) {
      p.y = entity.y * TILE_SIZE - p.h;
      this.cloud = { entity, t: 0 };
    } else {
      p.y = top - p.h;
      this.cloud = { key, startY: p.y, endY: bottom - p.h, t: 0 };
    }
  }

  // 발밑 블록 기록 (얼음·머신 판정, 움직이는 블록에 실려 가기, '위에서 점프' 판정용)
  land(top, tile, entity = null, tx = 0, ty = 0) {
    const p = this.player;
    p.y = top - p.h;
    p.vy = 0;
    p.onGround = true;
    p.groundEntity = entity;
    if (!entity) {
      // 칸 블록 두 개에 걸쳐 서 있으면 몸 중심 아래를 우선
      const center = this.map.get(Math.floor((p.x + p.w / 2) / TILE_SIZE), ty);
      if (center && center.kind === 'design') tile = center;
    }
    p.groundType = tile && tile.kind === 'design' ? tile.design.type : null;
    p.groundDir = tile?.dir ?? 1;
  }

  cameraTarget() {
    const p = this.player;
    return {
      x: p.x + p.w / 2 - VIEW_W / 2,
      y: Math.min(p.y + p.h / 2 - VIEW_H * 0.55, this.camMaxY),
    };
  }

  // ---- 코드 블록 ----

  addEntity(x, y, tile, programs) {
    const e = {
      x, y, // 칸 단위 (실수)
      startX: x, startY: y,
      tile, // 디자인·위치·회전·방향 (convert로 바뀜)
      get type() { return this.tile.design.type; },
      angle: 0, // 코드로 돌린 각도 (도)
      tran: 0, // 투명도 0~100
      visible: true,
      pixels: null, // px()로 바꾼 픽셀 (없으면 디자인 그대로)
      pixelsVersion: 0,
      flags: { jump: false, headbutt: false, stick: false },
      seen: { jump: false, headbutt: false }, // 코드가 이벤트를 읽었는지
      runner: null,
    };
    const design = tile.design;
    if (!programs.has(design)) {
      try {
        programs.set(design, Script.compile(design.code));
      } catch (err) {
        programs.set(design, err);
      }
    }
    const program = programs.get(design);
    if (program instanceof Error) this.reportError(e, program);
    else e.runner = new ScriptRunner(program, this.scriptApi(e));
    this.entities.push(e);
  }

  runScripts(dt) {
    for (const e of this.entities) {
      if (!e.runner || e.runner.done) continue;
      e.runner.step(dt);
      if (e.runner.error) this.reportError(e, e.runner.error);
    }
  }

  reportError(e, err) {
    this.scriptErrors.push({ tag: e.tile.design.tag, x: e.startX, y: e.startY, line: err.line, message: err.message });
  }

  // 블록을 칸 단위로 옮긴다. 위에 서 있는 캐릭터는 같이 실려 가고, 밀리는 캐릭터는 밀려난다.
  moveEntity(e, dx, dy) {
    const p = this.player;
    const T = TILE_SIZE;
    const riding = e.visible && p.mode === 'normal' && p.onGround && p.groundEntity === e;
    e.x += dx;
    e.y += dy;
    if (riding) {
      this.moveX(dx * T, e);
      this.moveY(dy * T, { ignore: e });
      if (Math.abs(p.y + p.h - e.y * T) < 1 && p.x < (e.x + 1) * T && p.x + p.w > e.x * T) {
        this.land(e.y * T, e.tile, e);
      }
      return;
    }
    if (!e.visible || !isSolidType(e.type)) return;
    const b = entityBox(e);
    if (!boxesOverlap({ x: p.x, y: p.y, w: p.w, h: p.h }, b)) return;
    if (Math.abs(dx) >= Math.abs(dy)) p.x = dx > 0 ? b.x + b.w : b.x - p.w;
    else if (dy < 0) this.land(b.y, e.tile, e); // 밑에서 올라오면 올라탐
    else p.y = b.y + b.h;
    if (this.boxHitsSolid(p.x, p.y, e)) this.die(); // 블록 사이에 끼면 사망
  }

  // 코드에서 쓰는 함수들 (script.js의 명령·함수 이름과 같음)
  scriptApi(e) {
    const T = TILE_SIZE;
    const p = this.player;
    const num = (v, what) => {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${what}에는 숫자가 필요합니다.`);
      return v;
    };
    const pixelIndex = (v) => {
      if (!Number.isInteger(v) || v < 1 || v > 64) throw new Error(`픽셀 번호는 1~64여야 합니다. (지금 ${v})`);
      return v - 1;
    };
    return {
      blockTag: () => e.tile.design.tag,
      cooX: () => e.x,
      cooY: () => e.y,
      caCooX: () => (p.x + p.w / 2) / T - 0.5,
      caCooY: () => (p.y + p.h) / T - 1,
      pxColor: (i) => (e.pixels || e.tile.design.pixels)[pixelIndex(i)] || '',
      dis: () => !e.visible,
      app: () => e.visible,
      jump: () => (e.flags.jump ? (e.seen.jump = true) : false),
      headbutt: () => (e.flags.headbutt ? (e.seen.headbutt = true) : false),
      stick: () => e.flags.stick,
      convert: (tag) => {
        const design = this.map.findDesign(tag);
        if (!design) throw new Error(`블록 태그가 ${tag}인 블록이 없습니다.`);
        e.tile = designTile(design, e.tile);
        e.pixels = null;
      },
      rot: (deg) => {
        e.angle += num(deg, 'rot');
      },
      Tran: (v) => {
        e.tran = Math.max(0, Math.min(100, num(v, 'Tran')));
      },
      TranPlus: (v) => {
        e.tran = Math.max(0, Math.min(100, e.tran + num(v, 'TranPlus')));
      },
      move: (dx, dy) => this.moveEntity(e, num(dx, 'move'), num(dy, 'move')),
      rotMove: (deg, dist) => {
        const a = num(deg, 'rotMove') * DEG;
        const d = num(dist, 'rotMove');
        this.moveEntity(e, Math.sin(a) * d, -Math.cos(a) * d);
      },
      px: (i, color) => {
        const index = pixelIndex(i);
        if (!/^#[0-9a-f]{6}$/i.test(String(color))) throw new Error(`색은 #ff0000처럼 써야 합니다. (지금 ${color})`);
        e.pixels = e.pixels || e.tile.design.pixels.slice();
        e.pixels[index] = String(color).toLowerCase();
        e.pixelsVersion++;
      },
      disapp: () => {
        e.visible = false;
      },
      appear: () => {
        e.visible = true;
      },
      noKey: (name) => keyCodes(name).forEach((c) => this.blockedKeys.add(c)),
      yesKey: (name) => keyCodes(name).forEach((c) => this.blockedKeys.delete(c)),
      caTp: (x, y) => {
        this.placeAt({ x: num(x, 'caTp'), y: num(y, 'caTp') });
      },
      kill: () => this.die(),
    };
  }

  render(ctx) {
    const camX = Math.round(this.cam.x);
    const camY = Math.round(this.cam.y);
    Render.background(ctx, this.map.background, camX);
    const info = { progress: this.progress, currentKey: this.currentCheckpoint().key, cloudPress: this.cloudPress };
    Render.tiles(ctx, this.map, camX, camY, info);
    Render.entities(ctx, this.entities, camX, camY, info);
    Render.ropes(ctx, this.ropes, camX, camY);
    Render.zones(ctx, this.map, camX, camY, ['double', 'infinite']);
    Render.player(ctx, this.player, camX, camY);
    Render.zones(ctx, this.map, camX, camY, ['water']); // 물은 캐릭터 위에 덮어 물속처럼
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 60, 60, ${this.flash})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }
}
