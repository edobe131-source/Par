// 캔버스 그리기. 플레이와 에디터가 함께 쓴다.

const Render = {
  time: 0, // 초 단위. 머신 띠, 밤하늘 별 반짝임 등 움직이는 그림용 (main에서 매 프레임 갱신)

  background(ctx, bg, camX) {
    Backgrounds.draw(ctx, bg, camX);
  },

  // 화면에 보이는 칸 범위
  visible(camX, camY) {
    const T = TILE_SIZE;
    return {
      x0: Math.floor(camX / T), x1: Math.floor((camX + VIEW_W) / T),
      y0: Math.floor(camY / T), y1: Math.floor((camY + VIEW_H) / T),
    };
  },

  // info: 플레이 중이면 { progress, currentKey, cloudPress } (먹은 별 숨김, 체크포인트 등록 표시 등), 에디터면 null
  tiles(ctx, map, camX, camY, info = null) {
    const T = TILE_SIZE;
    const { x0, x1, y0, y1 } = this.visible(camX, camY);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const tile = map.get(x, y);
        if (tile) this.tile(ctx, tile, x * T - camX, y * T - camY, cellKey(x, y), info);
      }
    }
  },

  tile(ctx, tile, sx, sy, key, info) {
    const T = TILE_SIZE;
    switch (tile.kind) {
      case 'design': {
        const type = tile.design.type;
        const art = DesignArt.tile(tile.design);
        if (type === 'machine') this.machine(ctx, art, sx, sy, tile.dir);
        else if (type === 'cloud') {
          const press = info?.cloudPress?.key === key ? info.cloudPress.amount : 0;
          ctx.drawImage(art, sx, sy + Math.round(press * 6));
        } else if (DesignTypes[type].rotatable) {
          const offset = type === 'spike1' ? Math.round(((tile.pos - 1) * T) / 3) : 0;
          ctx.save();
          ctx.translate(sx + T / 2, sy + T / 2);
          ctx.rotate((tile.rot * Math.PI) / 2);
          ctx.drawImage(art, -T / 2 + offset, -T / 2);
          ctx.restore();
        } else ctx.drawImage(art, sx, sy);
        if (!info && tile.design.code) this.codeBadge(ctx, sx, sy); // 에디터: 코드가 든 블록 표시
        break;
      }
      case 'start':
        this.flag(ctx, sx, sy, '#ffd23f', info?.currentKey === key);
        break;
      case 'checkpoint': {
        const on = !info || info.progress.checkpoints.has(key);
        this.flag(ctx, sx, sy, on ? '#4cd964' : '#9aa0ad', info?.currentKey === key);
        if (tile.name) this.label(ctx, tile.name, sx + T / 2, sy - 3);
        break;
      }
      case 'star':
        if (!info || !info.progress.stars.has(key)) this.star(ctx, sx, sy);
        break;
      case 'rope':
        break; // 밧줄은 ropes()에서 따로 그림 (고정점보다 아래까지 늘어지므로)
    }
  },

  // 코드 블록(움직이는 블록): 코드로 돌린 각도·투명도·바꾼 픽셀까지 반영
  entities(ctx, entities, camX, camY, info) {
    const T = TILE_SIZE;
    for (const e of entities) {
      if (!e.visible || e.tran >= 100) continue;
      const sx = e.x * T - camX;
      const sy = e.y * T - camY;
      if (sx < -T * 2 || sx > VIEW_W + T || sy < -T * 2 || sy > VIEW_H + T) continue;
      const type = e.type;
      let art;
      if (e.pixels) {
        if (!e.art || e.art.version !== e.pixelsVersion || e.art.design !== e.tile.design) {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = T;
          DesignArt.draw(canvas.getContext('2d'), { type, pixels: e.pixels }, 0, 0, T);
          e.art = { version: e.pixelsVersion, design: e.tile.design, canvas };
        }
        art = e.art.canvas;
      } else art = DesignArt.tile(e.tile.design);
      const press = info?.cloudPress?.entity === e ? Math.round(info.cloudPress.amount * 6) : 0;
      ctx.save();
      ctx.globalAlpha = 1 - e.tran / 100;
      ctx.translate(sx + T / 2, sy + T / 2 + press);
      ctx.rotate((e.tile.rot * 90 + e.angle) * DEG);
      if (type === 'machine') this.machine(ctx, art, -T / 2, -T / 2, e.tile.dir);
      else ctx.drawImage(art, -T / 2 + (type === 'spike1' ? Math.round(((e.tile.pos - 1) * T) / 3) : 0), -T / 2);
      ctx.restore();
    }
  },

  // 머신: 그림이 진행 방향으로 흘러간다. 왼쪽 방향이면 좌우 반전.
  machine(ctx, art, sx, sy, dir) {
    const T = TILE_SIZE;
    const offset = (this.time * PHYS.conveyorSpeed * 0.5) % T;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, sy, T, T);
    ctx.clip();
    ctx.translate(dir ? sx : sx + T, sy);
    if (!dir) ctx.scale(-1, 1);
    ctx.drawImage(art, offset, 0);
    ctx.drawImage(art, offset - T, 0);
    ctx.restore();
  },

  // ropes: [{ x, y, length, angle }] (플레이 중엔 흔들리는 각도 포함)
  ropes(ctx, ropes, camX, camY) {
    for (const r of ropes) this.rope(ctx, r.x, r.y, r.length, r.angle || 0, camX, camY);
  },

  rope(ctx, x, y, length, angle, camX, camY) {
    const px = x * TILE_SIZE + TILE_SIZE / 2 - camX;
    const py = y * TILE_SIZE + 6 - camY;
    const L = length * TILE_SIZE - 8;
    const ex = px + Math.sin(angle) * L;
    const ey = py + Math.cos(angle) * L;
    if (Math.max(px, ex) < -20 || Math.min(px, ex) > VIEW_W + 20 || Math.max(py, ey) < -20 || Math.min(py, ey) > VIEW_H + 20) return;
    ctx.strokeStyle = '#a0703f';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#5b3a1e';
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c48a52';
    ctx.beginPath();
    ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
    ctx.fill();
  },

  // only: 그릴 구역 종류 목록 (생략하면 전부)
  zones(ctx, map, camX, camY, only = null) {
    const T = TILE_SIZE;
    const { x0, x1, y0, y1 } = this.visible(camX, camY);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const zone = map.zone(x, y);
        if (!zone || (only && !only.includes(zone))) continue;
        const sx = x * T - camX;
        const sy = y * T - camY;
        ctx.fillStyle = ZoneTypes[zone].color;
        ctx.fillRect(sx, sy, T, T);
        if (zone === 'water' && map.zone(x, y - 1) !== 'water') {
          ctx.fillStyle = 'rgba(200, 235, 255, 0.7)'; // 수면
          ctx.fillRect(sx, sy, T, 3);
        }
      }
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

  // 작은 글씨 이름표 (체크포인트 이름 등)
  label(ctx, text, cx, bottomY) {
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.strokeText(text, cx, bottomY);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, cx, bottomY);
  },

  codeBadge(ctx, sx, sy) {
    ctx.fillStyle = 'rgba(20, 24, 40, 0.85)';
    ctx.fillRect(sx + TILE_SIZE - 15, sy + 1, 14, 10);
    ctx.font = 'bold 9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('{}', sx + TILE_SIZE - 8, sy + 6.5);
  },

  // 에디터: 블록마다 블록 태그 번호
  tags(ctx, map, camX, camY) {
    const T = TILE_SIZE;
    const { x0, x1, y0, y1 } = this.visible(camX, camY);
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const tile = map.get(x, y);
        if (!tile || tile.kind !== 'design') continue;
        const text = String(tile.design.tag);
        const sx = x * T - camX;
        const sy = y * T - camY;
        const w = ctx.measureText(text).width + 4;
        ctx.fillStyle = 'rgba(20, 24, 40, 0.8)';
        ctx.fillRect(sx + 1, sy + T - 13, w, 12);
        ctx.fillStyle = '#7fe0ff';
        ctx.fillText(text, sx + 3, sy + T - 1);
      }
    }
  },

  // 에디터: 선택 영역 { x0, y0, x1, y1 } (칸, 끝 포함)
  selection(ctx, sel, camX, camY) {
    const T = TILE_SIZE;
    const x = sel.x0 * T - camX;
    const y = sel.y0 * T - camY;
    const w = (sel.x1 - sel.x0 + 1) * T;
    const h = (sel.y1 - sel.y0 + 1) * T;
    ctx.fillStyle = 'rgba(80, 170, 255, 0.15)';
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -this.time * 20;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  },

  // 에디터: 복사한 영역을 (x, y)를 왼쪽 위로 해서 반투명하게
  clipboard(ctx, clip, x, y, camX, camY) {
    const T = TILE_SIZE;
    ctx.save();
    ctx.globalAlpha = 0.55;
    for (const c of clip.cells) {
      const sx = (x + c.dx) * T - camX;
      const sy = (y + c.dy) * T - camY;
      if (c.zone) {
        ctx.fillStyle = ZoneTypes[c.zone].color;
        ctx.fillRect(sx, sy, T, T);
      }
      if (c.tile?.kind === 'rope') this.rope(ctx, x + c.dx, y + c.dy, c.tile.length, 0, camX, camY);
      else if (c.tile) this.tile(ctx, c.tile, sx, sy, '', null);
    }
    ctx.restore();
    ctx.strokeStyle = '#7fe0ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x * T - camX + 1, y * T - camY + 1, clip.w * T - 2, clip.h * T - 2);
  },

  // 선택 도구 아이콘: 점선 사각형과 화살표
  selectIcon(ctx) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(4, 4, 20, 20);
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(15, 13);
    ctx.lineTo(28, 22);
    ctx.lineTo(22, 23);
    ctx.lineTo(25, 29);
    ctx.lineTo(22, 30);
    ctx.lineTo(19, 24);
    ctx.lineTo(15, 28);
    ctx.closePath();
    ctx.fill();
  },

  // 팔레트 아이콘용: 구역 칸 하나
  zoneIcon(ctx, zone) {
    ctx.fillStyle = ZoneTypes[zone].color.replace(/[\d.]+\)$/, '0.75)');
    ctx.fillRect(4, 4, TILE_SIZE - 8, TILE_SIZE - 8);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(5, 5, TILE_SIZE - 10, TILE_SIZE - 10);
    ctx.setLineDash([]);
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

  // 에디터: 마우스가 가리키는 칸에 놓일 모습을 반투명하게. attrs: { pos, rot, dir }
  cursor(ctx, x, y, tool, attrs, camX, camY) {
    const T = TILE_SIZE;
    const sx = x * T - camX;
    const sy = y * T - camY;
    ctx.save();
    ctx.globalAlpha = 0.6;
    if (tool.kind === 'design') this.tile(ctx, designTile(tool.design, attrs), sx, sy, '', null);
    else if (tool.kind === 'zone') {
      ctx.fillStyle = ZoneTypes[tool.zone].color;
      ctx.fillRect(sx, sy, T, T);
    } else if (tool.kind === 'rope') this.rope(ctx, x, y, 1, 0, camX, camY);
    else if (tool.kind !== 'erase' && tool.kind !== 'select') this.tile(ctx, SPECIAL_TILES[tool.kind], sx, sy, '', null);
    ctx.restore();
    ctx.strokeStyle = tool.kind === 'erase' ? '#ff5252' : '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, sy + 1, T - 2, T - 2);
  },
};
