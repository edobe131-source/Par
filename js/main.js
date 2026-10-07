// 화면 전환(월드 선택 → 플레이 → 에디터), HUD, 메인 루프.

(() => {
  const $ = (sel) => document.querySelector(sel);
  const canvas = $('#game');
  const ctx = canvas.getContext('2d');

  const make = window.el; // editor-panel.js의 el() (여기서 el은 화면 요소 모음)

  const el = {
    select: $('#screen-select'),
    worldList: $('#world-list'),
    selectStars: $('#select-stars'),
    btnSelectDev: $('#btn-select-dev'),
    selectDevBadge: $('#select-dev-badge'),
    btnExport: $('#btn-export'),
    modalWorld: $('#modal-world'),
    worldModalTitle: $('#world-modal-title'),
    worldName: $('#world-name'),
    worldReq: $('#world-req'),
    worldError: $('#world-error'),
    worldDelete: $('#world-delete'),
    modalExport: $('#modal-export'),
    exportText: $('#export-text'),
    exportMsg: $('#export-msg'),
    hudPlay: $('#hud-play'),
    hintPlay: $('#hint-play'),
    playTitle: $('#play-title'),
    playStars: $('#play-stars'),
    btnDev: $('#btn-dev'),
    hudEditor: $('#hud-editor'),
    hintEditor: $('#hint-editor'),
    editorPanel: $('#editor-panel'),
    editorTitle: $('#editor-title'),
    editorStatus: $('#editor-status'),
    editorHelp: $('#editor-help'),
    btnTest: $('#btn-test'),
    modalCp: $('#modal-cp'),
    cpMsg: $('#cp-msg'),
    cpList: $('#cp-list'),
    modalAuth: $('#modal-auth'),
    authCode: $('#auth-code'),
    authError: $('#auth-error'),
    modalMapStr: $('#modal-mapstr'),
    mapStrText: $('#mapstr-text'),
    mapStrMsg: $('#mapstr-msg'),
  };

  const state = {
    screen: 'select',
    world: null,
    map: null, // 현재 월드의 맵 (플레이용)
    play: null,
    editor: null,
  };

  function setScreen(name) {
    state.screen = name;
    el.select.classList.toggle('hidden', name !== 'select');
    el.hudPlay.classList.toggle('hidden', name !== 'play');
    el.hintPlay.classList.toggle('hidden', name !== 'play');
    for (const e of [el.hudEditor, el.hintEditor, el.editorPanel]) e.classList.toggle('hidden', name !== 'editor');
    canvas.classList.toggle('editing', name === 'editor');
    Input.reset();
  }

  // ---- 월드 선택 ----

  // 잠긴 월드: 모든 월드에서 모은 별의 합계가 그 월드의 '필요한 별'보다 적음. 개발자는 잠겨 있어도 들어갈 수 있다.
  function showWorldSelect() {
    const dev = DevAuth.isUnlocked();
    const worlds = WorldStore.list().map((world) => ({ world, ...worldStars(world) }));
    const totalGot = worlds.reduce((sum, w) => sum + w.got, 0);
    el.selectStars.textContent = `★ ${totalGot}`;

    const items = worlds.map(({ world, got, total }) => {
      const locked = totalGot < world.stars;
      const card = make('button', { type: 'button', className: 'world-card' + (locked ? ' locked' : ''), disabled: locked && !dev },
        make('span', { className: 'world-num', textContent: world.id }),
        make('span', { className: 'world-name', textContent: world.name }),
        locked
          ? make('span', { className: 'world-lock', textContent: `🔒 ★ ${world.stars} 필요` })
          : make('span', { className: 'world-stars', textContent: `★ ${got} / ${total}` }));
      if (locked && dev) card.title = '잠긴 월드 (개발자는 들어갈 수 있음)';
      card.addEventListener('click', () => enterWorld(world));
      const item = make('div', { className: 'world-item' }, card);
      if (dev) {
        const gear = make('button', { type: 'button', className: 'world-gear', title: '월드 설정', textContent: '⚙' });
        gear.addEventListener('click', () => openWorldSettings(world));
        item.append(gear);
      }
      return item;
    });

    if (dev) {
      const add = make('button', { type: 'button', className: 'world-card add', title: '새 월드 만들기' },
        make('span', { className: 'world-num', textContent: '+' }),
        make('span', { className: 'world-name', textContent: '월드 추가' }));
      add.addEventListener('click', () => openWorldSettings(null));
      items.push(make('div', { className: 'world-item' }, add));
    }

    el.worldList.replaceChildren(...items);
    el.btnSelectDev.classList.toggle('hidden', dev);
    el.selectDevBadge.classList.toggle('hidden', !dev);
    el.btnExport.classList.toggle('hidden', !dev);
    setScreen('select');
  }

  // world가 null이면 새 월드 추가
  function openWorldSettings(world) {
    const isNew = !world;
    const id = isNew ? WorldStore.nextId() : world.id;
    el.worldModalTitle.textContent = isNew ? `월드 추가 · ${id}번` : `월드 설정 · ${id}번`;
    el.worldName.value = isNew ? `월드 ${id}` : world.name;
    el.worldReq.value = isNew ? 0 : world.stars;
    el.worldError.textContent = '';
    // 코드(worlds.js)에 있는 월드는 지울 수 없다
    el.worldDelete.classList.toggle('hidden', isNew || world.builtin);
    el.worldDelete.classList.remove('confirm');
    el.worldDelete.textContent = '월드 삭제';
    worldEditing = { id, isNew };
    Modal.open(el.modalWorld, { focus: el.worldName });
    el.worldName.select();
  }

  let worldEditing = null;

  $('#form-world').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = el.worldName.value.trim();
    const stars = Number(el.worldReq.value);
    if (!name) {
      el.worldError.textContent = '이름을 입력하세요.';
      return el.worldName.focus();
    }
    if (!Number.isInteger(stars) || stars < 0) {
      el.worldError.textContent = '필요한 별은 0 이상의 정수여야 합니다.';
      return el.worldReq.focus();
    }
    const { id, isNew } = worldEditing;
    WorldStore.save({ id, name, stars });
    if (isNew) MapStore.save(id, blankWorldMap()); // 바로 저장해 두어야 내보내기·별 계산이 같은 맵을 본다
    Modal.close();
    showWorldSelect();
  });

  // 두 번 눌러야 지워진다
  el.worldDelete.addEventListener('click', () => {
    if (!el.worldDelete.classList.contains('confirm')) {
      el.worldDelete.classList.add('confirm');
      el.worldDelete.textContent = '정말 삭제? (맵도 지워짐)';
      return;
    }
    WorldStore.remove(worldEditing.id);
    Modal.close();
    showWorldSelect();
  });

  el.btnExport.addEventListener('click', () => {
    el.exportText.value = exportWorldsCode();
    el.exportMsg.textContent = '';
    el.exportMsg.classList.remove('ok');
    Modal.open(el.modalExport, { focus: el.exportText });
    el.exportText.select();
  });

  $('#export-copy').addEventListener('click', () => copyText(el.exportText, el.exportMsg));

  // 텍스트 칸 내용을 클립보드로 복사하고 msgEl에 알린다
  async function copyText(textarea, msgEl) {
    textarea.select();
    try {
      await navigator.clipboard.writeText(textarea.value);
    } catch {
      document.execCommand('copy'); // file:// 등 clipboard API를 못 쓰는 환경
    }
    msgEl.textContent = '복사했습니다.';
    msgEl.classList.add('ok');
  }

  function enterWorld(world) {
    state.world = world;
    state.map = loadWorldMap(world);
    startPlay();
  }

  function leaveWorld() {
    state.world = state.map = state.play = null;
    showWorldSelect();
  }

  // ---- 플레이 ----

  function startPlay() {
    const world = state.world;
    state.play = new PlaySession(state.map, ProgressStore.load(world.id), (p) => ProgressStore.save(world.id, p));
    el.playTitle.textContent = world.name;
    el.btnDev.textContent = DevAuth.isUnlocked() ? '맵 에디터' : '개발자';
    setScreen('play');
  }

  $('#btn-play-exit').addEventListener('click', leaveWorld);
  $('#btn-checkpoints').addEventListener('click', () => openCheckpoints(state.play));

  // 체크포인트 이동 창. 떨어지는 중이면 열리기는 하지만 이동은 막는다. (열려 있는 동안 게임은 멈춤)
  function openCheckpoints(session) {
    const falling = session.isFalling();
    const list = session.checkpoints();
    el.cpMsg.textContent = falling
      ? '떨어지는 중에는 이동할 수 없습니다.'
      : '등록한 체크포인트로 이동합니다. 체크포인트는 직접 가서 닿아야 등록됩니다.';
    el.cpList.replaceChildren(
      ...list.map((cp, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cp-item' + (cp.current ? ' current' : '');
        btn.disabled = falling || !cp.registered;
        const label = document.createElement('span');
        label.textContent = (i < 9 ? `${i + 1}. ` : '') + cp.label;
        const note = document.createElement('span');
        note.className = 'cp-note';
        note.textContent = cp.current ? '현재' : cp.registered ? '' : '미등록';
        btn.append(label, note);
        btn.addEventListener('click', () => go(cp));
        return btn;
      }),
    );
    const go = (cp) => {
      if (session.teleport(cp.key)) Modal.close();
    };
    Modal.open(el.modalCp, {
      onKey: (e) => {
        if (e.code === 'KeyC') return Modal.close();
        const n = /^Digit([1-9])$/.exec(e.code);
        const cp = n && list[Number(n[1]) - 1];
        if (cp && cp.registered && !falling) go(cp);
      },
    });
  }

  // ---- 개발자 인증 ----

  // 인증되면 then() (플레이 중이면 에디터 열기, 월드 선택이면 개발자 버튼들 보이기)
  let afterAuth = null;

  function requireDev(then) {
    if (DevAuth.isUnlocked()) return then();
    afterAuth = then;
    el.authCode.value = '';
    el.authError.textContent = '';
    Modal.open(el.modalAuth, { focus: el.authCode });
  }

  el.btnDev.addEventListener('click', () => requireDev(openEditor));
  el.btnSelectDev.addEventListener('click', () => requireDev(showWorldSelect));

  $('#form-auth').addEventListener('submit', (e) => {
    e.preventDefault();
    if (DevAuth.verify(el.authCode.value)) {
      Modal.close();
      afterAuth?.();
    } else {
      el.authError.textContent = '인증 코드가 올바르지 않습니다.';
      el.authCode.select();
    }
  });

  // ---- 에디터 ----

  const designDialog = new DesignDialog();
  const backgroundDialog = new BackgroundDialog();
  const codeDialog = new CodeDialog();
  const panel = new EditorPanel(el.editorPanel, {
    onNewDesign: (type) =>
      designDialog.open({
        title: '새 블록 디자인',
        type,
        pixels: newDesignPixels(type),
        isNew: true,
        onSave: (t, pixels) => state.editor.addDesign(new Design(t, pixels)),
      }),
    onEditDesign: (design) =>
      designDialog.open({
        title: `디자인 편집 · ${DesignTypes[design.type].label}`,
        type: design.type,
        pixels: design.pixels,
        isNew: false,
        onSave: (t, pixels) => state.editor.updateDesign(design, pixels),
      }),
    // cell: 선택 도구로 고른 칸 (그 칸의 블록에 코드를 넣음), 팔레트에서 열면 null
    onEditCode: (design, cell) =>
      codeDialog.open({
        design,
        isNew: !design.code,
        onSave: (code, keep) => state.editor.saveCode(design, code, cell, keep),
      }),
  });

  function openEditor() {
    state.editor = new Editor(state.world, state.map.clone(), canvas, {
      onExit: closeEditor,
      onChange: syncEditorUI,
    });
    el.editorTitle.textContent = `맵 에디터 · ${state.world.name}`;
    panel.attach(state.editor);
    syncEditorUI();
    setScreen('editor');
  }

  function closeEditor() {
    const editor = state.editor;
    editor.destroy(); // 남은 변경 사항 저장
    state.editor = null;
    state.map = editor.map.clone();
    startPlay();
  }

  function syncEditorUI() {
    const editor = state.editor;
    const testing = !!editor.test;
    el.btnTest.firstChild.textContent = testing ? '편집으로 ' : '테스트 ';
    el.btnTest.classList.toggle('active', testing);
    el.editorHelp.classList.toggle('hidden', testing);
    el.editorPanel.classList.toggle('hidden', testing);
    $('#btn-tags').classList.toggle('active', editor.showTags);
    panel.render();
  }

  el.btnTest.addEventListener('click', () => {
    if (state.editor.test) state.editor.stopTest();
    else state.editor.startTest();
  });
  $('#btn-save').addEventListener('click', () => state.editor.save(false));
  $('#btn-tags').addEventListener('click', () => state.editor.toggleTags());
  $('#btn-bg').addEventListener('click', () => {
    const editor = state.editor;
    if (editor.test) editor.stopTest();
    backgroundDialog.open(editor.map.background, (bg) => editor.setBackground(bg));
  });
  $('#btn-editor-exit').addEventListener('click', closeEditor);

  $('#btn-mapstr').addEventListener('click', () => {
    el.mapStrText.value = MapCodec.encode(state.editor.map);
    el.mapStrMsg.textContent = '';
    el.mapStrMsg.classList.remove('ok');
    Modal.open(el.modalMapStr, { focus: el.mapStrText });
    el.mapStrText.select();
  });

  $('#mapstr-copy').addEventListener('click', () => copyText(el.mapStrText, el.mapStrMsg));

  // 기본 맵 문자열을 칸에 채우기만 한다 (적용을 눌러야 바뀜)
  $('#mapstr-default').addEventListener('click', () => {
    el.mapStrText.value = state.world.defaultMap || MapCodec.encode(blankWorldMap());
    el.mapStrMsg.textContent = '기본 맵을 불러왔습니다. 적용을 누르면 지금 맵이 바뀝니다.';
    el.mapStrMsg.classList.add('ok');
  });

  $('#mapstr-apply').addEventListener('click', () => {
    try {
      state.editor.replaceMap(MapCodec.decode(el.mapStrText.value));
      Modal.close();
    } catch (err) {
      el.mapStrMsg.textContent = err.message;
      el.mapStrMsg.classList.remove('ok');
    }
  });

  // ---- 공통 키 / 포커스 ----

  // 에디터 Ctrl 단축키: 저장·복사·잘라내기·붙여넣기 (입력칸에 쓰는 중이면 그 입력칸 몫)
  window.addEventListener('keydown', (e) => {
    if (state.screen !== 'editor' || state.editor.test || !(e.ctrlKey || e.metaKey)) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const actions = { KeyS: () => state.editor.save(false), KeyC: () => state.editor.copy(), KeyX: () => state.editor.cut(), KeyV: () => state.editor.startPaste() };
    if (!actions[e.code]) return;
    e.preventDefault();
    actions[e.code]();
  });

  // 버튼이 포커스를 잡으면 Space(점프)가 버튼을 다시 누르므로 포커스를 주지 않는다.
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('.hud button, .panel button, .world-item button, .select-bar button')) e.preventDefault();
  });

  // 탭을 닫거나 새로고침할 때 저장 안 된 편집 내용 보존
  window.addEventListener('beforeunload', () => {
    if (state.editor?.dirty) state.editor.save(false);
  });

  // ---- 메인 루프 (고정 60스텝) ----

  const STEP = 1 / 60;
  let acc = 0;
  let last = performance.now();
  let lastStatusAt = 0;

  function update(dt) {
    if (state.screen === 'play') {
      if (Input.wasPressed('Escape')) return leaveWorld();
      if (state.play.keyPressed('KeyC')) return openCheckpoints(state.play); // noKey(c)로 막을 수 있음
      state.play.update(dt);
    } else if (state.screen === 'editor') {
      const test = state.editor.test;
      if (test && test.keyPressed('KeyC')) return openCheckpoints(test);
      state.editor.update(dt);
    }
  }

  function render(now) {
    if (state.screen === 'play') {
      state.play.render(ctx);
      const stars = `★ ${state.play.starCount} / ${state.play.starTotal}`;
      if (el.playStars.textContent !== stars) el.playStars.textContent = stars;
    } else if (state.screen === 'editor') {
      state.editor.render(ctx);
      if (now - lastStatusAt > 100) {
        el.editorStatus.textContent = state.editor.statusText();
        lastStatusAt = now;
      }
    } else {
      Render.background(ctx, DEFAULT_BACKGROUND, now * 0.05);
    }
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    Render.time = now / 1000;
    if (Modal.current) {
      acc = 0;
    } else {
      acc += dt;
      while (acc >= STEP && !Modal.current) {
        update(STEP);
        Input.consume();
        acc -= STEP;
      }
    }
    render(now);
    requestAnimationFrame(frame);
  }

  showWorldSelect();
  requestAnimationFrame(frame);
})();
