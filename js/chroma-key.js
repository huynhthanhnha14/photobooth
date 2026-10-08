// ============================================
// CHROMA KEY — Tách nền trắng giữ chữ 3D sắc nét
// Kỹ thuật: edge-seeded flood-fill + auto-detect màu nền + soft feather
// ============================================
window.ChromaKey = (function () {

  const DEFAULTS = {
    // ⭐ Đã hạ ngưỡng để chịu được ảnh WebP/JPEG đã nén
    // (nền trắng không còn là #FFFFFF tinh khiết)
    hardThreshold: 238,      // pixel >= mức này → xóa hoàn toàn
    softThreshold: 200,      // bắt đầu feather từ mức này
    satTolerance: 0.14,      // độ bão hoà tối đa để coi là "nền xám/trắng"
    colorDistance: 32,       // ⭐ khoảng cách Euclid tới màu nền trung bình
    feather: 1,              // làm mềm cạnh anti-alias
    autoDetectBg: true,      // tự dò màu nền từ 4 góc ảnh
  };

  // ────────────────────────────────────────────
  // Load ảnh → HTMLImageElement
  // ────────────────────────────────────────────
  function _loadImg(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('Không load được ảnh: ' + src));
      im.src = src;
    });
  }

  // ────────────────────────────────────────────
  // ⭐ Auto-detect màu nền từ 4 góc (sample 12x12 mỗi góc)
  // ────────────────────────────────────────────
  function _detectBgColor(d, w, h) {
    const samples = [];
    const SZ = 12;
    const grab = (x0, y0) => {
      for (let y = y0; y < y0 + SZ; y++) {
        for (let x = x0; x < x0 + SZ; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const i = (y * w + x) * 4;
          if (d[i + 3] < 20) continue;               // bỏ pixel trong suốt
          samples.push([d[i], d[i + 1], d[i + 2]]);
        }
      }
    };
    grab(0, 0);
    grab(w - SZ, 0);
    grab(0, h - SZ);
    grab(w - SZ, h - SZ);

    if (samples.length === 0) return [255, 255, 255];

    const sum = samples.reduce(
      (s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]],
      [0, 0, 0]
    );
    return [
      Math.round(sum[0] / samples.length),
      Math.round(sum[1] / samples.length),
      Math.round(sum[2] / samples.length),
    ];
  }

  // ────────────────────────────────────────────
  // Xử lý ảnh (trả về canvas đã tách nền)
  // ────────────────────────────────────────────
  function _processImage(img, options = {}) {
    const opt = { ...DEFAULTS, ...options };
    const w = img.naturalWidth | 0;
    const h = img.naturalHeight | 0;
    if (!w || !h) throw new Error('Ảnh rỗng');

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    const total = w * h;

    // ⭐ Auto-detect màu nền
    const bgColor = opt.autoDetectBg
      ? _detectBgColor(d, w, h)
      : [255, 255, 255];

    console.log('[ChromaKey] Màu nền phát hiện:', bgColor,
      '| hard:', opt.hardThreshold, '| soft:', opt.softThreshold);

    // ─── Kiểm tra pixel có phải "ứng viên nền" ───
    // Tiêu chí kép:
    //   1. Đủ sáng (max >= softThreshold)
    //   2. Đủ trung tính (sat thấp) HOẶC gần màu nền trung bình
    function isBgCandidate(idx) {
      const i = idx * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a < 20) return true;                        // đã trong suốt
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);

      // Cách 1: đủ sáng + trung tính (near-white/gray)
      if (max >= opt.softThreshold) {
        const sat = max === 0 ? 0 : (max - min) / max;
        if (sat <= opt.satTolerance) return true;
      }

      // ⭐ Cách 2: gần màu nền trung bình (chịu được ảnh nén méo màu)
      const dr = r - bgColor[0];
      const dg = g - bgColor[1];
      const db = b - bgColor[2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      return dist <= opt.colorDistance;
    }

    // ─── BFS flood-fill từ 4 cạnh ảnh ───
    const visited = new Uint8Array(total);
    const qx = new Int32Array(total);
    const qy = new Int32Array(total);
    let head = 0, tail = 0;

    function push(x, y) {
      if (x < 0 || x >= w || y < 0 || y >= h) return;
      const idx = y * w + x;
      if (visited[idx] || !isBgCandidate(idx)) return;
      visited[idx] = 1;
      qx[tail] = x; qy[tail] = y; tail++;
    }

    // Seed tất cả pixel ở 4 cạnh
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }

    while (head < tail) {
      const x = qx[head], y = qy[head]; head++;
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    }

    // ─── Áp dụng alpha ───
    for (let idx = 0; idx < total; idx++) {
      if (!visited[idx]) continue;
      const i = idx * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;

      // Trắng tinh / gần trắng → xóa hoàn toàn
      if (max >= opt.hardThreshold && sat < opt.satTolerance) {
        d[i + 3] = 0;
        continue;
      }

      if (opt.feather > 0) {
        // Cạnh anti-alias / glow nhạt → alpha giảm dần
        const span = Math.max(1, opt.hardThreshold - opt.softThreshold);
        const t = (max - opt.softThreshold) / span;
        const a = 1 - Math.max(0, Math.min(1, t));
        d[i + 3] = Math.round(d[i + 3] * (1 - a * opt.feather));
      } else {
        d[i + 3] = 0;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  // ────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────

  /** Trả về Canvas đã tách nền (giữ chữ 3D, viền, bóng) */
  async function removeWhiteBackground(source, options = {}) {
    const img = source instanceof HTMLImageElement
      ? source
      : await _loadImg(source);
    return _processImage(img, options);
  }

  /** Trả về dataURL PNG trong suốt */
  async function toDataURL(source, options = {}) {
    const canvas = await removeWhiteBackground(source, options);
    return canvas.toDataURL('image/png');
  }

  return {
    removeWhiteBackground,
    toDataURL,
    DEFAULTS,
    // Xuất helper để debug
    _detectBgColor,
  };
})();