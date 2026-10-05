// 맵 에디터. 개발자 인증 후에만 열린다.
// - 도구: 일반 블록 / 스타트 / 지우개
// - 스타트는 항상 정확히 1개: 새로 놓으면 기존 스타트가 옮겨지고, 블록·지우개로는 지워지지 않는다.
// - 열려 있는 동안 1분마다 변경 사항을 자동 저장한다.

const AUTOSAVE_MS = 60 * 1000;
const EDITOR_PAN_SPEED = 700;
const EDITOR_MARGIN = TILE_SIZE * 3;

class Editor {
  constructor(world, map, canvas, { onExit, onChange }) {
    this.world = world;
    this.map = map;
    this.canvas = canvas;
    this.onExit = onExit;
    this.onChange = onChange; // 도구·테스트 상태가 바뀌면 툴바 갱신용

    this.tool = 'block';
    this.hover = null;
    this.stroke = null; // 드래그로 칠하는 중: { tool, last: {x, y} }
    this.pan = null; // 가운데 버튼 드래그로 화면 이동 중
    this.test = null; // 테스트 플레이 중인 PlaySession

    this.dirty = false;
    this.lastSave = null; // { at: Date, auto: boolean }
    this.saveFailed = false;

    const start = map.findStart();
    this.cam = clampCamera(map, start.x * TILE_SIZE - VIEW_W / 3, start.y * TILE_SIZE - VIEW_H / 2, EDITOR_MARGIN);

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

  replaceMap(map) {
    this.map = map;
    this.dirty = true;
    this.cam = clampCamera(map, this.cam.x, this.cam.y, EDITOR_MARGIN);
  }

  startTest() {
    this.test = new PlaySession(this.map.clone());
    this.stroke = this.pan = this.hover = null;
    this.onChange();
  }

  stopTest() {
    this.test = null;
    this.onChange();
  }

  apply(x, y, tool) {
    const map = this.map;
    const current = map.get(x, y);
    if (current === null) return;

    if (tool === 'block') {
      if (current !== Tile.EMPTY) return;
      map.set(x, y, Tile.BLOCK);
    } else if (tool === 'erase') {
      if (current !== Tile.BLOCK) return;
      map.set(x, y, Tile.EMPTY);
    } else if (tool === 'start') {
      if (current === Tile.START) return;
      const old = map.findStart();
      if (old) map.set(old.x, old.y, Tile.EMPTY);
      map.set(x, y, Tile.START);
    }
    this.dirty = true;
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
    const tool = e.button === 0 ? this.tool : e.button === 2 ? 'erase' : null;
    if (!tool) return;
    const cell = this.toCell(p);
    this.stroke = { tool, last: cell };
    this.apply(cell.x, cell.y, tool);
  }

  onMouseMove(e) {
    if (this.test) return;
    const p = this.toCanvas(e);
    const inside = p.x >= 0 && p.y >= 0 && p.x < VIEW_W && p.y < VIEW_H;
    this.hover = inside ? this.toCell(p) : null;

    if (this.pan) {
      this.cam = clampCamera(this.map, this.pan.camX - (p.x - this.pan.sx), this.pan.camY - (p.y - this.pan.sy), EDITOR_MARGIN);
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

  onWheel(e) {
    e.preventDefault();
    if (this.test) return;
    const scale = e.deltaMode === 1 ? TILE_SIZE : 1; // 줄 단위 스크롤 대응
    this.cam = clampCamera(this.map, this.cam.x + (e.deltaX + e.deltaY) * scale, this.cam.y, EDITOR_MARGIN);
  }

  update(dt) {
    if (this.test) {
      if (Input.wasPressed('Escape', 'KeyP')) this.stopTest();
      else this.test.update(dt);
      return;
    }

    if (Input.wasPressed('Escape')) return this.onExit();
    if (Input.wasPressed('KeyP')) return this.startTest();
    if (Input.wasPressed('Digit1')) this.setTool('block');
    if (Input.wasPressed('Digit2')) this.setTool('start');
    if (Input.wasPressed('Digit3')) this.setTool('erase');

    const dx = (Input.isDown('ArrowRight', 'KeyD') ? 1 : 0) - (Input.isDown('ArrowLeft', 'KeyA') ? 1 : 0);
    const dy = (Input.isDown('ArrowDown', 'KeyS') ? 1 : 0) - (Input.isDown('ArrowUp', 'KeyW') ? 1 : 0);
    const modifier = Input.isDown('ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight'); // Ctrl+S 중엔 이동 안 함
    if ((dx || dy) && !modifier) {
      const speed = EDITOR_PAN_SPEED * (Input.isDown('ShiftLeft', 'ShiftRight') ? 2.5 : 1) * dt;
      this.cam = clampCamera(this.map, this.cam.x + dx * speed, this.cam.y + dy * speed, EDITOR_MARGIN);
    }
  }

  render(ctx) {
    if (this.test) return this.test.render(ctx);

    const camX = Math.round(this.cam.x);
    const camY = Math.round(this.cam.y);
    Render.background(ctx, camX);
    Render.grid(ctx, this.map, camX, camY);
    Render.tiles(ctx, this.map, camX, camY);
    Render.outsideMap(ctx, this.map, camX, camY);
    if (this.hover && this.map.inBounds(this.hover.x, this.hover.y)) {
      Render.cursor(ctx, this.hover, this.tool, camX, camY);
    }
  }

  statusText() {
    if (this.test) return '테스트 플레이 중 (저장 안 된 변경도 반영됨) · Esc/P: 편집으로 돌아가기 · R: 처음으로';
    if (this.saveFailed) return '⚠ 저장 실패: 브라우저 저장소를 사용할 수 없습니다';
    if (this.dirty) {
      const sec = Math.max(0, Math.ceil((this.nextAutosaveAt - Date.now()) / 1000));
      return `저장 안 된 변경 있음 · ${sec}초 후 자동 저장`;
    }
    if (this.lastSave) {
      return `${this.lastSave.auto ? '자동 저장됨' : '저장됨'} · ${this.lastSave.at.toLocaleTimeString('ko-KR')}`;
    }
    return '변경 사항 없음';
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
