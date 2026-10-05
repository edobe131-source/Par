// 화면 전환(월드 선택 → 플레이 → 에디터), HUD, 메인 루프.

(() => {
  const $ = (sel) => document.querySelector(sel);
  const canvas = $('#game');
  const ctx = canvas.getContext('2d');

  const el = {
    select: $('#screen-select'),
    worldList: $('#world-list'),
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

  function showWorldSelect() {
    el.worldList.replaceChildren(
      ...WORLDS.map((world) => {
        const map = loadWorldMap(world);
        const progress = ProgressStore.load(world.id);
        const stars = map.positions('star');
        const got = stars.filter((p) => progress.stars.has(cellKey(p.x, p.y))).length;

        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'world-card';
        const num = document.createElement('span');
        num.className = 'world-num';
        num.textContent = world.id;
        const name = document.createElement('span');
        name.className = 'world-name';
        name.textContent = world.name;
        const starText = document.createElement('span');
        starText.className = 'world-stars';
        starText.textContent = `★ ${got} / ${stars.length}`;
        card.append(num, name, starText);
        card.addEventListener('click', () => enterWorld(world));
        return card;
      }),
    );
    setScreen('select');
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

  el.btnDev.addEventListener('click', () => {
    if (DevAuth.isUnlocked()) return openEditor();
    el.authCode.value = '';
    el.authError.textContent = '';
    Modal.open(el.modalAuth, { focus: el.authCode });
  });

  $('#form-auth').addEventListener('submit', (e) => {
    e.preventDefault();
    if (DevAuth.verify(el.authCode.value)) {
      Modal.close();
      openEditor();
    } else {
      el.authError.textContent = '인증 코드가 올바르지 않습니다.';
      el.authCode.select();
    }
  });

  // ---- 에디터 ----

  const designDialog = new DesignDialog();
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
    panel.render();
  }

  el.btnTest.addEventListener('click', () => {
    if (state.editor.test) state.editor.stopTest();
    else state.editor.startTest();
  });
  $('#btn-save').addEventListener('click', () => state.editor.save(false));
  $('#btn-editor-exit').addEventListener('click', closeEditor);

  $('#btn-mapstr').addEventListener('click', () => {
    el.mapStrText.value = MapCodec.encode(state.editor.map);
    el.mapStrMsg.textContent = '';
    el.mapStrMsg.classList.remove('ok');
    Modal.open(el.modalMapStr, { focus: el.mapStrText });
    el.mapStrText.select();
  });

  $('#mapstr-copy').addEventListener('click', async () => {
    el.mapStrText.select();
    try {
      await navigator.clipboard.writeText(el.mapStrText.value);
    } catch {
      document.execCommand('copy'); // file:// 등 clipboard API를 못 쓰는 환경
    }
    el.mapStrMsg.textContent = '복사했습니다.';
    el.mapStrMsg.classList.add('ok');
  });

  // 기본 맵 문자열을 칸에 채우기만 한다 (적용을 눌러야 바뀜)
  $('#mapstr-default').addEventListener('click', () => {
    el.mapStrText.value = state.world.defaultMap;
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

  window.addEventListener('keydown', (e) => {
    if (state.screen === 'editor' && (e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
      e.preventDefault();
      state.editor.save(false);
    }
  });

  // 버튼이 포커스를 잡으면 Space(점프)가 버튼을 다시 누르므로 포커스를 주지 않는다.
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('.hud button, .panel button, .world-card')) e.preventDefault();
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
      if (Input.wasPressed('KeyC')) return openCheckpoints(state.play);
      state.play.update(dt);
    } else if (state.screen === 'editor') {
      const test = state.editor.test;
      if (test && Input.wasPressed('KeyC')) return openCheckpoints(test);
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
      Render.background(ctx, now * 0.05);
    }
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
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
