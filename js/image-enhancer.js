// ============================================
// SMART AI IMAGE ENHANCER — Bright Clean Portrait
// Style: sáng, sạch, hồng hào, cao cấp
// ============================================
const ImageEnhancer = (() => {

  function analyzeImage(data, w, h) {
    const histLum = new Uint32Array(256);
    let sumR = 0, sumG = 0, sumB = 0, sumLum = 0, sumLum2 = 0;
    let darkPx = 0, brightPx = 0, satSum = 0;
    const step = 4 * 4;
    let sampleCount = 0;

    for (let i = 0; i < data.length; i += step) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = (r * 299 + g * 587 + b * 114) / 1000;
      histLum[lum | 0]++;
      sumR += r; sumG += g; sumB += b;
      sumLum += lum; sumLum2 += lum * lum;
      if (lum < 40) darkPx++;
      if (lum > 220) brightPx++;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      satSum += sat;
      sampleCount++;
    }

    const avgR = sumR / sampleCount;
    const avgG = sumG / sampleCount;
    const avgB = sumB / sampleCount;
    const avgLum = sumLum / sampleCount;
    const variance = sumLum2 / sampleCount - avgLum * avgLum;
    const stdLum = Math.sqrt(Math.max(0, variance));
    const darkRatio = darkPx / sampleCount;
    const brightRatio = brightPx / sampleCount;
    const avgSat = satSum / sampleCount;

    let cum = 0;
    let p1 = 0, p5 = 0, p50 = 0, p95 = 0, p99 = 0;
    const s1 = sampleCount * 0.01, s5 = sampleCount * 0.05, s50 = sampleCount * 0.50;
    const s95 = sampleCount * 0.95, s99 = sampleCount * 0.99;
    for (let i = 0; i < 256; i++) {
      cum += histLum[i];
      if (p1 === 0 && cum >= s1) p1 = i;
      if (p5 === 0 && cum >= s5) p5 = i;
      if (p50 === 0 && cum >= s50) p50 = i;
      if (p95 === 0 && cum >= s95) p95 = i;
      if (p99 === 0 && cum >= s99) p99 = i;
    }

    return { avgR, avgG, avgB, avgLum, stdLum, darkRatio, brightRatio, avgSat, p1, p5, p50, p95, p99 };
  }

  function buildRecipe(stats) {
    const recipe = {
      whiteBalance: { kr: 1, kg: 1, kb: 1, strength: 0 },
      exposure: 0.08,
      contrast: 0.08,
      shadows: 0.25,
      highlights: 0.15,
      saturation: 0.05,
      vibrance: 0.20,
      warmth: 0.05,
      gamma: 1.05,
      clarity: 0.15,
      vignette: 0.05,
    };

    const avgGray = (stats.avgR + stats.avgG + stats.avgB) / 3;
    const krRaw = avgGray / stats.avgR;
    const kgRaw = avgGray / stats.avgG;
    const kbRaw = avgGray / stats.avgB;
    const maxDev = Math.max(Math.abs(krRaw - 1), Math.abs(kgRaw - 1), Math.abs(kbRaw - 1));
    if (maxDev > 0.08) {
      recipe.whiteBalance = {
        kr: Math.min(1.10, Math.max(0.90, krRaw)),
        kg: Math.min(1.10, Math.max(0.90, kgRaw)),
        kb: Math.min(1.10, Math.max(0.90, kbRaw)),
        strength: Math.min(0.7, maxDev * 4),
      };
    }

    const target = 145;
    const delta = (target - stats.avgLum) / 255;
    if (stats.avgLum < 100) recipe.exposure = 0.35;
    else if (stats.avgLum < 130) recipe.exposure = 0.18;
    else if (stats.avgLum > 185) recipe.exposure = -0.05;
    else recipe.exposure = delta * 0.5;

    if (stats.stdLum < 45) recipe.contrast = 0.15;
    else if (stats.stdLum > 85) recipe.contrast = -0.05;

    if (stats.darkRatio > 0.15) recipe.shadows = 0.45;
    if (stats.brightRatio > 0.10) recipe.highlights = 0.30;

    if (stats.p5 < 40) recipe.shadows = Math.max(recipe.shadows, 0.40);
    if (stats.p95 > 230) recipe.highlights = Math.max(recipe.highlights, 0.25);

    if (stats.avgSat < 0.28) {
      recipe.vibrance = 0.35;
      recipe.saturation = 0.10;
    } else if (stats.avgSat > 0.55) {
      recipe.saturation = -0.05;
      recipe.vibrance = 0.15;
    }

    const bToR = stats.avgB - stats.avgR;
    if (bToR > 20) recipe.warmth = 0.20;
    else if (bToR > 5) recipe.warmth = 0.10;
    else if (bToR < -30) recipe.warmth = -0.08;
    else recipe.warmth = 0.08;

    if (stats.p50 < 110) recipe.gamma = 1.15;
    else if (stats.p50 > 175) recipe.gamma = 0.98;
    else recipe.gamma = 1.06;

    return recipe;
  }

  function applyWhiteBalance(data, wb) {
    if (wb.strength < 0.01) return;
    const { kr, kg, kb, strength } = wb;
    const r1 = 1 + (kr - 1) * strength;
    const g1 = 1 + (kg - 1) * strength;
    const b1 = 1 + (kb - 1) * strength;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, data[i] * r1);
      data[i + 1] = Math.min(255, data[i + 1] * g1);
      data[i + 2] = Math.min(255, data[i + 2] * b1);
    }
  }

  function applyToneCurve(data, recipe) {
    const lut = new Uint8Array(256);
    const exp = recipe.exposure, contrast = recipe.contrast, gamma = recipe.gamma;
    const shadows = recipe.shadows, highlights = recipe.highlights;

    for (let i = 0; i < 256; i++) {
      let v = i / 255;
      v = v * Math.pow(2, exp);
      v = Math.min(1, Math.max(0, v));

      if (shadows > 0) {
        const shadowMask = Math.pow(1 - v, 2.5);
        v = v + shadows * shadowMask * 0.40;
        v = Math.min(1, v);
      }
      if (highlights > 0) {
        const highlightMask = Math.pow(v, 2.5);
        v = v - highlights * highlightMask * 0.35;
        v = Math.max(0, v);
      }
      if (Math.abs(contrast) > 0.01) {
        const c = contrast;
        if (c > 0) v = v + c * (v - 0.5) * (1 - Math.abs(v - 0.5) * 1.8);
        else v = v + c * (v - 0.5);
        v = Math.min(1, Math.max(0, v));
      }
      if (gamma !== 1.0) v = Math.pow(v, 1 / gamma);
      lut[i] = Math.min(255, Math.max(0, Math.round(v * 255)));
    }
    for (let i = 0; i < data.length; i += 4) {
      data[i] = lut[data[i]];
      data[i + 1] = lut[data[i + 1]];
      data[i + 2] = lut[data[i + 2]];
    }
  }

  function applyColorGrading(data, recipe) {
    const sat = recipe.saturation, vib = recipe.vibrance, warm = recipe.warmth;
    const wShift = warm * 18;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const pixSat = max === 0 ? 0 : (max - min) / max;

      if (Math.abs(sat) > 0.01) {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const sFactor = 1 + sat;
        r = gray + (r - gray) * sFactor;
        g = gray + (g - gray) * sFactor;
        b = gray + (b - gray) * sFactor;
      }
      if (vib > 0.01) {
        const vibFactor = 1 + vib * (1 - pixSat);
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = gray + (r - gray) * vibFactor;
        g = gray + (g - gray) * vibFactor;
        b = gray + (b - gray) * vibFactor;
      }
      if (Math.abs(warm) > 0.01) {
        r += wShift * (1 - pixSat * 0.5);
        b -= wShift * (1 - pixSat * 0.5);
      }
      data[i] = Math.min(255, Math.max(0, r));
      data[i + 1] = Math.min(255, Math.max(0, g));
      data[i + 2] = Math.min(255, Math.max(0, b));
    }
  }

  function applyClarity(data, w, h, amount) {
    if (amount <= 0) return;
    const src = new Uint8ClampedArray(data);
    const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
    const kSum = 16;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          let blur = 0, ki = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const p = ((y + dy) * w + (x + dx)) * 4 + c;
              blur += src[p] * kernel[ki++];
            }
          }
          blur /= kSum;
          const orig = src[idx + c];
          data[idx + c] = Math.min(255, Math.max(0, orig + (orig - blur) * amount));
        }
      }
    }
  }

  function applyVignette(data, w, h, strength) {
    if (strength <= 0) return;
    const cx = w / 2, cy = h / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
        let v = 1;
        if (dist > 0.7) v = 1 - (dist - 0.7) / 0.3 * strength;
        v = Math.max(1 - strength, v);
        const idx = (y * w + x) * 4;
        data[idx] *= v;
        data[idx + 1] *= v;
        data[idx + 2] *= v;
      }
    }
  }

  function enhanceCanvas(sourceCanvas) {
    const w = sourceCanvas.width, h = sourceCanvas.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(sourceCanvas, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;

    const stats = analyzeImage(d, w, h);
    const recipe = buildRecipe(stats);

    console.log('[AI Enhance] Stats:', {
      avgLum: stats.avgLum.toFixed(1),
      avgSat: stats.avgSat.toFixed(3),
      p5: stats.p5, p50: stats.p50, p95: stats.p95,
    });
    console.log('[AI Enhance] Recipe:', recipe);

    applyWhiteBalance(d, recipe.whiteBalance);
    applyToneCurve(d, recipe);
    applyColorGrading(d, recipe);
    if (recipe.clarity > 0) applyClarity(d, w, h, recipe.clarity);
    if (recipe.vignette > 0) applyVignette(d, w, h, recipe.vignette);

    ctx.putImageData(imageData, 0, 0);
    return { canvas: out, recipe, stats };
  }

  async function enhancePhoto(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        const { canvas: out } = enhanceCanvas(canvas);
        resolve(out.toDataURL('image/jpeg', 0.95));
      };
      img.onerror = () => reject(new Error('Không tải được ảnh'));
      img.src = source;
    });
  }

  return { enhanceCanvas, enhancePhoto, analyzeImage, buildRecipe };
})();

window.ImageEnhancer = ImageEnhancer;