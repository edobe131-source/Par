// 화면 전환(월드 선택 → 플레이 → 에디터), 모달, 메인 루프.

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
    btnDev: $('#btn-dev'),
    hudEditor: $('#hud-editor'),
    hintEditor: $('#hint-editor'),
    editorTitle: $('#editor-title'),
    editorStatus: $('#editor-status'),
    editorHelp: $('#editor-help'),
    editorTools: $('#editor-tools'),
    btnTest: $('#btn-test'),
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
    modal: null,
  };

  function setScreen(name) {
    state.screen = name;
    el.select.classList.toggle('hidden', name !== 'select');
    el.hudPlay.classList.toggle('hidden', name !== 'play');
    el.hintPlay.classList.toggle('hidden', name !== 'play');
    el.hudEditor.classList.toggle('hidden', name !== 'editor');
    el.hintEditor.classList.toggle('hidden', name !== 'editor');
    canvas.classList.toggle('editing', name === 'editor');
    Input.reset();
  }

  // ---- 월드 선택 ----

  for (const world of WORLDS) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'world-card';
    const num = document.createElement('span');
    num.className = 'world-num';
    num.textContent = world.id;
    const name = document.createElement('span');
    name.className = 'world-name';
    name.textContent = world.name;
    card.append(num, name);
    card.addEventListener('click', () => enterWorld(world));
    el.worldList.append(card);
  }

  function enterWorld(world) {
    state.world = world;
    state.map = loadWorldMap(world);
    startPlay();
  }

  function leaveWorld() {
    state.world = state.map = state.play = null;
    setScreen('select');
  }

  // ---- 플레이 ----

  function startPlay() {
    state.play = new PlaySession(state.map);
    el.playTitle.textContent = state.world.name;
    el.btnDev.textContent = DevAuth.isUnlocked() ? '맵 에디터' : '개발자';
    setScreen('play');
  }

  $('#btn-play-exit').addEventListener('click', leaveWorld);
  el.btnDev.addEventListener('click', () => {
    if (DevAuth.isUnlocked()) {
      openEditor();
    } else {
      el.authCode.value = '';
      el.authError.textContent = '';
      openModal(el.modalAuth, el.authCode);
    }
  });

  $('#form-auth').addEventListener('submit', (e) => {
    e.preventDefault();
    if (DevAuth.verify(el.authCode.value)) {
      closeModal();
      openEditor();
    } else {
      el.authError.textContent = '인증 코드가 올바르지 않습니다.';
      el.authCode.select();
    }
  });

  // ---- 에디터 ----

  function openEditor() {
    state.editor = new Editor(state.world, state.map.clone(), canvas, {
      onExit: closeEditor,
      onChange: syncEditorToolbar,
    });
    el.editorTitle.textContent = `맵 에디터 · ${state.world.name}`;
    syncEditorToolbar();
    setScreen('editor');
  }

  function closeEditor() {
    const editor = state.editor;
    editor.destroy(); // 남은 변경 사항 저장
    state.editor = null;
    state.map = editor.map.clone();
    startPlay();
  }

  function syncEditorToolbar() {
    const editor = state.editor;
    for (const btn of el.editorTools.querySelectorAll('button')) {
      btn.classList.toggle('active', btn.dataset.tool === editor.tool);
      btn.disabled = !!editor.test;
    }
    el.btnTest.firstChild.textContent = editor.test ? '편집으로 ' : '테스트 ';
    el.btnTest.classList.toggle('active', !!editor.test);
    el.editorHelp.classList.toggle('hidden', !!editor.test);
  }

  el.editorTools.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tool]');
    if (btn) state.editor.setTool(btn.dataset.tool);
  });
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
    openModal(el.modalMapStr, el.mapStrText);
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

  $('#mapstr-apply').addEventListener('click', () => {
    try {
      state.editor.replaceMap(MapCodec.decode(el.mapStrText.value));
      closeModal();
    } catch (err) {
      el.mapStrMsg.textContent = err.message;
      el.mapStrMsg.classList.remove('ok');
    }
  });

  // ---- 모달 ----

  function openModal(modal, focusEl) {
    state.modal = modal;
    modal.classList.remove('hidden');
    focusEl.focus();
  }

  function closeModal() {
    if (!state.modal) return;
    state.modal.classList.add('hidden');
    state.modal = null;
    document.activeElement?.blur();
    Input.reset();
  }

  for (const btn of document.querySelectorAll('[data-close]')) btn.addEventListener('click', closeModal);
  window.addEventListener('keydown', (e) => {
    if (state.modal && e.code === 'Escape') closeModal();
  });

  // ---- 공통 키 / 포커스 ----

  window.addEventListener('keydown', (e) => {
    if (state.screen === 'editor' && !state.modal && (e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
      e.preventDefault();
      state.editor.save(false);
    }
  });

  // HUD 버튼이 포커스를 잡으면 Space(점프)가 버튼을 다시 누르므로 포커스를 주지 않는다.
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('.hud button, .world-card')) e.preventDefault();
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
      state.play.update(dt);
    } else if (state.screen === 'editor') {
      state.editor.update(dt);
    }
  }

  function render(now) {
    if (state.screen === 'play') {
      state.play.render(ctx);
    } else if (state.screen === 'editor') {
      state.editor.render(ctx);
      if (now - lastStatusAt > 250) {
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
    if (state.modal) {
      acc = 0;
    } else {
      acc += dt;
      while (acc >= STEP) {
        update(STEP);
        Input.consume();
        acc -= STEP;
      }
    }
    render(now);
    requestAnimationFrame(frame);
  }

  setScreen('select');
  requestAnimationFrame(frame);
})();
