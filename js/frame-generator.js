const LAYOUTS = {
  'vertical-strip': (count = 4, p = 0.03) => {
    const slotH = 1 / count;
    const slots = [];
    for (let i = 0; i < count; i++) slots.push([p, i * slotH + p / 2, 1 - p * 2, slotH - p]);
    return slots;
  },
  'grid-2x2': () => {
    const t = 0.10, b = 0.10, l = 0.10, r = 0.10, gx = 0.045, gy = 0.035;
    const cw = (1 - l - r - gx) / 2, ch = (1 - t - b - gy) / 2;
    return [[l, t, cw, ch], [l + cw + gx, t, cw, ch], [l, t + ch + gy, cw, ch], [l + cw + gx, t + ch + gy, cw, ch]];
  },
  'grid-2x3': () => {
    const t = 0.06, b = 0.06, l = 0.06, r = 0.06, gx = 0.04, gy = 0.025;
    const cw = (1 - l - r - gx) / 2, ch = (1 - t - b - gy * 2) / 3;
    const slots = [];
    for (let row = 0; row < 3; row++) for (let col = 0; col < 2; col++) slots.push([l + col * (cw + gx), t + row * (ch + gy), cw, ch]);
    return slots;
  },
  'grid-2x4': () => {
    const t = 0.075, b = 0.09, l = 0.045, r = 0.045, gx = 0.035, gy = 0.014;
    const cw = (1 - l - r - gx) / 2, ch = (1 - t - b - gy * 3) / 4;
    const slots = [];
    for (let row = 0; row < 4; row++) for (let col = 0; col < 2; col++) slots.push([l + col * (cw + gx), t + row * (ch + gy), cw, ch]);
    return slots;
  },
  'grid-3x3': () => {
    const p = 0.035, gap = 0.025;
    const cw = (1 - p * 2 - gap * 2) / 3, ch = (1 - p * 2 - gap * 2) / 3;
    const slots = [];
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) slots.push([p + col * (cw + gap), p + row * (ch + gap), cw, ch]);
    return slots;
  },
  'center-box': () => [[0.285, 0.315, 0.42, 0.41]],
  'center-box-large': () => [[0.20, 0.25, 0.60, 0.50]],
  'ktcn-2slot': () => [[0.10, 0.13, 0.80, 0.34], [0.10, 0.50, 0.80, 0.34]],
  'ktcn-4slot': () => [[0.08, 0.13, 0.40, 0.35], [0.52, 0.13, 0.40, 0.35], [0.08, 0.52, 0.40, 0.35], [0.52, 0.52, 0.40, 0.35]],
  'single': () => [[0.08, 0.08, 0.84, 0.84]],
  'circle-center': () => [[0.15, 0.15, 0.70, 0.70]],
  'circle-large':  () => [[0.10, 0.10, 0.80, 0.80]],
  'circle-small':  () => [[0.22, 0.22, 0.56, 0.56]],
};

// ============================================
// AI DETECT SLOT
// ============================================
const FrameAI = (() => {
  function getImageData(frameImg) {
    const w = frameImg.naturalWidth, h = frameImg.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(frameImg, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    return { data: imageData.data, w, h };
  }

  // ⭐ Phân loại shape từ 1 component (vùng trắng đã detect)
  function classifySlotShape(component, isBrightBox = true) {
    const sw = component.maxX - component.minX + 1;
    const sh = component.maxY - component.minY + 1;
    const area = component.area;
    const bboxArea = sw * sh;
    const fillRatio = bboxArea > 0 ? area / bboxArea : 0;
    const aspect = Math.min(sw, sh) / Math.max(sw, sh);
    const maxR = Math.min(sw, sh) / 2;

    // ① Hình tròn (aspect ~1, fillRatio ~π/4 ≈ 0.785)
    if (aspect > 0.85 && fillRatio > 0.70 && fillRatio < 0.87) {
      return {
        x: component.minX, y: component.minY, w: sw, h: sh,
        isBrightBox,
        shape: 'circle',
        isCircle: true,
        radius: maxR,
      };
    }

    // ② Ước lượng bán kính bo góc
    //    rounded rect: A = w·h − (4−π)·R²  →  R = √((w·h − A)/(4−π))
    const estR2 = (bboxArea - area) / (4 - Math.PI);
    let R = Math.sqrt(Math.max(0, estR2));

    // ③ Bo gần hết → coi như tròn (pill/circle)
    if (R >= maxR * 0.9) {
      return {
        x: component.minX, y: component.minY, w: sw, h: sh,
        isBrightBox,
        shape: 'circle',
        isCircle: true,
        radius: maxR,
      };
    }

    // ④ Bo góc vừa
    if (R > 4) {
      return {
        x: component.minX, y: component.minY, w: sw, h: sh,
        isBrightBox,
        shape: 'rounded-rect',
        isCircle: false,
        radius: Math.min(R, maxR),
      };
    }

    // ⑤ Vuông góc cạnh
    return {
      x: component.minX, y: component.minY, w: sw, h: sh,
      isBrightBox,
      shape: 'rect',
      isCircle: false,
      radius: 0,
    };
  }

  function detectWhiteBoxes(pixels, w, h, expectedCount) {
    const mask = new Uint8Array(w * h);
    const marginX = Math.floor(w * 0.05);
    const marginY = Math.floor(h * 0.05);

    for (let y = marginY; y < h - marginY; y++) {
      for (let x = marginX; x < w - marginX; x++) {
        const idx = (y * w + x) * 4;
        const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2], a = pixels[idx + 3];
        const isBright = r > 190 && g > 190 && b > 190 && a > 200;
        const isGray = r > 160 && g > 160 && b > 160 && a > 200
                    && Math.abs(r - g) < 20 && Math.abs(g - b) < 20;
        mask[y * w + x] = (isBright || isGray) ? 1 : 0;
      }
    }

    const cleaned = dilate(erode(mask, w, h, 2), w, h, 2);
    const comps = findComponents(cleaned, w, h);
    const minArea = w * h * 0.008;
    const maxArea = w * h * 0.6;
    let valid = comps.filter((c) => c.area >= minArea && c.area <= maxArea);

    valid.sort((a, b) => {
      const rowA = Math.round((a.minY + a.maxY) / 2 / (h / 10));
      const rowB = Math.round((b.minY + b.maxY) / 2 / (h / 10));
      if (rowA !== rowB) return rowA - rowB;
      return a.minX - b.minX;
    });

    if (valid.length > expectedCount) {
      valid.sort((a, b) => b.area - a.area);
      valid = valid.slice(0, expectedCount);
      valid.sort((a, b) => {
        const rowA = Math.round((a.minY + a.maxY) / 2 / (h / 10));
        const rowB = Math.round((b.minY + b.maxY) / 2 / (h / 10));
        if (rowA !== rowB) return rowA - rowB;
        return a.minX - b.minX;
      });
    }

    // ⭐ Classify shape cho từng slot
    return valid.map((c) => classifySlotShape(c, true));
  }

  function binarize(alpha, threshold = 128) {
    const mask = new Uint8Array(alpha.length);
    for (let i = 0; i < alpha.length; i++) mask[i] = alpha[i] < threshold ? 1 : 0;
    return mask;
  }

  function findComponents(mask, w, h) {
    const labels = new Int32Array(mask.length).fill(-1);
    const components = [];
    let nextLabel = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (mask[idx] !== 1 || labels[idx] !== -1) continue;
        const queue = [[x, y]];
        labels[idx] = nextLabel;
        let minX = x, maxX = x, minY = y, maxY = y, area = 0;
        while (queue.length) {
          const [cx, cy] = queue.shift();
          area++;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;
          const nb = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
          for (const [nx, ny] of nb) {
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const ni = ny * w + nx;
            if (mask[ni] === 1 && labels[ni] === -1) { labels[ni] = nextLabel; queue.push([nx, ny]); }
          }
        }
        components.push({ minX, minY, maxX, maxY, area });
        nextLabel++;
      }
    }
    return components;
  }

  function erode(mask, w, h, r) {
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let keep = 1;
      for (let dy = -r; dy <= r && keep; dy++) for (let dx = -r; dx <= r && keep; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h || mask[ny * w + nx] === 0) keep = 0;
      }
      out[y * w + x] = keep;
    }
    return out;
  }

  function dilate(mask, w, h, r) {
    const out = new Uint8Array(mask.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let dy = -r; dy <= r && !hit; dy++) for (let dx = -r; dx <= r && !hit; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        if (mask[ny * w + nx] === 1) hit = 1;
      }
      out[y * w + x] = hit;
    }
    return out;
  }

  function detectByAlpha(pixels, w, h, expectedCount) {
    const alpha = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) alpha[i] = pixels[i * 4 + 3];
    const mask = binarize(alpha, 128);
    const cleaned = dilate(erode(mask, w, h, 2), w, h, 2);
    const comps = findComponents(cleaned, w, h);
    const minArea = w * h * 0.008, maxArea = w * h * 0.6;
    let valid = comps.filter((c) => c.area >= minArea && c.area <= maxArea);

    valid.sort((a, b) => {
      const rowA = Math.round((a.minY + a.maxY) / 2 / (h / 10));
      const rowB = Math.round((b.minY + b.maxY) / 2 / (h / 10));
      if (rowA !== rowB) return rowA - rowB;
      return a.minX - b.minX;
    });

    if (valid.length > expectedCount) {
      valid.sort((a, b) => b.area - a.area);
      valid = valid.slice(0, expectedCount);
    }

    return valid.map((c) => classifySlotShape(c, false));
  }

  function detect(frameImg, expectedCount) {
    const { data, w, h } = getImageData(frameImg);
    const whiteBoxes = detectWhiteBoxes(data, w, h, expectedCount);
    if (whiteBoxes.length >= expectedCount) {
      console.log('[AI] Tìm thấy', whiteBoxes.length, 'ô —', whiteBoxes.map(b => b.shape).join(', '));
      return whiteBoxes.slice(0, expectedCount);
    }
    const alphaBoxes = detectByAlpha(data, w, h, expectedCount);
    if (alphaBoxes.length > 0) {
      console.log('[AI] Fallback alpha:', alphaBoxes.length, 'ô —', alphaBoxes.map(b => b.shape).join(', '));
      return alphaBoxes;
    }
    console.warn('[AI] Không tìm được ô nào');
    return whiteBoxes;
  }

  return { detect, classifySlotShape };
})();

// ⭐ Vẽ path rounded rect (dùng quadratic curve để tương thích rộng)
function _roundRectPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r === 0) { ctx.rect(x, y, w, h); return; }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawImageInSlot(ctx, img, sx, sy, sw, sh, slotMeta) {
  sx = Math.round(sx); sy = Math.round(sy);
  sw = Math.round(sw); sh = Math.round(sh);
  if (sw <= 0 || sh <= 0) return;

  // ⭐ Nhận diện shape từ slotMeta
  let shape = 'rect';
  let radius = 0;
  if (typeof slotMeta === 'boolean') {
    if (slotMeta) { shape = 'circle'; radius = Math.min(sw, sh) / 2; }
  } else if (slotMeta && typeof slotMeta === 'object') {
    shape = slotMeta.shape || (slotMeta.isCircle ? 'circle' : 'rect');
    radius = slotMeta.radius || (shape === 'circle' ? Math.min(sw, sh) / 2 : 0);
  }

  // Fit ảnh kiểu "cover" (giữ tỉ lệ, phủ kín slot)
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const slotRatio = sw / sh;
  let drawW, drawH;
  if (imgRatio > slotRatio) { drawH = sh; drawW = sh * imgRatio; }
  else { drawW = sw; drawH = sw / imgRatio; }
  const offsetX = sx + (sw - drawW) / 2;
  const offsetY = sy + (sh - drawH) / 2;

  ctx.save();
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(sx + sw / 2, sy + sh / 2, Math.min(sw, sh) / 2, 0, Math.PI * 2);
  } else if (shape === 'rounded-rect' && radius > 0) {
    _roundRectPath(ctx, sx, sy, sw, sh, radius);
  } else {
    ctx.rect(sx, sy, sw, sh);
  }
  ctx.clip();
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
  ctx.restore();
}

// ⭐ AI TÁCH CHỮ: chỉ xóa pixel NỀN nhạt, GIỮ pixel CHỮ đậm
// Chữ trong slot tự động đè lên camera
function smartClearSlot(frameCtx, slot, W, H) {
  const x = Math.floor(slot.x);
  const y = Math.floor(slot.y);
  const w = Math.min(Math.ceil(slot.w), W - x);
  const h = Math.min(Math.ceil(slot.h), H - y);

  if (w <= 0 || h <= 0) return;

  try {
    const imgData = frameCtx.getImageData(x, y, w, h);
    const d = imgData.data;
    const cx = w / 2;
    const cy = h / 2;
    const radiusSq = Math.pow(Math.min(w, h) / 2, 2);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = (py * w + px) * 4;

        if (slot.isCircle) {
          const dx = (px + 0.5) - cx;
          const dy = (py + 0.5) - cy;
          if (dx * dx + dy * dy > radiusSq) continue;
        }

        const r = d[idx];
        const g = d[idx + 1];
        const b = d[idx + 2];
        const a = d[idx + 3];

        // CHỈ XÓA pixel NỀN nhạt
        const isTransparent = a < 50;
        const isBrightWhite = r > 220 && g > 220 && b > 220;
        const isLightGray = Math.abs(r - g) < 20 && Math.abs(g - b) < 20 && r > 195 && r < 240;

        if (isTransparent || isBrightWhite || isLightGray) {
          d[idx + 3] = 0;
        }
        // Chữ đậm/màu → GIỮ NGUYÊN → đè camera
      }
    }
    frameCtx.putImageData(imgData, x, y);
  } catch (e) {
    console.warn('[Smart Clear Slot] Lỗi, fallback:', e);
    frameCtx.save();
    frameCtx.globalCompositeOperation = 'destination-out';
    frameCtx.beginPath();
    if (slot.isCircle) {
      frameCtx.arc(slot.x + slot.w / 2, slot.y + slot.h / 2, Math.min(slot.w, slot.h) / 2, 0, Math.PI * 2);
    } else {
      frameCtx.rect(slot.x, slot.y, slot.w, slot.h);
    }
    frameCtx.fill();
    frameCtx.restore();
  }
}

// ⭐ AI tách chữ trong shape
function smartClearShape(frameCtx, mask, W, H) {
  try {
    const imgData = frameCtx.getImageData(0, 0, W, H);
    const maskData = mask.getContext('2d').getImageData(0, 0, W, H).data;
    const d = imgData.data;

    for (let i = 0; i < d.length; i += 4) {
      if (maskData[i + 3] < 128) continue;

      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      const isTransparent = a < 50;
      const isBrightWhite = r > 220 && g > 220 && b > 220;
      const isLightGray = Math.abs(r - g) < 20 && Math.abs(g - b) < 20 && r > 195 && r < 240;

      if (isTransparent || isBrightWhite || isLightGray) {
        d[i + 3] = 0;
      }
    }
    frameCtx.putImageData(imgData, 0, 0);
  } catch (e) {
    console.warn('[Smart Clear Shape] Lỗi, fallback:', e);
    frameCtx.save();
    frameCtx.globalCompositeOperation = 'destination-out';
    frameCtx.drawImage(mask, 0, 0);
    frameCtx.restore();
  }
}

// ============================================
// ⭐ XÓA NỀN TRẮNG bằng FLOOD-FILL từ viền
// Giữ nguyên viền trắng bên trong chữ
// ============================================
function removeWhiteBackgroundFloodFill(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const total = w * h;

  const THRESHOLD = 235;

  const visited = new Uint8Array(total);
  const queueX = new Int32Array(total);
  const queueY = new Int32Array(total);
  let qHead = 0;
  let qTail = 0;

  function isWhite(idx) {
    const i = idx * 4;
    return d[i] > THRESHOLD && d[i + 1] > THRESHOLD && d[i + 2] > THRESHOLD && d[i + 3] > 128;
  }

  function tryPush(x, y) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const idx = y * w + x;
    if (visited[idx]) return;
    if (!isWhite(idx)) return;
    visited[idx] = 1;
    queueX[qTail] = x;
    queueY[qTail] = y;
    qTail++;
  }

  for (let x = 0; x < w; x++) {
    tryPush(x, 0);
    tryPush(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    tryPush(0, y);
    tryPush(w - 1, y);
  }

  while (qHead < qTail) {
    const x = queueX[qHead];
    const y = queueY[qHead];
    qHead++;
    const idx = y * w + x;
    d[idx * 4 + 3] = 0;

    tryPush(x + 1, y);
    tryPush(x - 1, y);
    tryPush(x, y + 1);
    tryPush(x, y - 1);
  }

  ctx.putImageData(imgData, 0, 0);
  console.log('[Remove BG] Đã xóa nền trắng bằng flood-fill');
  return c;
}

// ============================================
// ⭐ Vẽ ảnh TRÀN VIỀN (cover fit, không clip)
// ============================================
function drawImageFullBleed(ctx, img, W, H) {
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const canvasRatio = W / H;
  let drawW, drawH;
  if (imgRatio > canvasRatio) {
    drawH = H;
    drawW = H * imgRatio;
  } else {
    drawW = W;
    drawH = W / imgRatio;
  }
  const offsetX = (W - drawW) / 2;
  const offsetY = (H - drawH) / 2;
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
}

window.generatePhotoStrip = function (frameUrl, userPhotos, layout = 'auto', options = {}) {
  return new Promise((resolve, reject) => {
    const frameImg = new Image();
    frameImg.crossOrigin = 'anonymous';

    // ⭐ Cho phép frameUrl rỗng → dùng kích thước mặc định
    const hasFrame = !!frameUrl;
    if (hasFrame) {
      frameImg.src = frameUrl;
    }

    const finish = async () => {
      try {
        // ⭐ Kích thước canvas
        const W = hasFrame && frameImg.naturalWidth ? frameImg.naturalWidth : 1200;
        const H = hasFrame && frameImg.naturalHeight ? frameImg.naturalHeight : 1600;

        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // ⭐ Enhance ảnh user
        const enhancedPhotos = [];
        for (let i = 0; i < userPhotos.length; i++) {
          const enhanced = await window.ImageEnhancer.enhancePhoto(userPhotos[i]);
          enhancedPhotos.push(enhanced);
        }

        const photoImgs = enhancedPhotos.map((dataUrl) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = dataUrl;
          return img;
        });

        await Promise.all(photoImgs.map((img) => new Promise((res) => {
          if (img.complete && img.naturalWidth) return res();
          img.onload = res;
          img.onerror = res;
        })));

        // ═══════════════════════════════════════════════
        // ⭐ BƯỚC 1: Vẽ CAMERA
        // ═══════════════════════════════════════════════
        if (options.fullBleed || options.frameRemoveBg) {
          // ⭐ CHẾ ĐỘ TRÀN VIỀN: camera phủ toàn canvas
          if (photoImgs[0]) {
            drawImageFullBleed(ctx, photoImgs[0], W, H);
            console.log('[Full Bleed] Camera tràn viền');
          }
        } else {
          // Chế độ slot cũ giữ nguyên (không thay đổi)
          const shapeType = options.shapeType || 'rect';
          const shapeValue = options.shapeValue || '';
          let finalSlots = [];

          if (shapeType !== 'rect' && window.ShapeGenerator) {
            const shapeSlots = window.ShapeGenerator.generateSlots(shapeType, shapeValue, photoImgs.length);
            finalSlots = shapeSlots.map((s) => ({
              x: s.x * W, y: s.y * H,
              w: s.w * W, h: s.h * H,
              isCircle: false,
              shape: 'rect',   // ⭐ mỗi mảnh shape là 1 rect nhỏ
              radius: 0,
            }));
          } else {
            let slots = null;
            if (layout === 'auto' && hasFrame) {
              try {
                const detected = FrameAI.detect(frameImg, photoImgs.length);
                if (detected && detected.length === photoImgs.length) slots = detected;
              } catch (err) { console.warn('[AI Frame Error]', err); }
            }

            if (slots && slots.length === photoImgs.length) {
              finalSlots = slots;
            } else {
              const layoutKey = LAYOUTS[layout] ? layout : (photoImgs.length === 1 ? 'center-box' : 'grid-2x2');
              const layoutFn = LAYOUTS[layoutKey];
              const ratioSlots = layoutFn(photoImgs.length);
              const isCircleLayout = layoutKey.startsWith('circle');
              // ⭐ Gán shape + radius cho mỗi slot
              finalSlots = ratioSlots.map(([rx, ry, rw, rh]) => {
                const x = rx * W, y = ry * H;
                const w = rw * W, h = rh * H;
                return {
                  x, y, w, h,
                  isCircle: isCircleLayout,
                  shape: isCircleLayout ? 'circle' : 'rect',
                  radius: isCircleLayout ? Math.min(w, h) / 2 : 0,
                };
              });
            }
          }

          if (hasFrame) {
            if (options.clearSlot) {
              const frameCanvas = document.createElement('canvas');
              frameCanvas.width = W;
              frameCanvas.height = H;
              const frameCtx = frameCanvas.getContext('2d');
              frameCtx.drawImage(frameImg, 0, 0, W, H);
              frameCtx.save();
              frameCtx.globalCompositeOperation = 'destination-out';
              // ⭐ Khoét lỗ theo shape + radius
              finalSlots.forEach((s) => {
                frameCtx.beginPath();
                const shape = s.shape || (s.isCircle ? 'circle' : 'rect');
                const radius = s.radius || 0;
                if (shape === 'circle') {
                  frameCtx.arc(s.x + s.w / 2, s.y + s.h / 2, Math.min(s.w, s.h) / 2, 0, Math.PI * 2);
                } else if (shape === 'rounded-rect' && radius > 0) {
                  _roundRectPath(frameCtx, s.x, s.y, s.w, s.h, radius);
                } else {
                  frameCtx.rect(s.x, s.y, s.w, s.h);
                }
                frameCtx.fill();
              });
              frameCtx.restore();
              ctx.drawImage(frameCanvas, 0, 0);
            } else {
              ctx.drawImage(frameImg, 0, 0, W, H);
            }
          }

          // ⭐ Vẽ ảnh user vào slot — truyền cả slotMeta object (shape + radius)
          photoImgs.forEach((img, i) => {
            const s = finalSlots[i % finalSlots.length];
            if (s) drawImageInSlot(ctx, img, s.x, s.y, s.w, s.h, s);
          });
        }

        // ═══════════════════════════════════════════════
        // ⭐ BƯỚC 1B: VẼ FRAME ĐÃ TÁCH NỀN (nếu frameRemoveBg)
        // ═══════════════════════════════════════════════
        if (hasFrame && options.frameRemoveBg && window.ChromaKey) {
          try {
            const cleanedFrameCanvas = await window.ChromaKey.removeWhiteBackground(frameImg, {
              hardThreshold: 248,
              softThreshold: 215,
              satTolerance: 0.10,
              feather: 1,
            });
            // Vẽ đè lên camera → objects 3D nổi khối
            ctx.drawImage(cleanedFrameCanvas, 0, 0, W, H);
            console.log('[Frame Overlay] ✅ ChromaKey tách nền frame → camera tràn viền');
          } catch (err) {
            console.warn('[Frame ChromaKey] Lỗi, fallback vẽ nguyên bản:', err);
            ctx.drawImage(frameImg, 0, 0, W, H);
          }
        }

        // ═══════════════════════════════════════════════
        // ⭐ BƯỚC 2: Vẽ TEXT OVERLAY — trên cùng
        // ═══════════════════════════════════════════════
        if (options.textOverlayUrl) {
          try {
            const textImg = await new Promise((res, rej) => {
              const im = new Image();
              im.crossOrigin = 'anonymous';
              im.onload = () => res(im);
              im.onerror = rej;
              im.src = options.textOverlayUrl;
            });

            if (options.textRemoveBg) {
              // ⭐ Flood-fill xóa nền trắng — giữ viền chữ
              const cleaned = removeWhiteBackgroundFloodFill(textImg);
              ctx.drawImage(cleaned, 0, 0, W, H);
              console.log('[Text Overlay] Flood-fill xóa nền');
            } else {
              ctx.drawImage(textImg, 0, 0, W, H);
              console.log('[Text Overlay] Vẽ nguyên bản');
            }
          } catch (err) {
            console.warn('[Text Overlay] Không load được:', err);
          }
        }

                // ⭐ BƯỚC 3: Hashtag — hỗ trợ 6 phong cách
        if (!options.skipHashtag && window.__currentHashtags && window.__currentHashtags.length > 0) {
          const hx = (window.__hashtagX != null ? window.__hashtagX : 0.5) * W;
          const hy = (window.__hashtagY != null ? window.__hashtagY : 0.92) * H;
          const size = window.__hashtagSize || 32;
          const color = window.__hashtagColor || '#38bdf8';
          const rotation = window.__hashtagRotation || 0;
          const style = window.__hashtagStyle || 'default';
          const text = window.__currentHashtags.map((t) => '#' + t).join('  ');

          ctx.save();
          ctx.translate(hx, hy);
          ctx.rotate((rotation * Math.PI) / 180);
          ctx.font = `900 ${size}px "Segoe UI", "Arial Black", Arial, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;

          const strokeW = Math.max(2, size * 0.10);

          if (style === 'outline') {
            // Viền trắng dày + viền đen bọc ngoài + fill màu
            ctx.strokeStyle = '#000';
            ctx.lineWidth = strokeW * 2.4;
            ctx.strokeText(text, 0, 0);
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = strokeW * 1.1;
            ctx.strokeText(text, 0, 0);
            ctx.fillStyle = color;
            ctx.fillText(text, 0, 0);
          } else if (style === 'shadow') {
            // Đổ bóng 3D
            ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
            ctx.shadowBlur = size * 0.15;
            ctx.shadowOffsetX = size * 0.10;
            ctx.shadowOffsetY = size * 0.14;
            ctx.fillStyle = color;
            ctx.fillText(text, 0, 0);
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
            ctx.lineWidth = Math.max(1, size * 0.03);
            ctx.strokeText(text, 0, 0);
          } else if (style === 'glow') {
            // Phát sáng
            ctx.shadowColor = color;
            ctx.shadowBlur = size * 0.7;
            ctx.fillStyle = '#fff';
            ctx.fillText(text, 0, 0);
            ctx.fillText(text, 0, 0);
            ctx.shadowBlur = 0;
            ctx.fillStyle = color;
            ctx.fillText(text, 0, 0);
          } else if (style === 'neon') {
            // Neon nhiều lớp
            ctx.shadowColor = color;
            ctx.shadowBlur = size * 1.0;
            ctx.fillStyle = color;
            ctx.fillText(text, 0, 0);
            ctx.shadowBlur = size * 0.55;
            ctx.fillText(text, 0, 0);
            ctx.shadowBlur = size * 0.20;
            ctx.fillStyle = '#fff';
            ctx.fillText(text, 0, 0);
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#fff';
            ctx.fillText(text, 0, 0);
          } else if (style === 'gradient') {
            // Gradient dọc + viền đen
            const grad = ctx.createLinearGradient(0, -size * 0.9, 0, size * 0.9);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.5, color);
            grad.addColorStop(1, '#0a1628');
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
            ctx.lineWidth = strokeW;
            ctx.strokeText(text, 0, 0);
            ctx.fillStyle = grad;
            ctx.fillText(text, 0, 0);
          } else {
            // default — viền đen mỏng + fill màu
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
            ctx.lineWidth = strokeW;
            ctx.strokeText(text, 0, 0);
            ctx.fillStyle = color;
            ctx.fillText(text, 0, 0);
          }

          ctx.restore();
        }

        resolve(canvas.toDataURL('image/jpeg', 0.95));
      } catch (err) {
        console.error('[Generate Error]', err);
        reject(err);
      }
    };

    if (hasFrame) {
      frameImg.onload = finish;
      frameImg.onerror = () => reject(new Error('Không tải được ảnh khung.'));
    } else {
      finish();
    }
  });
};

window.dataURLtoBlob = function (dataURL) {
  const [header, base64] = dataURL.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(base64);
  const len = binary.length;
  const buffer = new Uint8Array(len);
  for (let i = 0; i < len; i++) buffer[i] = binary.charCodeAt(i);
  return new Blob([buffer], { type: mime });
};

window.LAYOUTS = LAYOUTS;
window.FrameAI = FrameAI;