// 월드별 진행 상황: 먹은 별, 등록한 체크포인트, 현재(부활) 체크포인트.
// 좌표 키("x,y")로 기억하므로 맵을 고쳐 옮긴 별·체크포인트는 새것으로 취급된다.

class Progress {
  constructor({ stars = [], checkpoints = [], current = null } = {}) {
    this.stars = new Set(stars);
    this.checkpoints = new Set(checkpoints); // 스타트는 항상 등록된 것으로 취급하므로 넣지 않음
    this.current = current;
  }

  toJSON() {
    return { stars: [...this.stars], checkpoints: [...this.checkpoints], current: this.current };
  }
}

const ProgressStore = {
  key(worldId) {
    return `par.world${worldId}.progress`;
  },

  load(worldId) {
    try {
      const str = localStorage.getItem(this.key(worldId));
      return new Progress(str ? JSON.parse(str) : {});
    } catch (err) {
      console.warn('진행 상황을 불러오지 못했습니다:', err);
      return new Progress();
    }
  },

  save(worldId, progress) {
    try {
      localStorage.setItem(this.key(worldId), JSON.stringify(progress));
    } catch (err) {
      console.warn('진행 상황 저장 실패:', err);
    }
  },
};
