// 맵 에디터. 개발자 인증 후에만 열린다.
// - 맵은 가로·세로 모두 끝이 없다.
// - 도구: 선택 / 지우개 / 스타트 / 체크포인트 / 별 / 밧줄 / 구역(노란·보라·물) / 블록 디자인들
// - 스타트는 항상 정확히 1개: 새로 놓으면 기존 스타트가 옮겨지고, 다른 도구로는 덮이거나 지워지지 않는다.
// - 구역은 타일과 따로 겹쳐 놓인다.
// - 선택 도구: 끌어서 영역 선택 → 영역 안을 끌면 복사본을 끌어다 놓기(Shift: 옮기기),
//   Ctrl+C/X/V 복사·잘라내기·붙여넣기, Delete 지우기. 한 칸을 고르면 속성(체크포인트 이름·밧줄 길이·코드)을 바꿀 수 있다.
// - 열려 있는 동안 1분마다 변경 사항을 자동 저장한다.

const AUTOSAVE_MS = 60 * 1000;
const EDITOR_PAN_SPEED = 700;

class Editor {
  constructor(world, map, canvas, { onExit, onChange }) {
    this.world = world;
    this.map = map;
    this.canvas = canvas;
    this.onExit = onExit;
    this.onChange = onChange; // 도구·디자인·선택·테스트 상태가 바뀌면 화면(툴바, 팔레트) 갱신용

    // 예전에 만든 맵에도 새 블록 종류가 팔레트에 보이도록, 없는 종류는 기본 디자인을 채워 넣는다.
    for (const type of DESIGN_TYPE_ORDER) {
      if (!map.designs.some((d) => d.type === type)) map.addDesign(designFromTemplate(TYPE_DEFAULT_TEMPLATE[type]));
    }

    // tool: { kind: 'select' | 'erase' | 'start' | 'checkpoint' | 'star' | 'rope' }, { kind: 'zone', zone }, { kind: 'design', design }
    this.tool = map.designs.length ? { kind: 'design', design: map.designs[0] } : { kind: 'erase' };
    // 블록을 놓을 때 쓰는 속성: 단일 가시 위치, 가시 회전, 머신 방향
    this.attrs = { pos: 1, rot: 0, dir: 1 };
    this.hover = null;
    this.stroke = null; // 드래그로 칠하는 중: { tool, last: {x, y}, zoneOnly }
    this.ropeDrag = null; // 밧줄 길이 정하는 중: { x, y }
    this.pan = null; // 가운데 버튼 드래그로 화면 이동 중
    this.test = null; // 테스트 플레이 중인 PlaySession
    this.showTags = false; // 블록마다 블록 태그 표시

    this.selection = null; // { x0, y0, x1, y1 } (끝 칸 포함)
    this.selecting = null; // 영역을 끌어서 고르는 중: 시작 칸
    this.clipboard = null; // { w, h, cells: [{ dx, dy, tile, zone }] }
    this.pasting = false; // 붙여넣기 중: 마우스를 따라다니는 미리보기를 클릭해서 찍음
    this.dragClip = null; // 선택 영역을 끌어다 놓는 중: { from, clip, move, offset }

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
    this.pasting = false;
    if (tool.kind !== 'select') this.selection = null;
    this.onChange();
  }

  setAttr(name, value) {
    this.attrs[name] = value;
    this.onChange();
  }

  toggleTags() {
    this.showTags = !this.showTags;
    this.onChange();
  }

  // R: 가시는 90도 회전, 머신은 방향 바꾸기
  rotate() {
    const type = this.tool.kind === 'design' ? DesignTypes[this.tool.design.type] : null;
    if (type?.rotatable) this.setAttr('rot', (this.attrs.rot + 1) % 4);
    else if (type?.directional) this.setAttr('dir', 1 - this.attrs.dir);
  }

  setBackground(bg) {
    this.map.background = bg;
    this.dirty = true;
  }

  // ---- 디자인 관리 ----

  // 팔레트에 넣는다 (새 블록 태그가 붙음)
  addDesign(design, after = null) {
    const i = after ? this.map.designs.indexOf(after) + 1 : this.map.designs.length;
    this.map.addDesign(design, i);
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

  // 코드 저장. 코드가 없던 디자인에 처음 넣으면, 코드가 든 새 블록(새 태그)을 팔레트에 만들고
  // cell이 주어지면 그 칸의 블록을 새 블록으로 바꾼다. 이미 코드가 있던 디자인은 그 코드를 고친다.
  saveCode(design, code, cell = null) {
    code = code.replace(/\s+$/, '');
    let target = design;
    if (design.code) {
      design.code = code;
    } else {
      if (!code.trim()) return design;
      target = design.clone();
      target.tag = 0;
      target.code = code;
      this.map.addDesign(target, this.map.designs.indexOf(design) + 1);
      if (cell) {
        const tile = this.map.get(cell.x, cell.y);
        if (tile?.design === design) this.map.set(cell.x, cell.y, { ...tile, design: target });
      }
      if (!cell) this.tool = { kind: 'design', design: target }; // 팔레트에서 연 경우 새 블록을 바로 골라 둠
    }
    target.version++; // 팔레트 다시 그리기
    this.map.changed();
    this.dirty = true;
    this.onChange();
    return target;
  }

  replaceMap(map) {
    this.map = map;
    this.tool = map.designs.length ? { kind: 'design', design: map.designs[0] } : { kind: 'erase' };
    this.selection = null;
    this.pasting = false;
    this.dirty = true;
    this.onChange();
  }

  // ---- 테스트 플레이 (진행 상황은 저장하지 않음) ----

  startTest() {
    this.test = new PlaySession(this.map.clone(), new Progress());
    this.stroke = this.pan = this.hover = this.ropeDrag = this.dragClip = this.selecting = null;
    this.onChange();
  }

  stopTest() {
    this.test = null;
    this.onChange();
  }

  // ---- 칸 편집 ----

  // zoneOnly: 구역 도구로 우클릭할 때처럼 구역만 지움
  apply(x, y, tool, zoneOnly = false) {
    const map = this.map;
    const current = map.get(x, y);
    if (tool.kind === 'erase') {
      // 타일을 먼저 지우고, 타일이 없으면(또는 스타트면) 구역을 지운다.
      if (current && current.kind !== 'start' && !zoneOnly) map.remove(x, y);
      else if (map.zone(x, y)) map.removeZone(x, y);
      else return;
    } else if (tool.kind === 'zone') {
      if (map.zone(x, y) === tool.zone) return;
      map.setZone(x, y, tool.zone);
    } else if (tool.kind === 'start') {
      if (current?.kind === 'start') return;
      map.set(x, y, START);
    } else {
      if (current?.kind === 'start') return;
      const tile = tool.kind === 'design' ? designTile(tool.design, this.attrs) : SPECIAL_TILES[tool.kind];
      if (sameTile(current, tile)) return;
      map.set(x, y, tile);
    }
    this.dirty = true;
  }

  // Alt+클릭: 칸에 있는 것을 도구로 집기 (타일이 없으면 구역)
  pick(x, y) {
    const tile = this.map.get(x, y);
    const zone = this.map.zone(x, y);
    if (tile?.kind === 'design') {
      Object.assign(this.attrs, { pos: tile.pos, rot: tile.rot, dir: tile.dir });
      return this.setTool({ kind: 'design', design: tile.design });
    }
    if (tile) return this.setTool({ kind: tile.kind });
    this.setTool(zone ? { kind: 'zone', zone } : { kind: 'erase' });
  }

  // ---- 속성 (선택 도구로 한 칸을 골랐을 때) ----

  selectedCell() {
    const s = this.selection;
    if (!s || s.x0 !== s.x1 || s.y0 !== s.y1) return null;
    return { x: s.x0, y: s.y0, tile: this.map.get(s.x0, s.y0), zone: this.map.zone(s.x0, s.y0) };
  }

  setCheckpointName(x, y, name) {
    if (this.map.get(x, y)?.kind !== 'checkpoint') return;
    this.map.set(x, y, checkpointTile(name.trim()));
    this.dirty = true;
  }

  setRopeLength(x, y, length) {
    const current = this.map.get(x, y);
    if (current?.kind === 'start') return;
    if (current?.kind === 'rope' && current.length === length) return;
    this.map.set(x, y, ropeTile(Math.max(1, Math.min(MAX_ROPE_LENGTH, Math.round(length) || 1))));
    this.dirty = true;
  }

  // ---- 영역 복사·붙여넣기 ----

  // withStart: 스타트도 담을지 (옮기기에서만)
  copyRegion(sel, withStart = false) {
    const cells = [];
    for (let y = sel.y0; y <= sel.y1; y++) {
      for (let x = sel.x0; x <= sel.x1; x++) {
        let tile = this.map.get(x, y);
        if (tile?.kind === 'start' && !withStart) tile = null;
        const zone = this.map.zone(x, y);
        if (tile || zone) cells.push({ dx: x - sel.x0, dy: y - sel.y0, tile, zone });
      }
    }
    return { w: sel.x1 - sel.x0 + 1, h: sel.y1 - sel.y0 + 1, cells };
  }

  clearRegion(sel, withStart = false) {
    for (let y = sel.y0; y <= sel.y1; y++) {
      for (let x = sel.x0; x <= sel.x1; x++) {
        const tile = this.map.get(x, y);
        if (tile && (tile.kind !== 'start' || withStart)) this.map.remove(x, y);
        if (this.map.zone(x, y)) this.map.removeZone(x, y);
      }
    }
    this.dirty = true;
  }

  // (x, y)를 왼쪽 위로 해서 찍는다. 빈칸은 덮지 않고, 스타트 자리는 건드리지 않는다.
  pasteClip(clip, x, y) {
    for (const c of clip.cells) {
      const tx = x + c.dx;
      const ty = y + c.dy;
      if (c.tile && (this.map.get(tx, ty)?.kind !== 'start' || c.tile.kind === 'start')) this.map.set(tx, ty, c.tile);
      if (c.zone) this.map.setZone(tx, ty, c.zone);
    }
    this.dirty = true;
  }

  copy() {
    if (!this.selection) return;
    this.clipboard = this.copyRegion(this.selection);
    this.onChange();
  }

  cut() {
    if (!this.selection) return;
    this.copy();
    this.clearRegion(this.selection);
    this.onChange();
  }

  startPaste() {
    if (!this.clipboard) return;
    if (this.tool.kind !== 'select') this.tool = { kind: 'select' };
    this.pasting = true;
    this.onChange();
  }

  deleteSelection() {
    if (!this.selection) return;
    this.clearRegion(this.selection);
    this.onChange();
  }

  // ---- 마우스 ----

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

  inSelection(cell) {
    const s = this.selection;
    return !!s && cell.x >= s.x0 && cell.x <= s.x1 && cell.y >= s.y0 && cell.y <= s.y1;
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
    if (this.pasting) {
      if (e.button === 0) this.pasteClip(this.clipboard, cell.x, cell.y);
      else if (e.button === 2) {
        this.pasting = false; // 우클릭: 붙여넣기 끝
        this.onChange();
      }
      return;
    }
    if (e.button === 0 && e.altKey) return this.pick(cell.x, cell.y);
    if (e.button === 0 && this.tool.kind === 'select') {
      if (this.inSelection(cell)) {
        // 선택 영역 안을 끌면 복사본을 끌어다 놓기 (Shift: 옮기기)
        this.dragClip = { from: cell, move: e.shiftKey, clip: this.copyRegion(this.selection, e.shiftKey), offset: { x: 0, y: 0 } };
      } else {
        this.selecting = cell;
        this.selection = { x0: cell.x, y0: cell.y, x1: cell.x, y1: cell.y };
        this.onChange();
      }
      return;
    }
    if (e.button === 0 && this.tool.kind === 'rope') {
      // 밧줄: 고정점을 누르고 아래로 끌어 길이를 정한다.
      if (this.map.get(cell.x, cell.y)?.kind === 'start') return;
      this.ropeDrag = { x: cell.x, y: cell.y };
      this.setRopeLength(cell.x, cell.y, 1);
      return;
    }
    const tool = e.button === 0 ? this.tool : e.button === 2 ? { kind: 'erase' } : null;
    if (!tool) return;
    const zoneOnly = e.button === 2 && this.tool.kind === 'zone';
    this.stroke = { tool, last: cell, zoneOnly };
    this.apply(cell.x, cell.y, tool, zoneOnly);
  }

  onMouseMove(e) {
    if (this.test) return;
    const p = this.toCanvas(e);
    this.hover = e.target === this.canvas ? this.toCell(p) : null;
    const cell = this.toCell(p);

    if (this.pan) {
      this.cam.x = this.pan.camX - (p.x - this.pan.sx);
      this.cam.y = this.pan.camY - (p.y - this.pan.sy);
    } else if (this.selecting) {
      const a = this.selecting;
      this.selection = { x0: Math.min(a.x, cell.x), y0: Math.min(a.y, cell.y), x1: Math.max(a.x, cell.x), y1: Math.max(a.y, cell.y) };
    } else if (this.dragClip) {
      this.dragClip.offset = { x: cell.x - this.dragClip.from.x, y: cell.y - this.dragClip.from.y };
    } else if (this.ropeDrag) {
      const { x, y } = this.ropeDrag;
      this.setRopeLength(x, y, cell.y - y + 1);
    } else if (this.stroke) {
      // 빠르게 드래그해도 칸이 비지 않도록 이전 칸부터 선을 따라 칠한다.
      const { tool, zoneOnly } = this.stroke;
      forEachCellOnLine(this.stroke.last, cell, (x, y) => this.apply(x, y, tool, zoneOnly));
      this.stroke.last = cell;
    }
  }

  onMouseUp(e) {
    if (e.button === 1) {
      this.pan = null;
      return;
    }
    if (this.selecting) {
      this.selecting = null;
      this.onChange();
    }
    if (this.dragClip) {
      const { clip, move, offset } = this.dragClip;
      this.dragClip = null;
      if (offset.x || offset.y) {
        const s = this.selection;
        if (move) this.clearRegion(s, true);
        this.pasteClip(clip, s.x0 + offset.x, s.y0 + offset.y);
        this.selection = { x0: s.x0 + offset.x, y0: s.y0 + offset.y, x1: s.x1 + offset.x, y1: s.y1 + offset.y };
      }
      this.onChange();
    }
    if (e.button === 0 || e.button === 2) {
      if (this.ropeDrag) this.onChange();
      this.stroke = this.ropeDrag = null;
    }
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

    const ctrl = Input.isDown('ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight');
    if (Input.wasPressed('Escape')) {
      // 붙여넣기 → 끌기 → 선택 순으로 취소하고, 아무것도 없으면 에디터 나가기
      if (this.pasting) this.pasting = false;
      else if (this.dragClip) this.dragClip = null;
      else if (this.selection) this.selection = null;
      else return this.onExit();
      return this.onChange();
    }
    if (ctrl) return; // Ctrl을 누른 동안은 다른 단축키·화면 이동 안 함 (Ctrl+C/X/V/S는 main.js에서)
    if (Input.wasPressed('Delete', 'Backspace')) this.deleteSelection();
    if (Input.wasPressed('KeyP')) return this.startTest();
    if (Input.wasPressed('KeyQ')) this.setAttr('pos', (this.attrs.pos + 1) % 3);
    if (Input.wasPressed('KeyR')) this.rotate();
    if (Input.wasPressed('KeyT')) this.toggleTags();

    const dx = (Input.isDown('ArrowRight', 'KeyD') ? 1 : 0) - (Input.isDown('ArrowLeft', 'KeyA') ? 1 : 0);
    const dy = (Input.isDown('ArrowDown', 'KeyS') ? 1 : 0) - (Input.isDown('ArrowUp', 'KeyW') ? 1 : 0);
    if (dx || dy) {
      const speed = EDITOR_PAN_SPEED * (Input.isDown('ShiftLeft', 'ShiftRight') ? 2.5 : 1) * dt;
      this.cam.x += dx * speed;
      this.cam.y += dy * speed;
    }
  }

  render(ctx) {
    if (this.test) return this.test.render(ctx);

    const camX = Math.round(this.cam.x);
    const camY = Math.round(this.cam.y);
    Render.background(ctx, this.map.background, camX);
    Render.grid(ctx, camX, camY);
    Render.tiles(ctx, this.map, camX, camY);
    Render.ropes(ctx, this.map.positions('rope').map(({ x, y, tile }) => ({ x, y, length: tile.length })), camX, camY);
    Render.zones(ctx, this.map, camX, camY);
    if (this.showTags) Render.tags(ctx, this.map, camX, camY);
    if (this.selection) Render.selection(ctx, this.selection, camX, camY);
    if (this.dragClip) {
      const { clip, offset } = this.dragClip;
      Render.clipboard(ctx, clip, this.selection.x0 + offset.x, this.selection.y0 + offset.y, camX, camY);
    } else if (this.pasting && this.hover) {
      Render.clipboard(ctx, this.clipboard, this.hover.x, this.hover.y, camX, camY);
    } else if (this.hover && !this.ropeDrag && !this.selecting) {
      Render.cursor(ctx, this.hover.x, this.hover.y, this.tool, this.attrs, camX, camY);
    }
  }

  statusText() {
    if (this.test) {
      const err = this.test.scriptErrors[this.test.scriptErrors.length - 1];
      if (err) return `⚠ 코드 오류 · 태그 ${err.tag} 블록 (${err.x}, ${err.y}) ${err.line}번째 줄: ${err.message} · Esc/P 편집으로`;
      return `테스트 플레이 중 (저장 안 된 변경도 반영, 진행은 저장 안 됨) · ★ ${this.test.starCount} / ${this.test.starTotal}`
        + ' · C 체크포인트 · R 체크포인트로 · Esc/P 편집으로';
    }
    let where = this.hover ? ` · 칸 (${this.hover.x}, ${this.hover.y})` : '';
    if (this.ropeDrag) where += ` · 밧줄 길이 ${this.map.get(this.ropeDrag.x, this.ropeDrag.y).length}칸`;
    if (this.pasting) where += ' · 붙여넣기: 클릭해서 찍기, 우클릭/Esc로 끝';
    else if (this.dragClip) where += this.dragClip.move ? ' · 옮기는 중' : ' · 복사본 끌어다 놓는 중 (Shift: 옮기기)';
    else if (this.selection) {
      const s = this.selection;
      where += ` · 선택 ${s.x1 - s.x0 + 1}×${s.y1 - s.y0 + 1}칸`;
    }
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
