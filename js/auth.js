// 개발자 인증. 코드는 SHA-256 해시로만 보관한다.
// 주의: 브라우저에서만 도는 검사라 소스를 고치면 우회할 수 있다. 실제 보안이 필요하면 서버 검증이 필요.

const DevAuth = {
  CODE_SHA256: '10ea245f7f6b1f500c9df54dac33fa0941a0bff8d06985c75e18fa3fb74049e3',
  SESSION_KEY: 'par.devUnlocked', // 탭을 닫기 전까지 다시 묻지 않음
  unlocked: false,

  isUnlocked() {
    if (this.unlocked) return true;
    try {
      return sessionStorage.getItem(this.SESSION_KEY) === '1';
    } catch {
      return false;
    }
  },

  verify(code) {
    if (sha256Hex(code.trim()) !== this.CODE_SHA256) return false;
    this.unlocked = true;
    try {
      sessionStorage.setItem(this.SESSION_KEY, '1');
    } catch {
      // 저장소를 못 쓰면 이 페이지에서만 유지
    }
    return true;
  },
};
