// 키보드 입력. e.code(물리 키)를 쓰므로 한글 입력 상태에서도 동작한다.
// pressed/released는 고정 스텝 한 번이 처리한 뒤 consume()으로 비운다.

const Input = (() => {
  const down = new Set();
  const pressed = new Set();
  const released = new Set();
  const NO_SCROLL = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

  const isTyping = (e) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    if (NO_SCROLL.has(e.code)) e.preventDefault();
    if (!down.has(e.code)) pressed.add(e.code); // 키 반복 입력은 무시
    down.add(e.code);
  });

  window.addEventListener('keyup', (e) => {
    if (down.delete(e.code)) released.add(e.code);
  });

  window.addEventListener('blur', () => down.clear());

  return {
    isDown: (...codes) => codes.some((c) => down.has(c)),
    wasPressed: (...codes) => codes.some((c) => pressed.has(c)),
    consume() {
      pressed.clear();
      released.clear();
    },
    reset() {
      down.clear();
      pressed.clear();
      released.clear();
    },
  };
})();
