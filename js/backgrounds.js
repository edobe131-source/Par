// 배경: 기본 배경 3개(초원·노을·밤) + 직접 색을 고르는 단색/그라데이션.
// 맵마다 하나를 고르며 맵 문자열에 함께 저장된다.

const DEFAULT_BACKGROUND = Object.freeze({ type: 'preset', id: 0 });

const GRADIENT_DIRS = {
  v: { label: '위 → 아래', from: [0.5, 0], to: [0.5, 1] },
  h: { label: '왼쪽 → 오른쪽', from: [0, 0.5], to: [1, 0.5] },
  d: { label: '왼쪽 위 → 오른쪽 아래', from: [0, 0], to: [1, 1] },
  u: { label: '왼쪽 아래 → 오른쪽 위', from: [0, 1], to: [1, 0] },
};

// 언덕/산 윤곽선. wave: 0~1 높이를 돌려주는 함수
function drawRidge(ctx, offset, baseY, amp, color, wave) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, VIEW_H);
  for (let x = 0; x <= VIEW_W; x += 8) ctx.lineTo(x, baseY - amp * wave(x + offset));
  ctx.lineTo(VIEW_W, VIEW_H);
  ctx.closePath();
  ctx.fill();
}

const smoothWave = (freq) => (x) => 0.5 + 0.35 * Math.sin(x * freq) + 0.15 * Math.sin(x * freq * 2.7);
// 뾰족한 산: 삼각파 두 개를 섞음
const peakWave = (freq) => (x) => {
  const tri = (t) => 1 - Math.abs(((t % 2) + 2) % 2 - 1);
  return 0.65 * tri(x * freq) + 0.35 * tri(x * freq * 2.3 + 0.4);
};

function verticalGradient(ctx, stops) {
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  stops.forEach(([at, color]) => g.addColorStop(at, color));
  return g;
}

// 밤하늘 별 위치 (고정된 의사 난수)
const NIGHT_STARS = (() => {
  let seed = 12345;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 90 }, () => ({ x: rand() * VIEW_W, y: rand() * VIEW_H * 0.7, r: 0.6 + rand() * 1.4, t: rand() * 6 }));
})();

const BACKGROUND_PRESETS = [
  {
    name: '초원',
    draw(ctx, camX) {
      ctx.fillStyle = verticalGradient(ctx, [[0, '#5ab8f5'], [1, '#cbeeff']]);
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      drawRidge(ctx, camX * 0.2, 360, 70, '#a6dcb9', smoothWave(0.006));
      drawRidge(ctx, camX * 0.45, 420, 50, '#80c99a', smoothWave(0.011));
    },
  },
  {
    name: '노을',
    draw(ctx, camX) {
      ctx.fillStyle = verticalGradient(ctx, [[0, '#4a2c7a'], [0.45, '#d9577a'], [0.8, '#ff9a5a'], [1, '#ffc977']]);
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      const sunX = 690 - ((camX * 0.05) % 200);
      const glow = ctx.createRadialGradient(sunX, 330, 30, sunX, 330, 150);
      glow.addColorStop(0, 'rgba(255, 240, 180, 0.9)');
      glow.addColorStop(1, 'rgba(255, 200, 120, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = '#fff1c4';
      ctx.beginPath();
      ctx.arc(sunX, 330, 52, 0, Math.PI * 2);
      ctx.fill();
      drawRidge(ctx, camX * 0.15, 380, 150, '#7a3f6e', peakWave(0.004));
      drawRidge(ctx, camX * 0.35, 440, 90, '#4f2a55', peakWave(0.007));
    },
  },
  {
    name: '밤',
    draw(ctx, camX) {
      ctx.fillStyle = verticalGradient(ctx, [[0, '#070b1f'], [1, '#2a3966']]);
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      const shift = camX * 0.03;
      for (const s of NIGHT_STARS) {
        const x = (((s.x - shift) % VIEW_W) + VIEW_W) % VIEW_W;
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(Render.time * 1.5 + s.t);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, s.y, s.r, s.r);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f4f0d0';
      ctx.beginPath();
      ctx.arc(780, 110, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
      ctx.beginPath();
      ctx.arc(770, 102, 7, 0, Math.PI * 2);
      ctx.arc(792, 122, 5, 0, Math.PI * 2);
      ctx.fill();
      drawRidge(ctx, camX * 0.2, 390, 70, '#1c2748', smoothWave(0.005));
      drawRidge(ctx, camX * 0.45, 440, 50, '#121a33', smoothWave(0.01));
    },
  },
];

const Backgrounds = {
  // w, h: 그릴 크기 (미리보기용으로 작게 그릴 때). 배경은 화면에 고정되고 기본 배경만 카메라 따라 살짝 움직인다.
  draw(ctx, bg, camX = 0, w = VIEW_W, h = VIEW_H) {
    ctx.save();
    if (w !== VIEW_W || h !== VIEW_H) ctx.scale(w / VIEW_W, h / VIEW_H);
    if (bg.type === 'solid') {
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    } else if (bg.type === 'gradient') {
      const d = GRADIENT_DIRS[bg.dir];
      const g = ctx.createLinearGradient(d.from[0] * VIEW_W, d.from[1] * VIEW_H, d.to[0] * VIEW_W, d.to[1] * VIEW_H);
      g.addColorStop(0, bg.from);
      g.addColorStop(1, bg.to);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    } else {
      BACKGROUND_PRESETS[bg.id].draw(ctx, camX);
    }
    ctx.restore();
  },
};
