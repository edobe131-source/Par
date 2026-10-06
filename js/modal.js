// 모달 창. 열려 있는 동안 게임은 멈추고 키 입력은 게임으로 가지 않는다.

const Modal = {
  current: null,
  onKey: null,
  onClose: null,
  escape: true,

  // onKey(e): 창이 열려 있을 때 키 입력 · onClose(): 어떤 방법으로든 닫힐 때 · escape: Esc로 닫을지
  open(el, { focus = null, onKey = null, onClose = null, escape = true } = {}) {
    if (this.current) this.close();
    this.current = el;
    this.onKey = onKey;
    this.onClose = onClose;
    this.escape = escape;
    el.classList.remove('hidden');
    if (focus) focus.focus();
  },

  close() {
    if (!this.current) return;
    const onClose = this.onClose;
    this.current.classList.add('hidden');
    this.current = this.onKey = this.onClose = null;
    document.activeElement?.blur();
    Input.reset();
    if (onClose) onClose();
  },
};

// document 단계에서 막아 window의 게임 입력 처리까지 가지 않게 한다.
document.addEventListener('keydown', (e) => {
  if (!Modal.current) return;
  e.stopPropagation();
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') e.preventDefault(); // 브라우저 저장 창 방지
  if (e.code === 'Escape' && Modal.escape) Modal.close();
  else if (Modal.onKey) Modal.onKey(e);
});

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) Modal.close();
});
