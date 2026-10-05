// 캔버스 그리기. 플레이와 에디터가 함께 쓴다.

const VIEW_W = 960;
const VIEW_H = 540;

const Render = {
  background(ctx, camX) {
    if (!this.sky) {
      this.sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
      this.sky.addColorStop(0, '#5ab8f5');
      this.sky.addColorStop(1, '#cbeeff');
    }
    ctx.fillStyle = this.sky;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    this.hills(ctx, camX * 0.2, 360, 70, 0.006, '#a6dcb9');
    this.hills(ctx, camX * 0.45, 420, 50, 0.011, '#80c99a');
  },

  hills(ctx, offset, baseY, amp, freq, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, VIEW_H);
    for (let x = 0; x <= VIEW_W; x += 16) {
      const wx = x + offset;
      ctx.lineTo(x, baseY - amp * (0.5 + 0.5 * Math.sin(wx * freq)) - amp * 0.3 * Math.sin(wx * freq * 2.7));
    }
    ctx.lineTo(VIEW_W, VIEW_H);
    ctx.closePath();
    ctx.fill();
  },

  // info: 플레이 중이면 { progress, currentKey } (먹은 별 숨김, 체크포인트 등록 표시), 에디터면 null
  tiles(ctx, map, camX, camY, info = null) {
    const T = TILE_SIZE;
    const x0 = Math.floor(camX / T);
    const x1 = Math.floor((camX + VIEW_W) / T);
    const y0 = Math.floor(camY / T);
    const y1 = Math.floor((camY + VIEW_H) / T);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const tile = map.get(x, y);
        if (tile) this.tile(ctx, tile, x * T - camX, y * T - camY, cellKey(x, y), info);
      }
    }
  },

  tile(ctx, tile, sx, sy, key, info) {
    switch (tile.kind) {
      case 'design': {
        const offset = tile.design.type === 'spike1' ? Math.round(((tile.pos - 1) * TILE_SIZE) / 3) : 0;
        ctx.drawImage(DesignArt.tile(tile.design), sx + offset, sy);
        break;
      }
      case 'start':
        this.flag(ctx, sx, sy, '#ffd23f', info?.currentKey === key);
        break;
      case 'checkpoint': {
        const on = !info || info.progress.checkpoints.has(key);
        this.flag(ctx, sx, sy, on ? '#4cd964' : '#9aa0ad', info?.currentKey === key);
        break;
      }
      case 'star':
        if (!info || !info.progress.stars.has(key)) this.star(ctx, sx, sy);
        break;
    }
  },

  // current: 지금 부활 지점이면 깃대 끝에 흰 점
  flag(ctx, sx, sy, color, current = false) {
    ctx.fillStyle = '#5b5b66';
    ctx.fillRect(sx + 9, sy + 3, 3, TILE_SIZE - 3);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(sx + 12, sy + 3);
    ctx.lineTo(sx + 27, sy + 9);
    ctx.lineTo(sx + 12, sy + 15);
    ctx.closePath();
    ctx.fill();
    if (current) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(sx + 10.5, sy + 3, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  star(ctx, sx, sy) {
    const cx = sx + TILE_SIZE / 2;
    const cy = sy + TILE_SIZE / 2 + 1;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 5 : 12;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = '#ffd23f';
    ctx.fill();
    ctx.strokeStyle = '#d99a00';
    ctx.lineWidth = 2;
    ctx.stroke();
  },

  eraser(ctx, sx, sy) {
    ctx.strokeStyle = '#ff5252';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sx + 8, sy + 8);
    ctx.lineTo(sx + 24, sy + 24);
    ctx.moveTo(sx + 24, sy + 8);
    ctx.lineTo(sx + 8, sy + 24);
    ctx.stroke();
  },

  player(ctx, p, camX, camY) {
    const x = Math.round(p.x - camX);
    const y = Math.round(p.y - camY);
    ctx.fillStyle = '#ff6b4a';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, p.w, p.h, 6);
    else ctx.rect(x, y, p.w, p.h);
    ctx.fill();
    // 눈은 바라보는 방향으로 치우치게
    const eyeX = p.facing > 0 ? x + 11 : x + 3;
    ctx.fillStyle = '#fff';
    ctx.fillRect(eyeX, y + 7, 4, 7);
    ctx.fillRect(eyeX + 6, y + 7, 4, 7);
    ctx.fillStyle = '#222';
    const pupil = p.facing > 0 ? 2 : 0;
    ctx.fillRect(eyeX + pupil, y + 9, 2, 4);
    ctx.fillRect(eyeX + 6 + pupil, y + 9, 2, 4);
  },

  // 에디터 격자 (무한). 원점(0, 0)을 지나는 선은 진하게.
  grid(ctx, camX, camY) {
    const T = TILE_SIZE;
    const x0 = Math.floor(camX / T);
    const y0 = Math.floor(camY / T);
    const lines = (strong) => {
      ctx.beginPath();
      for (let x = x0; x * T - camX <= VIEW_W; x++) {
        if ((x === 0) !== strong) continue;
        const sx = x * T - camX + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, VIEW_H);
      }
      for (let y = y0; y * T - camY <= VIEW_H; y++) {
        if ((y === 0) !== strong) continue;
        const sy = y * T - camY + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(VIEW_W, sy);
      }
      ctx.stroke();
    };
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    lines(false);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    lines(true);
  },

  // 에디터: 마우스가 가리키는 칸에 놓일 모습을 반투명하게
  cursor(ctx, x, y, tool, spikePos, camX, camY) {
    const sx = x * TILE_SIZE - camX;
    const sy = y * TILE_SIZE - camY;
    if (tool.kind !== 'erase') {
      ctx.save();
      ctx.globalAlpha = 0.55;
      const tile = tool.kind === 'design' ? designTile(tool.design, spikePos) : SPECIAL_TILES[tool.kind];
      this.tile(ctx, tile, sx, sy, cellKey(x, y), null);
      ctx.restore();
    }
    ctx.strokeStyle = tool.kind === 'erase' ? '#ff5252' : '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, sy + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  },
};
