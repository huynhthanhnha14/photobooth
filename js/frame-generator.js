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

    return valid.map((c) => {
      const sw = c.maxX - c.minX + 1;
      const sh = c.maxY - c.minY + 1;
      const fillRatio = c.area / (sw * sh);
      const aspect = Math.abs(sw - sh) / Math.max(sw, sh);
      const isCircle = fillRatio > 0.62 && fillRatio < 0.88 && aspect < 0.25;
      return { x: c.minX, y: c.minY, w: sw, h: sh, isBrightBox: true, isCircle };
    });
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

    return valid.map((c) => {
      const sw = c.maxX - c.minX + 1;
      const sh = c.maxY - c.minY + 1;
      const fillRatio = c.area / (sw * sh);
      const aspect = Math.abs(sw - sh) / Math.max(sw, sh);
      const isCircle = fillRatio > 0.62 && fillRatio < 0.88 && aspect < 0.25;
      return { x: c.minX, y: c.minY, w: sw, h: sh, isBrightBox: false, isCircle };
    });
  }

  function detect(frameImg, expectedCount) {
    const { data, w, h } = getImageData(frameImg);
    const whiteBoxes = detectWhiteBoxes(data, w, h, expectedCount);
    if (whiteBoxes.length >= expectedCount) {
      console.log('[AI] Tìm thấy', whiteBoxes.length, 'ô trắng/xám');
      return whiteBoxes.slice(0, expectedCount);
    }
    const alphaBoxes = detectByAlpha(data, w, h, expectedCount);
    if (alphaBoxes.length > 0) {
      console.log('[AI] Fallback alpha:', alphaBoxes.length, 'ô');
      return alphaBoxes;
    }
    console.warn('[AI] Không tìm được ô nào');
    return whiteBoxes;
  }

  return { detect };
})();

function drawImageInSlot(ctx, img, sx, sy, sw, sh, isCircle) {
  sx = Math.round(sx); sy = Math.round(sy);
  sw = Math.round(sw); sh = Math.round(sh);
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const slotRatio = sw / sh;
  let drawW, drawH;
  if (imgRatio > slotRatio) { drawH = sh; drawW = sh * imgRatio; }
  else { drawW = sw; drawH = sw / imgRatio; }
  const offsetX = sx + (sw - drawW) / 2;
  const offsetY = sy + (sh - drawH) / 2;
  ctx.save();
  ctx.beginPath();
  if (isCircle) {
    ctx.arc(sx + sw / 2, sy + sh / 2, Math.min(sw, sh) / 2, 0, Math.PI * 2);
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

window.generatePhotoStrip = function (frameUrl, userPhotos, layout = 'auto', options = {}) {
  return new Promise((resolve, reject) => {
    const frameImg = new Image();
    frameImg.crossOrigin = 'anonymous';
    frameImg.src = frameUrl;

    frameImg.onload = async () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = frameImg.naturalWidth;
        canvas.height = frameImg.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const W = canvas.width;
        const H = canvas.height;

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

        const shapeType = options.shapeType || 'rect';
        const shapeValue = options.shapeValue || '';
        let finalSlots = [];
        let isShapeMode = false;

        if (shapeType !== 'rect' && window.ShapeGenerator) {
          isShapeMode = true;
          const shapeSlots = window.ShapeGenerator.generateSlots(shapeType, shapeValue, photoImgs.length);
          finalSlots = shapeSlots.map((s) => ({
            x: s.x * W, y: s.y * H,
            w: s.w * W, h: s.h * H,
            isCircle: false,
          }));
        } else {
          let slots = null;
          if (layout === 'auto') {
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
            finalSlots = ratioSlots.map(([rx, ry, rw, rh]) => ({
              x: rx * W, y: ry * H,
              w: rw * W, h: rh * H,
              isCircle: isCircleLayout,
            }));
          }
        }

        // ⭐ Bước 1: Vẽ ảnh user vào slot
        photoImgs.forEach((img, i) => {
          const s = finalSlots[i % finalSlots.length];
          if (s) drawImageInSlot(ctx, img, s.x, s.y, s.w, s.h, s.isCircle);
        });

        // ⭐ Bước 2: AI tách chữ — chỉ xóa nền nhạt, giữ chữ
        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = W;
        frameCanvas.height = H;
        const frameCtx = frameCanvas.getContext('2d', { willReadFrequently: true });
        frameCtx.drawImage(frameImg, 0, 0);

        if (isShapeMode) {
          const mask = window.ShapeGenerator.renderShapeMask(shapeType, shapeValue, W, H);
          smartClearShape(frameCtx, mask, W, H);
        } else {
          finalSlots.forEach((s) => smartClearSlot(frameCtx, s, W, H));
        }

        // ⭐ Bước 3: Vẽ frame (chữ đè camera)
        ctx.drawImage(frameCanvas, 0, 0);

        // ⭐ Bước 4: Text overlay riêng
        if (options.textOverlayUrl) {
          try {
            const textImg = await new Promise((res, rej) => {
              const im = new Image();
              im.crossOrigin = 'anonymous';
              im.onload = () => res(im);
              im.onerror = rej;
              im.src = options.textOverlayUrl;
            });
            ctx.drawImage(textImg, 0, 0, W, H);
          } catch (err) {
            console.warn('[Text Overlay] Không load được:', err);
          }
        }

        // ⭐ Bước 5: Hashtag (CÓ XOAY)
        if (!options.skipHashtag && window.__currentHashtags && window.__currentHashtags.length > 0) {
          const hx = (window.__hashtagX != null ? window.__hashtagX : 0.5) * W;
          const hy = (window.__hashtagY != null ? window.__hashtagY : 0.92) * H;
          const size = window.__hashtagSize || 32;
          const color = window.__hashtagColor || '#38bdf8';
          const rotation = window.__hashtagRotation || 0;
          const text = window.__currentHashtags.map((t) => '#' + t).join('  ');

          ctx.save();
          ctx.translate(hx, hy);
          ctx.rotate((rotation * Math.PI) / 180);
          ctx.font = `900 ${size}px "Segoe UI", Arial, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
          ctx.lineWidth = Math.max(2, size * 0.08);
          ctx.lineJoin = 'round';
          ctx.strokeText(text, 0, 0);
          ctx.fillStyle = color;
          ctx.fillText(text, 0, 0);
          ctx.restore();
        }

        resolve(canvas.toDataURL('image/jpeg', 0.95));
      } catch (err) {
        console.error('[Generate Error]', err);
        reject(err);
      }
    };

    frameImg.onerror = () => reject(new Error('Không tải được ảnh khung.'));
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