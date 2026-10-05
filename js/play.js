// 플레이 세션: 플레이어 물리, 특수 블록, 체크포인트·별·가시, 카메라.
//
// 플레이어 상태(mode)
//   normal: 걷기·점프·낙하 (구역, 얼음, 머신, 벽, 먹구름, 공점은 이 상태에서 처리)
//   climb:  사다리 타는 중
//   cloud:  구름에 파묻히는 중 → 바닥까지 내려가면 저절로 튀어오름
//   rope:   밧줄에 매달려 흔드는 중 (점프 키를 누르고 있는 동안)

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

class PlaySession {
  // onProgress: 진행 상황이 바뀔 때 호출 (저장용). 테스트 플레이에서는 생략.
  constructor(map, progress = new Progress(), onProgress = null) {
    this.map = map;
    this.progress = progress;
    this.onProgress = onProgress;
    this.player = {
      w: 22, h: 28, x: 0, y: 0, vx: 0, vy: 0, facing: 1, mode: 'normal',
      onGround: false, groundType: null, groundDir: 1,
      coyote: 0, jumpBuffer: 0, jumpCut: false, airJumps: 0,
    };
    this.cam = { x: 0, y: 0 };
    this.flash = 0; // 사망 시 화면 붉게
    this.cloud = null; // 파묻히는 중인 구름 { key, startY, endY, t }
    this.cloudPress = null; // 구름 눌림 연출 { key, amount }
    this.rope = null; // 매달린 밧줄 { r, d }
    this.ropeCooldown = 0;
    // 밧줄마다 흔들림 상태
    this.ropes = map.positions('rope').map(({ x, y, tile }) => ({ x, y, length: tile.length, key: cellKey(x, y), angle: 0, omega: 0 }));

    const bottom = (map.bounds().maxY + 1) * TILE_SIZE;
    this.deathY = bottom + FALL_DEATH_DEPTH * TILE_SIZE;
    this.camMaxY = bottom - VIEW_H; // 맵 아래 허공은 비추지 않음

    this.starKeys = map.positions('star').map((p) => cellKey(p.x, p.y));
    // 스타트 + 체크포인트 (번호는 왼쪽부터)
    this.checkpointList = [
      { ...map.start, key: cellKey(map.start.x, map.start.y), label: '시작 지점', isStart: true },
      ...map.positions('checkpoint').map((p, i) => ({ x: p.x, y: p.y, key: cellKey(p.x, p.y), label: `체크포인트 ${i + 1}` })),
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
    this.placeAt(this.currentCheckpoint());
  }

  die() {
    this.flash = 0.35;
    this.respawn();
  }

  placeAt({ x, y }) {
    const p = this.player;
    p.x = x * TILE_SIZE + (TILE_SIZE - p.w) / 2;
    p.y = (y + 1) * TILE_SIZE - p.h;
    p.vx = p.vy = 0;
    p.mode = 'normal';
    p.onGround = false;
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

  // ---- 매 스텝 ----

  update(dt) {
    const p = this.player;
    this.flash = Math.max(0, this.flash - dt);
    this.ropeCooldown = Math.max(0, this.ropeCooldown - dt);
    if (this.cloudPress && !this.cloud) {
      this.cloudPress.amount -= dt * 5;
      if (this.cloudPress.amount <= 0) this.cloudPress = null;
    }
    this.swingFreeRopes(dt);
    if (Input.wasPressed('KeyR')) this.respawn();

    const env = this.sense();
    // 사다리에 겹쳐 있으면 ↑/W는 오르기에 쓰고 점프는 Space로만
    const jumpKeys = env.ladder && p.mode !== 'rope' ? ['Space'] : JUMP_KEYS;
    const input = {
      dir: (Input.isDown('ArrowRight', 'KeyD') ? 1 : 0) - (Input.isDown('ArrowLeft', 'KeyA') ? 1 : 0),
      up: Input.isDown('ArrowUp', 'KeyW'),
      down: Input.isDown('ArrowDown', 'KeyS'),
      jumpPressed: Input.wasPressed(...jumpKeys),
      jumpHeld: Input.isDown(...jumpKeys),
    };
    if (input.dir) p.facing = input.dir;

    if (p.mode === 'rope') this.updateRope(dt, input);
    else if (p.mode === 'cloud') this.updateCloud(dt, input);
    else {
      this.updateMove(dt, input, env);
      this.tryGrabRope(input);
    }

    if (this.touchTiles()) return;
    if (p.y > this.deathY) return this.die();

    const target = this.cameraTarget();
    const k = 1 - Math.exp(-dt * 10);
    this.cam.x += (target.x - this.cam.x) * k;
    this.cam.y += (target.y - this.cam.y) * k;
  }

  // 플레이어 주변 상황
  sense() {
    const p = this.player;
    const T = TILE_SIZE;
    const map = this.map;
    const env = { double: false, infinite: false, airjump: false, darkcloud: false, ladder: false };
    const body = { x: p.x, y: p.y, w: p.w, h: p.h };
    const x0 = Math.floor(p.x / T), x1 = Math.floor((p.x + p.w - EPS) / T);
    const y0 = Math.floor(p.y / T), y1 = Math.floor((p.y + p.h - EPS) / T);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const zone = map.zone(tx, ty);
        if (zone === 'double') env.double = true;
        if (zone === 'infinite') env.infinite = true;
        const type = map.designType(tx, ty);
        if (type === 'darkcloud') env.darkcloud = true;
        if (type === 'airjump' && boxesOverlap(body, { x: tx * T + 4, y: ty * T + 4, w: T - 8, h: T - 8 })) env.airjump = true;
      }
    }
    // 물은 몸 중심 기준, 머리가 물 밖이면 수면
    const cx = Math.floor((p.x + p.w / 2) / T);
    env.water = map.zone(cx, Math.floor((p.y + p.h / 2) / T)) === 'water';
    env.headOut = map.zone(cx, Math.floor((p.y + 2) / T)) !== 'water';
    // 사다리는 몸 중심 세로줄 기준
    for (let ty = y0; ty <= y1; ty++) if (map.designType(cx, ty) === 'ladder') env.ladder = true;
    env.ladderBelow = map.designType(cx, Math.floor((p.y + p.h + 1) / T)) === 'ladder';
    // 벽: 몸 옆면이 벽 블록에 딱 붙어 있음
    const isWall = (tx) => {
      for (let ty = y0; ty <= y1; ty++) if (map.designType(tx, ty) === 'wall') return true;
      return false;
    };
    env.wall = isWall(Math.floor((p.x - 0.5) / T)) || isWall(Math.floor((p.x + p.w + 0.5) / T));
    return env;
  }

  jump(speed, noCut = false) {
    const p = this.player;
    p.vy = -speed;
    p.jumpBuffer = p.coyote = 0;
    p.jumpCut = noCut;
    p.onGround = false;
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
        } else {
          // 좌우 입력이 없으면 사다리 가운데로 붙는다 (옆 블록에 머리가 걸리지 않게)
          const col = Math.floor((p.x + p.w / 2) / TILE_SIZE);
          const target = col * TILE_SIZE + (TILE_SIZE - p.w) / 2;
          p.vx = 0;
          this.moveX(approach(p.x, target, 200 * dt) - p.x);
        }
        p.vy = ((input.down ? 1 : 0) - (input.up ? 1 : 0)) * PHYS.climbSpeed;
        p.airJumps = 0;
        this.moveY(p.vy * dt, true);
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
    const k = Math.min(1, c.t / PHYS.cloudSinkTime);
    const ease = 1 - (1 - k) * (1 - k);
    p.y = c.startY + (c.endY - c.startY) * ease; // 끝에선 캐릭터가 구름 칸 안에 완전히 겹침
    this.cloudPress = { key: c.key, amount: ease };
    if (k >= 1) {
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
    const p = this.player;
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

  boxHitsSolid(x, y) {
    const p = this.player;
    const T = TILE_SIZE;
    for (let ty = Math.floor(y / T); ty <= Math.floor((y + p.h - EPS) / T); ty++) {
      for (let tx = Math.floor(x / T); tx <= Math.floor((x + p.w - EPS) / T); tx++) {
        if (this.map.isSolid(tx, ty)) return true;
      }
    }
    return false;
  }

  // 겹친 칸 처리: 가시 → 사망, 별 → 획득, 체크포인트 → 등록. 죽었으면 true.
  touchTiles() {
    const p = this.player;
    const T = TILE_SIZE;
    const body = { x: p.x, y: p.y, w: p.w, h: p.h };
    const hurt = { x: p.x + 2, y: p.y + 2, w: p.w - 4, h: p.h - 3 }; // 가시 판정은 조금 너그럽게
    const x0 = Math.floor(p.x / T), x1 = Math.floor((p.x + p.w - EPS) / T);
    const y0 = Math.floor(p.y / T), y1 = Math.floor((p.y + p.h - EPS) / T);

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const tile = this.map.get(tx, ty);
        if (!tile) continue;

        if (tile.kind === 'design') {
          if (!DesignTypes[tile.design.type].hazard) continue;
          const tris = Shapes.triangles(tile.design.type, tile.pos, tile.rot)
            .map((tri) => tri.map(([u, v]) => [(tx + u) * T, (ty + v) * T]));
          if (tris.some((tri) => triangleHitsBox(tri, hurt))) {
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

  // 한 스텝 이동량이 칸 크기보다 작으므로 진행 방향의 앞쪽 가장자리만 검사하면 된다.
  moveX(dx) {
    const p = this.player;
    p.x += dx;
    const top = Math.floor(p.y / TILE_SIZE);
    const bottom = Math.floor((p.y + p.h - EPS) / TILE_SIZE);
    if (dx > 0) {
      const tx = Math.floor((p.x + p.w - EPS) / TILE_SIZE);
      for (let ty = top; ty <= bottom; ty++) {
        if (this.map.isSolid(tx, ty)) { p.x = tx * TILE_SIZE - p.w; p.vx = 0; break; }
      }
    } else if (dx < 0) {
      const tx = Math.floor(p.x / TILE_SIZE);
      for (let ty = top; ty <= bottom; ty++) {
        if (this.map.isSolid(tx, ty)) { p.x = (tx + 1) * TILE_SIZE; p.vx = 0; break; }
      }
    }
  }

  // climbing: 사다리 타는 중이면 사다리 꼭대기를 발판으로 쓰지 않음
  moveY(dy, climbing = false) {
    const p = this.player;
    const T = TILE_SIZE;
    const prevBottom = p.y + p.h;
    p.y += dy;
    p.onGround = false;
    const left = Math.floor(p.x / T);
    const right = Math.floor((p.x + p.w - EPS) / T);
    if (dy > 0) {
      const ty = Math.floor((p.y + p.h - EPS) / T);
      const top = ty * T;
      for (let tx = left; tx <= right; tx++) {
        if (this.map.isSolid(tx, ty)) return this.land(top, ty);
      }
      if (prevBottom > top + EPS) return; // 이번에 윗면을 넘어온 게 아님
      for (let tx = left; tx <= right; tx++) {
        const type = this.map.designType(tx, ty);
        if (type === 'cloud' && !climbing) {
          // 구름 윗면에 닿음 → 파묻히기 시작
          p.y = top - p.h;
          p.vy = 0;
          p.mode = 'cloud';
          this.cloud = { key: cellKey(tx, ty), startY: p.y, endY: (ty + 1) * T - p.h, t: 0 };
          return;
        }
        // 사다리 꼭대기는 위에서 내려올 때 밟을 수 있는 발판
        if (type === 'ladder' && !climbing && this.map.designType(tx, ty - 1) !== 'ladder') return this.land(top, ty);
      }
    } else if (dy < 0) {
      const ty = Math.floor(p.y / T);
      for (let tx = left; tx <= right; tx++) {
        if (this.map.isSolid(tx, ty)) { p.y = (ty + 1) * T; p.vy = 0; break; }
      }
    }
  }

  land(top, ty) {
    const p = this.player;
    p.y = top - p.h;
    p.vy = 0;
    p.onGround = true;
    // 발밑 블록 종류 (얼음·머신 판정용): 몸 중심 아래를 우선
    const T = TILE_SIZE;
    const cx = Math.floor((p.x + p.w / 2) / T);
    let tile = this.map.get(cx, ty);
    if (!tile || tile.kind !== 'design') {
      for (let tx = Math.floor(p.x / T); tx <= Math.floor((p.x + p.w - EPS) / T); tx++) {
        const t = this.map.get(tx, ty);
        if (t && t.kind === 'design') tile = t;
      }
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

  render(ctx) {
    const camX = Math.round(this.cam.x);
    const camY = Math.round(this.cam.y);
    Render.background(ctx, this.map.background, camX);
    const info = { progress: this.progress, currentKey: this.currentCheckpoint().key, cloudPress: this.cloudPress };
    Render.tiles(ctx, this.map, camX, camY, info);
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
