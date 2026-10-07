// ============================================
// SHAPE GENERATOR — Chia shape thành N ô + vẽ mask
// ============================================
window.ShapeGenerator = (() => {

  const SHAPE_PATHS = {
    heart: 'M 50 85 C 20 60, 0 40, 0 25 C 0 10, 12 0, 25 0 C 35 0, 45 5, 50 18 C 55 5, 65 0, 75 0 C 88 0, 100 10, 100 25 C 100 40, 80 60, 50 85 Z',
    star: 'M 50 5 L 62 38 L 98 38 L 68 60 L 80 95 L 50 73 L 20 95 L 32 60 L 2 38 L 38 38 Z',
    circle: 'M 50 5 A 45 45 0 1 1 49.99 5 Z',
    hexagon: 'M 50 5 L 92 28 L 92 72 L 50 95 L 8 72 L 8 28 Z',
    diamond: 'M 50 5 L 95 50 L 50 95 L 5 50 Z',
    triangle: 'M 50 8 L 92 92 L 8 92 Z',
  };

  // ⭐ Render mask — canvas đen trên nền trong suốt
  function renderShapeMask(type, value, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#000';

    if (type === 'text') {
      const text = (value || 'A').toUpperCase().replace(/\s+/g, '');
      const chars = text.split('');
      if (chars.length <= 1) {
        const size = Math.floor(h * 0.85);
        ctx.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, w / 2, h / 2);
      } else {
        const size = Math.floor(Math.min(h * 0.8, (w * 0.9) / chars.length));
        ctx.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const stepX = w / chars.length;
        chars.forEach((c, i) => {
          ctx.fillText(c, (i + 0.5) * stepX, h / 2);
        });
      }
    } else if (SHAPE_PATHS[type]) {
      const path = new Path2D(SHAPE_PATHS[type]);
      ctx.save();
      ctx.scale(w / 100, h / 100);
      ctx.fill(path);
      ctx.restore();
    }
    return canvas;
  }

  // ⭐ Detect ô nào nằm trong shape
  function cellInShape(ctx, x, y, w, h, threshold = 0.35) {
    if (w <= 0 || h <= 0) return false;
    try {
      const data = ctx.getImageData(x, y, w, h).data;
      let inside = 0;
      const total = w * h;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 128) inside++;
      }
      return inside / total >= threshold;
    } catch (e) {
      return false;
    }
  }

  // ⭐ Chia shape thành N ô — cho text thì mỗi chữ 1 ô
  function generateSlots(shapeType, shapeValue, targetCount) {
    // Đặc biệt: text → mỗi chữ 1 slot
    if (shapeType === 'text') {
      const text = (shapeValue || 'A').toUpperCase().replace(/\s+/g, '');
      const chars = text.split('');
      const n = chars.length;
      const slots = [];
      for (let i = 0; i < n; i++) {
        // Mỗi chữ chia theo tỷ lệ đều
        slots.push({
          x: i / n,
          y: 0.08,
          w: 1 / n,
          h: 0.84,
          char: chars[i],
        });
      }
      return slots;
    }

    const TEST_SIZE = 400;
    const testW = TEST_SIZE, testH = TEST_SIZE;
    const canvas = renderShapeMask(shapeType, shapeValue, testW, testH);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Thử các grid khác nhau, chọn grid gần targetCount nhất
    const candidates = [];
    for (let rows = 1; rows <= 8; rows++) {
      for (let cols = 1; cols <= 8; cols++) {
        const cellW = testW / cols, cellH = testH / rows;
        const slots = [];
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = Math.floor(c * cellW);
            const y = Math.floor(r * cellH);
            const w = Math.floor(cellW);
            const h = Math.floor(cellH);
            if (cellInShape(ctx, x, y, w, h, 0.4)) {
              slots.push({ x, y, w, h });
            }
          }
        }
        if (slots.length > 0) {
          candidates.push({
            rows, cols, slots,
            count: slots.length,
            score: Math.abs(slots.length - targetCount),
          });
        }
      }
    }

    if (candidates.length === 0) {
      return [{ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }];
    }

    candidates.sort((a, b) => a.score - b.score);
    let finalSlots = candidates[0].slots.slice();

    // Merge nếu nhiều hơn targetCount
    while (finalSlots.length > targetCount) {
      let bestI = -1, bestJ = -1, bestDist = Infinity;
      for (let i = 0; i < finalSlots.length; i++) {
        for (let j = i + 1; j < finalSlots.length; j++) {
          const a = finalSlots[i], b = finalSlots[j];
          const dist = Math.hypot(
            (a.x + a.w / 2) - (b.x + b.w / 2),
            (a.y + a.h / 2) - (b.y + b.h / 2)
          );
          if (dist < bestDist) { bestDist = dist; bestI = i; bestJ = j; }
        }
      }
      if (bestI === -1) break;
      const a = finalSlots[bestI], b = finalSlots[bestJ];
      const merged = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
        h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y),
      };
      finalSlots = finalSlots.filter((_, i) => i !== bestI && i !== bestJ);
      finalSlots.push(merged);
    }

    // Split nếu ít hơn targetCount
    let safety = 20;
    while (finalSlots.length < targetCount && safety-- > 0) {
      finalSlots.sort((a, b) => (b.w * b.h) - (a.w * a.h));
      const big = finalSlots.shift();
      const halfW = Math.floor(big.w / 2);
      const halfH = Math.floor(big.h / 2);
      if (halfW > 5 && big.w > big.h) {
        finalSlots.push({ x: big.x, y: big.y, w: halfW, h: big.h });
        finalSlots.push({ x: big.x + halfW, y: big.y, w: big.w - halfW, h: big.h });
      } else if (halfH > 5) {
        finalSlots.push({ x: big.x, y: big.y, w: big.w, h: halfH });
        finalSlots.push({ x: big.x, y: big.y + halfH, w: big.w, h: big.h - halfH });
      } else {
        finalSlots.push(big);
        break;
      }
    }

    finalSlots.sort((a, b) => {
      const rowA = Math.round(a.y / (testH / 8));
      const rowB = Math.round(b.y / (testH / 8));
      if (rowA !== rowB) return rowA - rowB;
      return a.x - b.x;
    });

    return finalSlots.map((s) => ({
      x: s.x / testW,
      y: s.y / testH,
      w: s.w / testW,
      h: s.h / testH,
    }));
  }

  // ⭐ Vẽ preview shape + slots (dùng cho admin)
  function renderPreview(canvas, shapeType, shapeValue, slots, options = {}) {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    if (options.showShape) {
      ctx.save();
      ctx.globalAlpha = 0.15;
      const mask = renderShapeMask(shapeType, shapeValue, w, h);
      ctx.drawImage(mask, 0, 0);
      ctx.restore();
    }

    if (slots && slots.length) {
      slots.forEach((s, i) => {
        const x = s.x * w, y = s.y * h;
        const sw = s.w * w, sh = s.h * h;
        ctx.fillStyle = `hsla(${(i * 360 / slots.length)}, 80%, 60%, 0.15)`;
        ctx.fillRect(x, y, sw, sh);
        ctx.strokeStyle = `hsl(${(i * 360 / slots.length)}, 80%, 60%)`;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, sw - 2, sh - 2);
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.min(sw, sh) * 0.35}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(s.char || (i + 1), x + sw / 2, y + sh / 2);
      });
    }
  }

  return { generateSlots, renderShapeMask, renderPreview, SHAPE_PATHS };
})();

// ⭐ Gắn vào window để app.js gọi được
window.ShapeGenerator = ShapeGenerator;