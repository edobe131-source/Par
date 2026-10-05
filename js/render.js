// 캔버스 그리기. 플레이와 에디터가 함께 쓴다.

const VIEW_W = 960;
const VIEW_H = 540;

// 카메라 좌상단 좌표를 맵 범위(+여백) 안으로 제한. 맵이 화면보다 작으면 가운데 정렬.
function clampCamera(map, x, y, margin = 0) {
  const clampAxis = (v, mapSize, view) =>
    mapSize + margin * 2 <= view
      ? (mapSize - view) / 2
      : Math.min(Math.max(v, -margin), mapSize - view + margin);
  return {
    x: clampAxis(x, map.width * TILE_SIZE, VIEW_W),
    y: clampAxis(y, map.height * TILE_SIZE, VIEW_H),
  };
}

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

  tiles(ctx, map, camX, camY) {
    const T = TILE_SIZE;
    const x0 = Math.max(0, Math.floor(camX / T));
    const x1 = Math.min(map.width - 1, Math.floor((camX + VIEW_W) / T));
    const y0 = Math.max(0, Math.floor(camY / T));
    const y1 = Math.min(map.height - 1, Math.floor((camY + VIEW_H) / T));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const tile = map.rows[y][x];
        const sx = x * T - camX;
        const sy = y * T - camY;
        if (tile === Tile.BLOCK) this.block(ctx, sx, sy, map.get(x, y - 1) !== Tile.BLOCK);
        else if (tile === Tile.START) this.startFlag(ctx, sx, sy);
      }
    }
  },

  // 위가 비어 있는 블록은 윗면에 잔디를 그린다 (같은 일반 블록, 모양만 다름).
  block(ctx, sx, sy, grassTop) {
    const T = TILE_SIZE;
    ctx.fillStyle = '#9a6640';
    ctx.fillRect(sx, sy, T, T);
    ctx.fillStyle = '#7e5032';
    ctx.fillRect(sx + 6, sy + 14, 4, 4);
    ctx.fillRect(sx + 20, sy + 22, 4, 4);
    ctx.fillRect(sx + 14, sy + 6, 3, 3);
    if (grassTop) {
      ctx.fillStyle = '#4caf50';
      ctx.fillRect(sx, sy, T, 8);
      ctx.fillStyle = '#7bd67f';
      ctx.fillRect(sx, sy, T, 3);
    }
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, sy + 0.5, T - 1, T - 1);
  },

  startFlag(ctx, sx, sy) {
    ctx.fillStyle = '#5b5b66';
    ctx.fillRect(sx + 9, sy + 3, 3, TILE_SIZE - 3);
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(sx + 12, sy + 3);
    ctx.lineTo(sx + 27, sy + 9);
    ctx.lineTo(sx + 12, sy + 15);
    ctx.closePath();
    ctx.fill();
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

  grid(ctx, map, camX, camY) {
    const T = TILE_SIZE;
    const left = -camX;
    const top = -camY;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= map.width; x++) {
      const sx = Math.round(left + x * T) + 0.5;
      if (sx < 0 || sx > VIEW_W) continue;
      ctx.moveTo(sx, top);
      ctx.lineTo(sx, top + map.height * T);
    }
    for (let y = 0; y <= map.height; y++) {
      const sy = Math.round(top + y * T) + 0.5;
      if (sy < 0 || sy > VIEW_H) continue;
      ctx.moveTo(left, sy);
      ctx.lineTo(left + map.width * T, sy);
    }
    ctx.stroke();
  },

  // 에디터: 맵 바깥 영역을 어둡게 하고 경계선을 그린다.
  outsideMap(ctx, map, camX, camY) {
    const w = map.width * TILE_SIZE;
    const h = map.height * TILE_SIZE;
    ctx.fillStyle = 'rgba(15, 18, 32, 0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.rect(-camX, -camY, w, h);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = 2;
    ctx.strokeRect(-camX - 1, -camY - 1, w + 2, h + 2);
  },

  cursor(ctx, cell, tool, camX, camY) {
    const sx = cell.x * TILE_SIZE - camX;
    const sy = cell.y * TILE_SIZE - camY;
    ctx.save();
    ctx.globalAlpha = 0.5;
    if (tool === 'block') this.block(ctx, sx, sy, true);
    else if (tool === 'start') this.startFlag(ctx, sx, sy);
    ctx.restore();
    ctx.strokeStyle = tool === 'erase' ? '#ff5252' : '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, sy + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  },
};
