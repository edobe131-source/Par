// 플레이 세션: 플레이어 물리, 타일 충돌, 카메라.

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

const approach = (value, target, delta) =>
  value < target ? Math.min(value + delta, target) : Math.max(value - delta, target);

class PlaySession {
  constructor(map) {
    this.map = map;
    this.player = {
      w: 22, h: 28, x: 0, y: 0, vx: 0, vy: 0,
      facing: 1, onGround: false, coyote: 0, jumpBuffer: 0, jumpCut: false,
    };
    this.cam = { x: 0, y: 0 };
    this.respawn();
  }

  respawn() {
    const p = this.player;
    const start = this.map.findStart();
    p.x = start.x * TILE_SIZE + (TILE_SIZE - p.w) / 2;
    p.y = (start.y + 1) * TILE_SIZE - p.h;
    p.vx = p.vy = 0;
    p.onGround = false;
    p.coyote = p.jumpBuffer = 0;
    this.cam = this.cameraTarget();
  }

  update(dt) {
    const p = this.player;
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

    if (p.y > this.map.height * TILE_SIZE + 160) this.respawn();

    const target = this.cameraTarget();
    const k = 1 - Math.exp(-dt * 10);
    this.cam.x += (target.x - this.cam.x) * k;
    this.cam.y += (target.y - this.cam.y) * k;
  }

  // 한 스텝 이동량이 타일 크기보다 작으므로 진행 방향의 앞쪽 가장자리만 검사하면 된다.
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
    return clampCamera(this.map, p.x + p.w / 2 - VIEW_W / 2, p.y + p.h / 2 - VIEW_H * 0.55);
  }

  render(ctx) {
    const camX = Math.round(this.cam.x);
    const camY = Math.round(this.cam.y);
    Render.background(ctx, camX);
    Render.tiles(ctx, this.map, camX, camY);
    Render.player(ctx, this.player, camX, camY);
  }
}
