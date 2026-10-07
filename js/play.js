// 플레이 세션: 플레이어 물리, 특수 블록, 코드 블록, 체크포인트·별·가시, 카메라.
//
// 플레이어 상태(mode)
//   normal: 걷기·점프·낙하 (구역, 얼음, 머신, 벽, 먹구름, 공점은 이 상태에서 처리)
//   climb:  사다리 타는 중
//   cloud:  구름에 파묻히는 중 → 바닥까지 내려가면 저절로 튀어오름
//   rope:   밧줄에 매달려 흔드는 중 (점프 키를 누르고 있는 동안)
//
// 판정: 블록은 그린 픽셀 모양 그대로 부딪힌다 (designs.js의 Hitbox). 돌린 블록은 돌린 모양대로.
//   낮은 턱(STEP_UP 이하)은 걸어서 올라서고 내려가는 비탈에는 붙어 걸어서, 기울어진 면은 비탈처럼 다닌다.
//
// 코드가 들어 있는 블록은 칸에서 빼내 "움직이는 블록"(entity)으로 다룬다.
//   좌표는 칸 단위 실수, 회전(도)·투명도·숨김·픽셀 색을 블록마다 따로 가지며 자기 코드를 돌린다.
//   캐릭터가 죽으면 처음 상태(perm()으로 저장했으면 그 상태)로 돌아가 코드를 처음부터 다시 실행한다.
//   '죽어도 진행'을 켠 블록은 그대로 계속 실행한다.

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
const STEP_UP = 8; // 이 높이(px, 픽셀 2칸) 이하의 턱은 걸어서 올라섬
const STEP_DOWN = 12; // 내려가는 비탈에서 이만큼까지는 땅에 붙어 걸음 (한 프레임에 계단 두 칸을 지나도 붙도록)
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

// 밧줄 고정점과 길이(px)
const ropePivot = (r) => ({ x: r.x * TILE_SIZE + TILE_SIZE / 2, y: r.y * TILE_SIZE + 6 });
const ropeLength = (r) => r.length * TILE_SIZE - 8;

const isSolidType = (type) => !!type && !!DesignTypes[type].solid;
const isHazardType = (type) => !!type && !!DesignTypes[type].hazard;

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
    this.cloud = null; // 파묻히는 중인 구름 { key | entity, top, bottom, t }
    this.cloudPress = null; // 구름 눌림 연출 { key | entity, amount }
    this.rope = null; // 매달린 밧줄 { r, d }
    this.ropeCooldown = 0;
    this.blockedKeys = new Set(); // noKey로 막힌 키
    this.scriptErrors = []; // { tag, x, y, line, message }
    this.shared = {}; // 월드 공통 변수 ('_'로 끝나는 이름)
    this.savedShared = {}; // perm()으로 저장한 공통 변수 (죽으면 이 값으로)
    this.resetPending = false;

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

  // 등록된 체크포인트로 이동. 떨어지는 중이면 거부. (죽은 게 아니라 코드 블록은 그대로)
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

  // 죽음: 체크포인트로 돌아가고, 코드 블록은 이번 프레임 코드가 다 돈 뒤 처음 상태로 되돌린다.
  die() {
    this.flash = 0.35;
    this.restart();
  }

  // R 키: 스스로 죽는 것과 같음 (화면만 안 붉어짐)
  restart() {
    this.resetPending = true;
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
    if (this.keyPressed('KeyR')) this.restart();

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

    if (this.resetPending) this.resetEntities(); // 이번 스텝에 죽었으면 코드 블록을 먼저 되돌리고
    this.runScripts(dt);
    if (this.resetPending) this.resetEntities(); // 코드 안에서 kill()했으면 코드가 다 돈 뒤에 되돌림

    const target = this.cameraTarget();
    const k = 1 - Math.exp(-dt * 10);
    this.cam.x += (target.x - this.cam.x) * k;
    this.cam.y += (target.y - this.cam.y) * k;
  }

  // ---- 판정 조각 (칸 블록 + 움직이는 블록) ----

  body(x = this.player.x, y = this.player.y) {
    return { x, y, w: this.player.w, h: this.player.h };
  }

  // 움직이는 블록의 판정 사각형 (블록 왼쪽 위 기준 px). 모양·각도가 바뀔 때만 다시 계산.
  entityRects(e) {
    const t = e.tile;
    const key = `${t.design.version}|${e.pixelsVersion}|${t.pos}|${t.rot}|${e.angle}|${t.design.tag}`;
    if (e.rectKey !== key) {
      e.rectKey = key;
      e.rects = Hitbox.rects(e.pixels || t.design.pixels, t.design.type, t.pos, t.rot * 90 + e.angle);
    }
    return e.rects;
  }

  // 상자 근처 블록들의 판정 조각 (월드 px). 각 조각: { x, y, w, h, type, tile, entity, tx, ty }
  piecesNear(box) {
    const T = TILE_SIZE;
    const out = [];
    // 단일 가시 위치·회전 때문에 칸 밖으로 조금 나갈 수 있어 한 칸씩 더 본다
    const x0 = Math.floor(box.x / T) - 1, x1 = Math.floor((box.x + box.w) / T) + 1;
    const y0 = Math.floor(box.y / T) - 1, y1 = Math.floor((box.y + box.h) / T) + 1;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const tile = this.map.get(tx, ty);
        if (!tile || tile.kind !== 'design') continue;
        for (const r of Hitbox.forTile(tile)) {
          out.push({ x: tx * T + r.x, y: ty * T + r.y, w: r.w, h: r.h, type: tile.design.type, tile, entity: null, tx, ty });
        }
      }
    }
    for (const e of this.entities) {
      if (!e.visible) continue;
      const ex = e.x * T;
      const ey = e.y * T;
      if (ex > box.x + box.w + T || ex + T * 2 < box.x || ey > box.y + box.h + T || ey + T * 2 < box.y) continue;
      for (const r of this.entityRects(e)) out.push({ x: ex + r.x, y: ey + r.y, w: r.w, h: r.h, type: e.type, tile: e.tile, entity: e });
    }
    return out;
  }

  // 몸과 겹치는 단단한 조각. ignore: 무시할 움직이는 블록 (그 블록에 실려 갈 때)
  solidHits(box, ignore = null) {
    return this.piecesNear(box).filter((r) => isSolidType(r.type) && !(ignore && r.entity === ignore) && boxesOverlap(box, r));
  }

  // (x, y)에 플레이어 몸을 두면 단단한 블록과 겹치는지
  boxHitsSolid(x, y, ignore = null) {
    return this.solidHits(this.body(x, y), ignore).length > 0;
  }

  // 점 (px, py)에 사다리가 있는지
  ladderAt(px, py) {
    return this.piecesNear({ x: px, y: py, w: 0, h: 0 })
      .some((r) => r.type === 'ladder' && px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h);
  }

  // 발밑 maxDist 안에 단단한 윗면이 있으면 그 거리
  groundBelow(maxDist, ignore = null) {
    const p = this.player;
    const feet = p.y + p.h;
    const probe = { x: p.x, y: feet, w: p.w, h: maxDist + 0.01 }; // maxDist 딱 그 거리도 포함
    let best = null;
    for (const r of this.piecesNear(probe)) {
      if (!isSolidType(r.type) || (ignore && r.entity === ignore) || r.y < feet - 0.01 || !boxesOverlap(probe, r)) continue;
      best = best === null ? r.y : Math.min(best, r.y);
    }
    return best === null ? null : best - feet;
  }

  // 플레이어 주변 상황. 움직이는 블록의 '옆면에 붙어 있음'(stick)도 여기서 갱신.
  sense() {
    const p = this.player;
    const T = TILE_SIZE;
    const map = this.map;
    const env = { double: false, infinite: false, airjump: false, darkcloud: false, ladder: false, ladderX: null, wall: false };
    const body = this.body();
    const x0 = Math.floor(p.x / T), x1 = Math.floor((p.x + p.w - EPS) / T);
    const y0 = Math.floor(p.y / T), y1 = Math.floor((p.y + p.h - EPS) / T);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const zone = map.zone(tx, ty);
        if (zone === 'double') env.double = true;
        if (zone === 'infinite') env.infinite = true;
      }
    }
    // 물은 몸 중심 기준, 머리가 물 밖이면 수면
    const cxPx = p.x + p.w / 2;
    const cx = Math.floor(cxPx / T);
    env.water = map.zone(cx, Math.floor((p.y + p.h / 2) / T)) === 'water';
    env.headOut = map.zone(cx, Math.floor((p.y + 2) / T)) !== 'water';

    for (const e of this.entities) e.flags.stick = false;
    for (const r of this.piecesNear(body)) {
      const vertical = r.y < p.y + p.h && r.y + r.h > p.y;
      if (boxesOverlap(body, r)) {
        if (r.type === 'darkcloud') env.darkcloud = true;
        if (r.type === 'airjump') env.airjump = true;
      }
      // 사다리는 몸 중심 세로줄 기준
      if (r.type === 'ladder' && vertical && cxPx >= r.x && cxPx < r.x + r.w) {
        env.ladder = true;
        env.ladderX = r.x + r.w / 2;
      }
      // 몸 옆면이 단단한 조각에 딱 붙어 있음 (벽 점프 · stick)
      if (isSolidType(r.type) && vertical && (Math.abs(p.x + p.w - r.x) < 0.5 || Math.abs(p.x - (r.x + r.w)) < 0.5)) {
        if (r.type === 'wall') env.wall = true;
        if (r.entity) r.entity.flags.stick = true;
      }
    }
    env.ladderBelow = this.ladderAt(cxPx, p.y + p.h + 1);
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
          p.vx = 0;
          this.moveX(approach(p.x, env.ladderX - p.w / 2, 200 * dt) - p.x);
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

    // 땅 위에서 걸을 땐 낮은 턱을 올라서고 내려가는 비탈에 붙는다
    const grounded = p.onGround && p.vy >= 0;
    const conveyor = p.onGround && p.groundType === 'machine' ? (p.groundDir ? 1 : -1) * PHYS.conveyorSpeed : 0;
    this.moveX(p.vx * dt, { step: grounded });
    if (conveyor) this.moveX(conveyor * dt, { step: grounded });
    if (grounded) {
      const d = this.groundBelow(STEP_DOWN);
      if (d !== null && d > 0.01) p.y += d;
    }
    this.moveY(p.vy * dt);
  }

  updateCloud(dt, input) {
    const p = this.player;
    const c = this.cloud;
    c.t += dt;
    p.vx = approach(p.vx, input.dir * PHYS.moveSpeed, PHYS.airAccel * dt);
    this.moveX(p.vx * dt);
    // 움직이는 구름이면 지금 위치 기준으로 범위를 다시 잡음
    if (c.entity) {
      const r = this.entityRects(c.entity)[0];
      if (r) {
        c.top = c.entity.y * TILE_SIZE + r.y;
        c.bottom = c.top + r.h;
      }
    }
    const startY = c.top - p.h;
    const endY = c.bottom - p.h; // 끝에선 캐릭터가 구름 안에 완전히 겹침
    const k = Math.min(1, c.t / PHYS.cloudSinkTime);
    const ease = 1 - (1 - k) * (1 - k);
    p.y = startY + (endY - startY) * ease;
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

  // 겹친 칸 처리: 가시 → 사망, 별 → 획득, 체크포인트 → 등록. 죽었으면 true.
  touchTiles() {
    const p = this.player;
    const T = TILE_SIZE;
    const body = this.body();
    const hurt = { x: p.x + 2, y: p.y + 2, w: p.w - 4, h: p.h - 3 }; // 가시 판정은 조금 너그럽게
    if (this.piecesNear(hurt).some((r) => isHazardType(r.type) && boxesOverlap(hurt, r))) {
      this.die();
      return true;
    }

    const x0 = Math.floor(p.x / T), x1 = Math.floor((p.x + p.w - EPS) / T);
    const y0 = Math.floor(p.y / T), y1 = Math.floor((p.y + p.h - EPS) / T);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const tile = this.map.get(tx, ty);
        if (!tile) continue;
        if (tile.kind === 'star') {
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

  // 가로 이동. 이번 이동으로 새로 부딪힌 조각만 막는다 (이미 겹쳐 있던 조각은 빠져나갈 수 있게).
  // step: 땅 위에서 걷는 중이면 낮은 턱은 올라선다.
  moveX(dx, { ignore = null, step = false } = {}) {
    const p = this.player;
    if (!dx) return;
    p.x += dx;
    for (let i = 0; i < 4; i++) {
      const hits = this.solidHits(this.body(), ignore)
        .filter((h) => (dx > 0 ? p.x + p.w - h.x : h.x + h.w - p.x) <= Math.abs(dx) + 0.01);
      if (!hits.length) return;
      if (step && i === 0) {
        const lift = p.y + p.h - Math.min(...hits.map((h) => h.y));
        if (lift > 0 && lift <= STEP_UP && !this.boxHitsSolid(p.x, p.y - lift, ignore)) {
          p.y -= lift;
          return;
        }
      }
      p.x = dx > 0 ? Math.min(...hits.map((h) => h.x)) - p.w : Math.max(...hits.map((h) => h.x + h.w));
      p.vx = 0;
    }
  }

  // 세로 이동. climbing: 사다리 타는 중이면 사다리 꼭대기·구름을 발판으로 쓰지 않음
  moveY(dy, { climbing = false, ignore = null } = {}) {
    const p = this.player;
    const prevBottom = p.y + p.h;
    const prevTop = p.y;
    p.y += dy;
    p.onGround = false;
    p.groundEntity = null;

    if (dy > 0) {
      const hits = this.solidHits(this.body(), ignore).filter((h) => prevBottom <= h.y + 0.01);
      if (hits.length) {
        const top = Math.min(...hits.map((h) => h.y));
        return this.land(top, this.pieceUnder(hits.filter((h) => h.y <= top + 0.01)));
      }
      if (climbing) return;
      // 구름 윗면 → 파묻히기 시작 · 사다리 꼭대기 → 발판 (위에서 넘어올 때만)
      for (const r of this.piecesNear(this.body())) {
        if ((r.type !== 'cloud' && r.type !== 'ladder') || (ignore && r.entity === ignore)) continue;
        if (prevBottom > r.y + EPS || p.y + p.h <= r.y || p.x >= r.x + r.w || p.x + p.w <= r.x) continue;
        if (r.type === 'cloud') return this.enterCloud(r);
        if (!this.ladderAt(r.x + r.w / 2, r.y - 1)) return this.land(r.y, r);
      }
    } else if (dy < 0) {
      const hits = this.solidHits(this.body(), ignore).filter((h) => h.y + h.h <= prevTop + 0.01);
      if (hits.length) {
        p.y = Math.max(...hits.map((h) => h.y + h.h));
        p.vy = 0;
        for (const h of hits) if (h.entity) h.entity.flags.headbutt = true; // 머리를 박음
      }
    }
  }

  // 여러 조각 위에 걸쳐 있으면 몸 중심 아래 조각을 고름
  pieceUnder(pieces) {
    const cx = this.player.x + this.player.w / 2;
    return pieces.find((h) => cx >= h.x && cx < h.x + h.w) || pieces[0];
  }

  enterCloud(piece) {
    const p = this.player;
    p.vy = 0;
    p.mode = 'cloud';
    p.y = piece.y - p.h;
    this.cloud = {
      key: piece.entity ? null : cellKey(piece.tx, piece.ty),
      entity: piece.entity, top: piece.y, bottom: piece.y + piece.h, t: 0,
    };
  }

  // 발밑 블록 기록 (얼음·머신 판정, 움직이는 블록에 실려 가기, '위에서 점프' 판정용)
  land(top, piece) {
    const p = this.player;
    p.y = top - p.h;
    p.vy = 0;
    p.onGround = true;
    p.groundEntity = piece.entity;
    p.groundType = piece.type;
    p.groundDir = piece.tile?.dir ?? 1;
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
    const design = tile.design;
    const e = {
      startX: x, startY: y,
      keep: design.keep, // 죽어도 진행
      x, y, // 칸 단위 (실수)
      tile, // 디자인·위치·회전·방향 (convert로 바뀜)
      get type() { return this.tile.design.type; },
      angle: 0, // 코드로 돌린 각도 (도)
      tran: 0, // 투명도 0~100
      visible: true,
      pixels: null, // px()로 바꾼 픽셀 (없으면 디자인 그대로)
      pixelsVersion: 0,
      flags: { jump: false, headbutt: false, stick: false },
      seen: { jump: false, headbutt: false }, // 코드가 이벤트를 읽었는지
      program: null,
      runner: null,
      saved: null, // perm()으로 저장한 상태
    };
    e.initial = this.snapshot(e);
    if (!programs.has(design)) {
      try {
        programs.set(design, Script.compile(design.code));
      } catch (err) {
        programs.set(design, err);
      }
    }
    const program = programs.get(design);
    e.api = this.scriptApi(e);
    if (program instanceof Error) this.reportError(e, program);
    else {
      e.program = program;
      e.runner = new ScriptRunner(program, e.api, this.shared);
    }
    this.entities.push(e);
  }

  snapshot(e) {
    return {
      x: e.x, y: e.y, tile: e.tile, angle: e.angle, tran: e.tran, visible: e.visible,
      pixels: e.pixels && e.pixels.slice(), vars: e.runner ? { ...e.runner.vars } : {},
    };
  }

  // 죽은 뒤: '죽어도 진행'이 아닌 블록을 처음 상태(또는 perm()으로 저장한 상태)로 되돌리고 코드를 처음부터
  resetEntities() {
    this.resetPending = false;
    for (const key of Object.keys(this.shared)) delete this.shared[key];
    Object.assign(this.shared, this.savedShared);
    for (const e of this.entities) {
      if (e.keep) continue;
      const s = e.saved || e.initial;
      Object.assign(e, { x: s.x, y: s.y, tile: s.tile, angle: s.angle, tran: s.tran, visible: s.visible });
      e.pixels = s.pixels && s.pixels.slice();
      e.pixelsVersion++;
      for (const ev of ['jump', 'headbutt', 'stick']) e.flags[ev] = false;
      e.seen.jump = e.seen.headbutt = false;
      if (e.program) e.runner = new ScriptRunner(e.program, e.api, this.shared, s.vars);
    }
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

  isRiding(e) {
    const p = this.player;
    return e.visible && p.mode === 'normal' && p.onGround && p.groundEntity === e;
  }

  // 이 블록의 단단한 조각 (월드 px)
  solidPiecesOf(e) {
    if (!e.visible || !isSolidType(e.type)) return [];
    const T = TILE_SIZE;
    return this.entityRects(e).map((r) => ({ x: e.x * T + r.x, y: e.y * T + r.y, w: r.w, h: r.h, type: e.type, tile: e.tile, entity: e }));
  }

  // 실려 가던 캐릭터를 블록 윗면에 다시 세움 (발이 윗면 근처에 있을 때)
  reland(e) {
    const p = this.player;
    const feet = p.y + p.h;
    const under = this.solidPiecesOf(e).filter((r) => p.x < r.x + r.w && p.x + p.w > r.x && Math.abs(r.y - feet) <= 6);
    if (!under.length) return;
    const top = Math.min(...under.map((r) => r.y));
    if (!this.boxHitsSolid(p.x, top - p.h, e)) this.land(top, this.pieceUnder(under.filter((r) => r.y <= top + 0.01)));
  }

  // 블록이 움직이거나 돌아서 캐릭터와 겹치면 가장 조금 움직이는 쪽으로 밀어낸다. 갈 데가 없으면 끼어서 사망.
  pushOut(e) {
    const p = this.player;
    const hits = this.solidPiecesOf(e).filter((r) => boxesOverlap(this.body(), r));
    if (!hits.length) return;
    const options = [
      { dx: 0, dy: Math.min(...hits.map((h) => h.y)) - (p.y + p.h), up: true },
      { dx: Math.min(...hits.map((h) => h.x)) - (p.x + p.w), dy: 0 },
      { dx: Math.max(...hits.map((h) => h.x + h.w)) - p.x, dy: 0 },
      { dx: 0, dy: Math.max(...hits.map((h) => h.y + h.h)) - p.y },
    ].sort((a, b) => Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy)));
    for (const o of options) {
      if (this.boxHitsSolid(p.x + o.dx, p.y + o.dy)) continue;
      p.x += o.dx;
      p.y += o.dy;
      if (o.up) this.reland(e); // 밑에서 올라오면 올라탐
      return;
    }
    this.die(); // 블록 사이에 낌
  }

  // 블록을 칸 단위로 옮긴다. 위에 서 있는 캐릭터는 같이 실려 간다.
  moveEntity(e, dx, dy) {
    const T = TILE_SIZE;
    const riding = this.isRiding(e);
    e.x += dx;
    e.y += dy;
    if (riding) {
      this.moveX(dx * T, { ignore: e });
      this.moveY(dy * T, { ignore: e });
      this.reland(e);
    } else this.pushOut(e);
  }

  // 블록을 돌린다. 위에 서 있는 캐릭터는 블록 가운데를 축으로 같이 돌아간다.
  rotateEntity(e, deg) {
    const p = this.player;
    const T = TILE_SIZE;
    const riding = this.isRiding(e);
    e.angle += deg;
    if (!riding) return this.pushOut(e);
    const cx = (e.x + 0.5) * T;
    const cy = (e.y + 0.5) * T;
    const fx = p.x + p.w / 2 - cx;
    const fy = p.y + p.h - cy;
    const c = Math.cos(deg * DEG);
    const s = Math.sin(deg * DEG);
    this.moveX(cx + fx * c - fy * s - (p.x + p.w / 2), { ignore: e });
    this.moveY(cy + fx * s + fy * c - (p.y + p.h), { ignore: e });
    this.reland(e);
    this.pushOut(e);
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
      pxColor: (i) => {
        const c = (e.pixels || e.tile.design.pixels)[pixelIndex(i)];
        return c && c !== CLEAR ? c : ''; // 투명·빈 픽셀은 ""
      },
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
        this.pushOut(e);
      },
      rot: (deg) => this.rotateEntity(e, num(deg, 'rot')),
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
        const value = String(color).toLowerCase();
        if (!/^#[0-9a-f]{6}$/.test(value)) throw new Error(`색은 #ff0000처럼 써야 합니다. (지금 ${color})`);
        e.pixels = e.pixels || e.tile.design.pixels.slice();
        e.pixels[index] = value;
        e.pixelsVersion++;
        this.pushOut(e);
      },
      disapp: () => {
        e.visible = false;
      },
      appear: () => {
        e.visible = true;
        this.pushOut(e);
      },
      noKey: (name) => keyCodes(name).forEach((c) => this.blockedKeys.add(c)),
      yesKey: (name) => keyCodes(name).forEach((c) => this.blockedKeys.delete(c)),
      caTp: (x, y) => {
        this.placeAt({ x: num(x, 'caTp'), y: num(y, 'caTp') });
      },
      kill: () => this.die(),
      // 지금 상태(위치·각도·투명도·숨김·픽셀·변환·변수)와 월드 공통 변수를 저장 → 죽어도 이 상태에서 다시 시작
      perm: () => {
        e.saved = this.snapshot(e);
        this.savedShared = { ...this.shared };
      },
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
