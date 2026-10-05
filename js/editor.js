// 맵 에디터. 개발자 인증 후에만 열린다.
// - 맵은 가로·세로 모두 끝이 없다.
// - 도구: 지우개 / 스타트 / 체크포인트 / 별 / 블록 디자인들
// - 스타트는 항상 정확히 1개: 새로 놓으면 기존 스타트가 옮겨지고, 다른 도구로는 덮이거나 지워지지 않는다.
// - 열려 있는 동안 1분마다 변경 사항을 자동 저장한다.

const AUTOSAVE_MS = 60 * 1000;
const EDITOR_PAN_SPEED = 700;

class Editor {
  constructor(world, map, canvas, { onExit, onChange }) {
    this.world = world;
    this.map = map;
    this.canvas = canvas;
    this.onExit = onExit;
    this.onChange = onChange; // 도구·디자인·테스트 상태가 바뀌면 화면(툴바, 팔레트) 갱신용

    // tool: { kind: 'erase' | 'start' | 'checkpoint' | 'star' } 또는 { kind: 'design', design }
    this.tool = map.designs.length ? { kind: 'design', design: map.designs[0] } : { kind: 'erase' };
    this.spikePos = 1; // 단일 가시를 놓을 위치 (0 왼쪽, 1 가운데, 2 오른쪽)
    this.hover = null;
    this.stroke = null; // 드래그로 칠하는 중: { tool, last: {x, y} }
    this.pan = null; // 가운데 버튼 드래그로 화면 이동 중
    this.test = null; // 테스트 플레이 중인 PlaySession

    this.dirty = false;
    this.lastSave = null; // { at: Date, auto: boolean }
    this.saveFailed = false;

    this.cam = {
      x: map.start.x * TILE_SIZE - VIEW_W / 2,
      y: map.start.y * TILE_SIZE - VIEW_H / 2,
    };

    this.nextAutosaveAt = Date.now() + AUTOSAVE_MS;
    this.autosaveTimer = setInterval(() => this.autosave(), AUTOSAVE_MS);

    this.listeners = [
      [canvas, 'mousedown', (e) => this.onMouseDown(e)],
      [window, 'mousemove', (e) => this.onMouseMove(e)],
      [window, 'mouseup', (e) => this.onMouseUp(e)],
      [canvas, 'wheel', (e) => this.onWheel(e), { passive: false }],
      [canvas, 'contextmenu', (e) => e.preventDefault()],
    ];
    for (const [target, type, fn, opts] of this.listeners) target.addEventListener(type, fn, opts);
  }

  // 에디터를 닫을 때: 타이머·이벤트 정리 후 남은 변경 사항 저장.
  destroy() {
    clearInterval(this.autosaveTimer);
    for (const [target, type, fn, opts] of this.listeners) target.removeEventListener(type, fn, opts);
    if (this.dirty) this.save(false);
  }

  save(auto) {
    if (MapStore.save(this.world.id, this.map)) {
      this.dirty = false;
      this.saveFailed = false;
      this.lastSave = { at: new Date(), auto };
    } else {
      this.saveFailed = true;
    }
  }

  autosave() {
    this.nextAutosaveAt = Date.now() + AUTOSAVE_MS;
    if (this.dirty) this.save(true);
  }

  setTool(tool) {
    this.tool = tool;
    this.onChange();
  }

  setSpikePos(pos) {
    this.spikePos = pos;
    this.onChange();
  }

  // ---- 디자인 관리 ----

  addDesign(design, after = null) {
    const i = after ? this.map.designs.indexOf(after) + 1 : this.map.designs.length;
    this.map.designs.splice(i, 0, design);
    this.dirty = true;
    this.setTool({ kind: 'design', design });
  }

  updateDesign(design, pixels) {
    design.setPixels(pixels);
    this.dirty = true;
    this.onChange();
  }

  deleteDesign(design) {
    this.map.removeDesign(design);
    if (this.tool.design === design) this.tool = { kind: 'erase' };
    this.dirty = true;
    this.onChange();
  }

  replaceMap(map) {
    this.map = map;
    this.tool = map.designs.length ? { kind: 'design', design: map.designs[0] } : { kind: 'erase' };
    this.dirty = true;
    this.onChange();
  }

  // ---- 테스트 플레이 (진행 상황은 저장하지 않음) ----

  startTest() {
    this.test = new PlaySession(this.map.clone(), new Progress());
    this.stroke = this.pan = this.hover = null;
    this.onChange();
  }

  stopTest() {
    this.test = null;
    this.onChange();
  }

  // ---- 칸 편집 ----

  apply(x, y, tool) {
    const current = this.map.get(x, y);
    if (tool.kind === 'erase') {
      if (!current || current.kind === 'start') return;
      this.map.remove(x, y);
    } else if (tool.kind === 'start') {
      if (current?.kind === 'start') return;
      this.map.set(x, y, START);
    } else {
      if (current?.kind === 'start') return;
      const tile = tool.kind === 'design' ? designTile(tool.design, this.spikePos) : SPECIAL_TILES[tool.kind];
      if (sameTile(current, tile)) return;
      this.map.set(x, y, tile);
    }
    this.dirty = true;
  }

  // Alt+클릭: 칸에 있는 것을 도구로 집기
  pick(x, y) {
    const tile = this.map.get(x, y);
    if (!tile) return this.setTool({ kind: 'erase' });
    if (tile.kind === 'design') {
      this.spikePos = tile.pos;
      return this.setTool({ kind: 'design', design: tile.design });
    }
    this.setTool({ kind: tile.kind });
  }

  toCanvas(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * VIEW_W) / rect.width,
      y: ((e.clientY - rect.top) * VIEW_H) / rect.height,
    };
  }

  toCell(p) {
    return {
      x: Math.floor((p.x + this.cam.x) / TILE_SIZE),
      y: Math.floor((p.y + this.cam.y) / TILE_SIZE),
    };
  }

  onMouseDown(e) {
    if (this.test) return;
    const p = this.toCanvas(e);
    if (e.button === 1) {
      e.preventDefault();
      this.pan = { sx: p.x, sy: p.y, camX: this.cam.x, camY: this.cam.y };
      return;
    }
    const cell = this.toCell(p);
    if (e.button === 0 && e.altKey) return this.pick(cell.x, cell.y);
    const tool = e.button === 0 ? this.tool : e.button === 2 ? { kind: 'erase' } : null;
    if (!tool) return;
    this.stroke = { tool, last: cell };
    this.apply(cell.x, cell.y, tool);
  }

  onMouseMove(e) {
    if (this.test) return;
    const p = this.toCanvas(e);
    this.hover = e.target === this.canvas ? this.toCell(p) : null;

    if (this.pan) {
      this.cam.x = this.pan.camX - (p.x - this.pan.sx);
      this.cam.y = this.pan.camY - (p.y - this.pan.sy);
    } else if (this.stroke) {
      // 빠르게 드래그해도 칸이 비지 않도록 이전 칸부터 선을 따라 칠한다.
      const cell = this.toCell(p);
      forEachCellOnLine(this.stroke.last, cell, (x, y) => this.apply(x, y, this.stroke.tool));
      this.stroke.last = cell;
    }
  }

  onMouseUp(e) {
    if (e.button === 1) this.pan = null;
    else this.stroke = null;
  }

  // 휠: 위아래 이동, Shift+휠 또는 가로 스크롤: 좌우 이동
  onWheel(e) {
    e.preventDefault();
    if (this.test) return;
    const scale = e.deltaMode === 1 ? TILE_SIZE : 1; // 줄 단위 스크롤 대응
    let dx = e.deltaX * scale;
    let dy = e.deltaY * scale;
    if (e.shiftKey && !dx) [dx, dy] = [dy, 0];
    this.cam.x += dx;
    this.cam.y += dy;
  }

  update(dt) {
    if (this.test) {
      if (Input.wasPressed('Escape', 'KeyP')) this.stopTest();
      else this.test.update(dt);
      return;
    }

    if (Input.wasPressed('Escape')) return this.onExit();
    if (Input.wasPressed('KeyP')) return this.startTest();
    if (Input.wasPressed('KeyQ')) this.setSpikePos((this.spikePos + 1) % 3);

    const dx = (Input.isDown('ArrowRight', 'KeyD') ? 1 : 0) - (Input.isDown('ArrowLeft', 'KeyA') ? 1 : 0);
    const dy = (Input.isDown('ArrowDown', 'KeyS') ? 1 : 0) - (Input.isDown('ArrowUp', 'KeyW') ? 1 : 0);
    const modifier = Input.isDown('ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight'); // Ctrl+S 중엔 이동 안 함
    if ((dx || dy) && !modifier) {
      const speed = EDITOR_PAN_SPEED * (Input.isDown('ShiftLeft', 'ShiftRight') ? 2.5 : 1) * dt;
      this.cam.x += dx * speed;
      this.cam.y += dy * speed;
    }
  }

  render(ctx) {
    if (this.test) return this.test.render(ctx);

    const camX = Math.round(this.cam.x);
    const camY = Math.round(this.cam.y);
    Render.background(ctx, camX);
    Render.grid(ctx, camX, camY);
    Render.tiles(ctx, this.map, camX, camY);
    if (this.hover) Render.cursor(ctx, this.hover.x, this.hover.y, this.tool, this.spikePos, camX, camY);
  }

  statusText() {
    if (this.test) {
      return `테스트 플레이 중 (저장 안 된 변경도 반영, 진행은 저장 안 됨) · ★ ${this.test.starCount} / ${this.test.starTotal}`
        + ' · C 체크포인트 · R 체크포인트로 · Esc/P 편집으로';
    }
    const where = this.hover ? ` · 칸 (${this.hover.x}, ${this.hover.y})` : '';
    if (this.saveFailed) return '⚠ 저장 실패: 브라우저 저장소를 사용할 수 없습니다' + where;
    if (this.dirty) {
      const sec = Math.max(0, Math.ceil((this.nextAutosaveAt - Date.now()) / 1000));
      return `저장 안 된 변경 있음 · ${sec}초 후 자동 저장` + where;
    }
    if (this.lastSave) {
      return `${this.lastSave.auto ? '자동 저장됨' : '저장됨'} · ${this.lastSave.at.toLocaleTimeString('ko-KR')}` + where;
    }
    return '변경 사항 없음' + where;
  }
}

// 브레젠험 직선: a에서 b까지 지나는 칸마다 fn(x, y) 호출.
function forEachCellOnLine(a, b, fn) {
  let { x, y } = a;
  const dx = Math.abs(b.x - x);
  const dy = -Math.abs(b.y - y);
  const sx = x < b.x ? 1 : -1;
  const sy = y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    fn(x, y);
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}
