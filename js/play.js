// 플레이 세션: 플레이어 물리, 타일 충돌, 체크포인트·별·가시, 카메라.

const PHYS = {
  gravity: 2200,
  maxFall: 950,
  moveSpeed: 270,
  groundAccel: 2600,
  groundFriction: 2800,
  airAccel: 1700,
  airFriction: 600,
  jumpSpeed: 760, // 최고 높이 약 4칸
  jumpCut: 0.45, // 점프 키를 일찍 떼면 상승 속도를 줄여 낮게 뜀
  coyoteTime: 0.1,
  jumpBuffer: 0.12,
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

class PlaySession {
  // onProgress: 진행 상황이 바뀔 때 호출 (저장용). 테스트 플레이에서는 생략.
  constructor(map, progress = new Progress(), onProgress = null) {
    this.map = map;
    this.progress = progress;
    this.onProgress = onProgress;
    this.player = {
      w: 22, h: 28, x: 0, y: 0, vx: 0, vy: 0,
      facing: 1, onGround: false, coyote: 0, jumpBuffer: 0, jumpCut: false,
    };
    this.cam = { x: 0, y: 0 };
    this.flash = 0; // 사망 시 화면 붉게

    const bottom = (map.bounds().maxY + 1) * TILE_SIZE;
    this.deathY = bottom + FALL_DEATH_DEPTH * TILE_SIZE;
    this.camMaxY = bottom - VIEW_H; // 맵 아래 허공은 비추지 않음

    this.starKeys = map.positions('star').map((p) => cellKey(p.x, p.y));
    // 스타트 + 체크포인트 (번호는 왼쪽부터)
    this.checkpointList = [
      { ...map.start, key: cellKey(map.start.x, map.start.y), label: '시작 지점', isStart: true },
      ...map.positions('checkpoint').map((p, i) => ({ ...p, key: cellKey(p.x, p.y), label: `체크포인트 ${i + 1}` })),
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
    return !this.player.onGround && this.player.vy > 0;
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
    p.onGround = false;
    p.coyote = p.jumpBuffer = 0;
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

  update(dt) {
    const p = this.player;
    this.flash = Math.max(0, this.flash - dt);
    if (Input.wasPressed('KeyR')) this.respawn();

    const dir = (Input.isDown('ArrowRight', 'KeyD') ? 1 : 0) - (Input.isDown('ArrowLeft', 'KeyA') ? 1 : 0);
    if (dir) p.facing = dir;
    const accel = dir
      ? (p.onGround ? PHYS.groundAccel : PHYS.airAccel)
      : (p.onGround ? PHYS.groundFriction : PHYS.airFriction);
    p.vx = approach(p.vx, dir * PHYS.moveSpeed, accel * dt);

    p.jumpBuffer = Input.wasPressed(...JUMP_KEYS) ? PHYS.jumpBuffer : Math.max(0, p.jumpBuffer - dt);
    p.coyote = p.onGround ? PHYS.coyoteTime : Math.max(0, p.coyote - dt);
    if (p.jumpBuffer > 0 && p.coyote > 0) {
      p.vy = -PHYS.jumpSpeed;
      p.jumpBuffer = p.coyote = 0;
      p.jumpCut = false;
    }
    if (p.vy < 0 && !p.jumpCut && !Input.isDown(...JUMP_KEYS)) {
      p.vy *= PHYS.jumpCut;
      p.jumpCut = true;
    }

    p.vy = Math.min(p.vy + PHYS.gravity * dt, PHYS.maxFall);
    this.moveX(p.vx * dt);
    this.moveY(p.vy * dt);

    if (this.touchTiles()) return;
    if (p.y > this.deathY) return this.die();

    const target = this.cameraTarget();
    const k = 1 - Math.exp(-dt * 10);
    this.cam.x += (target.x - this.cam.x) * k;
    this.cam.y += (target.y - this.cam.y) * k;
  }

  // 겹친 칸 처리: 가시 → 사망, 별 → 획득, 체크포인트 → 등록. 죽었으면 true.
  touchTiles() {
    const p = this.player;
    const body = { x: p.x, y: p.y, w: p.w, h: p.h };
    const hurt = { x: p.x + 2, y: p.y + 2, w: p.w - 4, h: p.h - 3 }; // 가시 판정은 조금 너그럽게
    const x0 = Math.floor(p.x / TILE_SIZE);
    const x1 = Math.floor((p.x + p.w - EPS) / TILE_SIZE);
    const y0 = Math.floor(p.y / TILE_SIZE);
    const y1 = Math.floor((p.y + p.h - EPS) / TILE_SIZE);

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const tile = this.map.get(tx, ty);
        if (!tile) continue;

        if (tile.kind === 'design') {
          if (!DesignTypes[tile.design.type].hazard) continue;
          const tris = Shapes.triangles(tile.design.type, tile.pos)
            .map((tri) => tri.map(([u, v]) => [(tx + u) * TILE_SIZE, (ty + v) * TILE_SIZE]));
          if (tris.some((tri) => triangleHitsBox(tri, hurt))) {
            this.die();
            return true;
          }
        } else if (tile.kind === 'star') {
          const key = cellKey(tx, ty);
          const inner = { x: tx * TILE_SIZE + 6, y: ty * TILE_SIZE + 6, w: TILE_SIZE - 12, h: TILE_SIZE - 12 };
          if (!this.progress.stars.has(key) && boxesOverlap(body, inner)) {
            this.progress.stars.add(key);
            this.changed();
          }
        } else {
          // 스타트·체크포인트: 닿으면 등록되고 부활 지점이 된다.
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

  moveY(dy) {
    const p = this.player;
    p.y += dy;
    p.onGround = false;
    const left = Math.floor(p.x / TILE_SIZE);
    const right = Math.floor((p.x + p.w - EPS) / TILE_SIZE);
    if (dy > 0) {
      const ty = Math.floor((p.y + p.h - EPS) / TILE_SIZE);
      for (let tx = left; tx <= right; tx++) {
        if (this.map.isSolid(tx, ty)) { p.y = ty * TILE_SIZE - p.h; p.vy = 0; p.onGround = true; break; }
      }
    } else if (dy < 0) {
      const ty = Math.floor(p.y / TILE_SIZE);
      for (let tx = left; tx <= right; tx++) {
        if (this.map.isSolid(tx, ty)) { p.y = (ty + 1) * TILE_SIZE; p.vy = 0; break; }
      }
    }
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
    Render.background(ctx, camX);
    Render.tiles(ctx, this.map, camX, camY, { progress: this.progress, currentKey: this.currentCheckpoint().key });
    Render.player(ctx, this.player, camX, camY);
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 60, 60, ${this.flash})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }
}
