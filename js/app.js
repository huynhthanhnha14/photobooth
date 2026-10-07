(function () {
  const supabase = window.supabaseClient;
  const cfg = window.APP_CONFIG;

  const state = {
    frames: [], hashtags: [],
    selectedFrame: null, selectedTags: [],
    allPhotos: [], pickedIndices: [], photos: [],
    combinedPreview: null,
    tuneOverride: null,
  };

  let camera = null;
  let previewStream = null;
  let _previewFrameOriginal = null;
  let _previewFrameCleared = null;

  // ⭐ Realtime sync
  let _rtRoomId = null;
  let _rtConnected = false;
  let _rtStreamTimer = null;
  let _rtHeartbeatTimer = null;
  let _currentFacingMode = 'user';

  const $ = (sel) => document.querySelector(sel);
  const steps = {
    select: $('#step-select'),
    capture: $('#step-capture'),
    pick: $('#step-pick'),
    decorate: $('#step-decorate'),
    result: $('#step-result'),
  };

  function showStep(name) {
    Object.values(steps).forEach((el) => el.classList.remove('active'));
    steps[name].classList.add('active');
    const stepMap = { select: 1, capture: 2, pick: 3, decorate: 4, result: 5 };
    const cur = stepMap[name] || 1;
    document.querySelectorAll('.progress-step').forEach((el) => {
      const s = parseInt(el.dataset.step, 10);
      el.classList.toggle('active', s === cur);
      el.classList.toggle('done', s < cur);
    });
  }

  function toast(msg, type = 'info') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast show ${type}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.className = 'toast'), 3000);
  }

  function loadImageEl(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Không tải được ảnh'));
      img.src = src;
    });
  }

  // ============================================
  // PREVIEW CAMERA
  // ============================================
  async function startPreviewCamera() {
    try {
      if (previewStream) return;

      previewStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: _currentFacingMode,
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      const previewVideo = $('#preview-video');
      previewVideo.srcObject = previewStream;
      await previewVideo.play();

      $('#camera-status').classList.add('active');
      $('#camera-status-text').textContent = 'Camera đang bật';
      $('#cam-toggle-icon').textContent = '📷';
      $('#cam-toggle-text').textContent = 'Tắt camera';

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter((d) => d.kind === 'videoinput');
        const btnSwitch = $('#btn-switch-camera');
        if (btnSwitch) btnSwitch.style.display = cams.length > 1 ? 'flex' : 'none';
      } catch (e) { /* ignore */ }

      refreshPreviewFrameImage();
    } catch (err) {
      console.error('Không mở được camera preview:', err);
      toast('Không thể mở camera: ' + err.message, 'error');
    }
  }

  function stopPreviewCamera() {
    if (previewStream) {
      previewStream.getTracks().forEach((t) => t.stop());
      previewStream = null;
      $('#camera-status').classList.remove('active');
      $('#camera-status-text').textContent = 'Camera đang tắt';
      $('#cam-toggle-icon').textContent = '📷';
      $('#cam-toggle-text').textContent = 'Bật camera';
      refreshPreviewFrameImage();
    }
  }

  async function switchCamera() {
    try {
      if (previewStream) {
        previewStream.getTracks().forEach((t) => t.stop());
        previewStream = null;
      }
      _currentFacingMode = _currentFacingMode === 'user' ? 'environment' : 'user';
      await startPreviewCamera();
      const label = $('#switch-cam-text');
      if (label) {
        label.textContent = _currentFacingMode === 'user' ? 'Đổi sang camera sau' : 'Đổi sang camera trước';
      }
    } catch (err) {
      toast('Không đổi được camera: ' + err.message, 'error');
    }
  }

  $('#btn-toggle-camera').addEventListener('click', () => {
    if (previewStream) stopPreviewCamera();
    else startPreviewCamera();
  });

  const btnSwitchCam = document.getElementById('btn-switch-camera');
  if (btnSwitchCam) btnSwitchCam.addEventListener('click', switchCamera);

  window.addEventListener('load', () => {
    setTimeout(() => startPreviewCamera(), 500);
  });

  // ============================================
  // NÚT ZOOM PREVIEW
  // ============================================
  const btnZoom = document.getElementById('btn-zoom-preview');
  const previewBox = document.getElementById('camera-preview-box');
  const zoomIcon = document.getElementById('zoom-icon');

  function toggleZoom() {
    if (!previewBox || !zoomIcon) return;
    previewBox.classList.toggle('zoomed');
    zoomIcon.textContent = previewBox.classList.contains('zoomed') ? '✕' : '🔍';
  }

  function closeZoom() {
    if (!previewBox || !zoomIcon) return;
    previewBox.classList.remove('zoomed');
    zoomIcon.textContent = '🔍';
  }

  if (btnZoom && previewBox && zoomIcon) {
    btnZoom.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleZoom();
    });

    previewBox.addEventListener('click', (e) => {
      if (previewBox.classList.contains('zoomed') && e.target === previewBox) {
        closeZoom();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeZoom();
    });
  }

  // ============================================
  // COMPUTE SLOTS
  // ============================================
  async function computeSlots(frameImg, layout, photoCount) {
    const W = frameImg.naturalWidth;
    const H = frameImg.naturalHeight;

    if (layout === 'auto') {
      try {
        if (window.FrameAI) {
          const detected = window.FrameAI.detect(frameImg, photoCount);
          if (detected && detected.length > 0) return detected;
        }
      } catch (err) { console.warn('[Preview] AI lỗi:', err); }
    }

    const layoutFn = (window.LAYOUTS && window.LAYOUTS[layout]) || (window.LAYOUTS && window.LAYOUTS['center-box']);
    if (!layoutFn) return [];
    const ratioSlots = layoutFn(photoCount);
    const isCircle = String(layout).startsWith('circle');

    return ratioSlots.map(([rx, ry, rw, rh]) => ({
      x: rx * W, y: ry * H,
      w: rw * W, h: rh * H,
      isBrightBox: false,
      isCircle,
    }));
  }

  function smartClearPreview(frameCtx, slot, W, H) {
    const x = Math.floor(slot.x);
    const y = Math.floor(slot.y);
    const w = Math.min(Math.ceil(slot.w), W - x);
    const h = Math.min(Math.ceil(slot.h), H - y);

    if (w <= 0 || h <= 0) return;

    try {
      const imgData = frameCtx.getImageData(x, y, w, h);
      const d = imgData.data;
      const cx = w / 2, cy = h / 2;
      const radiusSq = Math.pow(Math.min(w, h) / 2, 2);

      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const idx = (py * w + px) * 4;

          if (slot.isCircle) {
            const dx = (px + 0.5) - cx;
            const dy = (py + 0.5) - cy;
            if (dx * dx + dy * dy > radiusSq) continue;
          }

          const r = d[idx], g = d[idx + 1], b = d[idx + 2], a = d[idx + 3];
          const isTransparent = a < 50;
          const isBrightWhite = r > 220 && g > 220 && b > 220;
          const isLightGray = Math.abs(r - g) < 20 && Math.abs(g - b) < 20 && r > 195 && r < 240;

          if (isTransparent || isBrightWhite || isLightGray) {
            d[idx + 3] = 0;
          }
        }
      }
      frameCtx.putImageData(imgData, x, y);
    } catch (e) {
      frameCtx.clearRect(x, y, w, h);
    }
  }

  // ============================================
  // UPDATE PREVIEW OVERLAY
  // ============================================
  async function updatePreviewOverlay() {
    const box = document.getElementById('camera-preview-box');
    const overlay = document.getElementById('preview-frame-overlay');
    const placeholder = document.getElementById('preview-placeholder');
    const textOverlay = document.getElementById('preview-text-overlay');

    if (!box || !overlay || !placeholder) return;

    if (!state.selectedFrame) {
      overlay.classList.remove('show');
      overlay.removeAttribute('src');
      placeholder.classList.remove('hidden');
      box.style.setProperty('--frame-aspect', '3 / 4');
      _previewFrameOriginal = null;
      _previewFrameCleared = null;
      if (textOverlay) { textOverlay.removeAttribute('src'); textOverlay.style.display = 'none'; }
      return;
    }

    try {
      const frameImg = await loadImageEl(state.selectedFrame.image_url);
      if (!frameImg.naturalWidth) return;

      const W = frameImg.naturalWidth;
      const H = frameImg.naturalHeight;
      box.style.setProperty('--frame-aspect', `${W} / ${H}`);

      _previewFrameOriginal = frameImg.src;

      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(frameImg, 0, 0);

      const shapeType = state.selectedFrame.shape_type || 'rect';
      const shapeValue = state.selectedFrame.shape_value || '';

      if (shapeType !== 'rect' && window.ShapeGenerator) {
        const mask = window.ShapeGenerator.renderShapeMask(shapeType, shapeValue, W, H);
        try {
          const imgData = ctx.getImageData(0, 0, W, H);
          const maskData = mask.getContext('2d').getImageData(0, 0, W, H).data;
          const d = imgData.data;
          for (let i = 0; i < d.length; i += 4) {
            if (maskData[i + 3] > 128) {
              const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
              const isTransparent = a < 50;
              const isBrightWhite = r > 220 && g > 220 && b > 220;
              const isLightGray = Math.abs(r - g) < 20 && Math.abs(g - b) < 20 && r > 195 && r < 240;
              if (isTransparent || isBrightWhite || isLightGray) {
                d[i + 3] = 0;
              }
            }
          }
          ctx.putImageData(imgData, 0, 0);
        } catch (e) {
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.drawImage(mask, 0, 0);
          ctx.restore();
        }
      } else {
        const layout = state.selectedFrame.layout || 'auto';
        const photoCount = state.selectedFrame.photo_count || 1;
        const slots = await computeSlots(frameImg, layout, photoCount);
        slots.forEach((s) => smartClearPreview(ctx, s, W, H));
      }

      _previewFrameCleared = c.toDataURL('image/png');

      refreshPreviewFrameImage();
      overlay.classList.add('show');
      placeholder.classList.add('hidden');

      if (textOverlay) {
        const url = state.selectedFrame.text_overlay_url;
        if (url) {
          textOverlay.src = url;
          textOverlay.style.display = 'block';
        } else {
          textOverlay.removeAttribute('src');
          textOverlay.style.display = 'none';
        }
      }
    } catch (err) {
      console.error('[Preview] Lỗi:', err);
    }
  }

  function refreshPreviewFrameImage() {
    const overlay = document.getElementById('preview-frame-overlay');
    if (!overlay) return;
    const hasVideo = previewStream && previewStream.active;
    if (hasVideo && _previewFrameCleared) {
      if (overlay.getAttribute('src') !== _previewFrameCleared) overlay.src = _previewFrameCleared;
    } else if (_previewFrameOriginal) {
      if (overlay.getAttribute('src') !== _previewFrameOriginal) overlay.src = _previewFrameOriginal;
    }
  }

  // ============================================
  // SELECT FRAME
  // ============================================
  async function selectFrame(frame) {
    if (!frame) return;
    state.selectedFrame = frame;
    state.tuneOverride = null;

    document.querySelectorAll('.frame-item').forEach((el) => {
      el.classList.toggle('selected', el.dataset.id === frame.id);
    });

    $('#btn-continue').disabled = false;
    updateSelectedFrameInfo();
    await updatePreviewOverlay();
    toast(`Đã chọn: ${frame.name}`, 'success');

    broadcastFullState();
  }

  // ============================================
  // FRAME PREVIEW MODAL
  // ============================================
  const fpModal = $('#frame-preview-modal');
  const fpImage = $('#fp-image');
  const fpName = $('#fp-name');
  const fpSlots = $('#fp-slots');
  const fpCaptures = $('#fp-captures');
  const fpDims = $('#fp-dims');
  const fpSelectBtn = $('#fp-select-btn');
  const fpCancelBtn = $('#fp-cancel-btn');
  const fpCloseBtn = fpModal.querySelector('.frame-preview-close');

  let previewingFrame = null;

  function openFramePreview(frame) {
    previewingFrame = frame;
    fpName.textContent = frame.name || 'Khung không tên';
    fpSlots.textContent = `${frame.photo_count || 1} ô ảnh`;
    fpCaptures.textContent = `Chụp ${frame.capture_count || 3} tấm`;
    fpImage.src = frame.image_url;

    const tmpImg = new Image();
    tmpImg.onload = () => { fpDims.textContent = `${tmpImg.naturalWidth} × ${tmpImg.naturalHeight}px`; };
    tmpImg.onerror = () => { fpDims.textContent = '—'; };
    tmpImg.src = frame.image_url;

    fpModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeFramePreview() {
    fpModal.classList.remove('active');
    document.body.style.overflow = '';
    previewingFrame = null;
  }

  async function selectFromPreview() {
    if (!previewingFrame) return;
    const frame = previewingFrame;
    closeFramePreview();
    await selectFrame(frame);
  }

  fpSelectBtn.addEventListener('click', selectFromPreview);
  fpCancelBtn.addEventListener('click', closeFramePreview);
  fpCloseBtn.addEventListener('click', closeFramePreview);
  fpModal.addEventListener('click', (e) => { if (e.target === fpModal) closeFramePreview(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && fpModal.classList.contains('active')) closeFramePreview();
  });

  // ============================================
  // UPDATE UI INFO
  // ============================================
  function updateSelectedFrameInfo() {
    if (!state.selectedFrame) {
      $('#selected-frame-name').textContent = '—';
      $('#selected-frame-meta').textContent = '—';
      return;
    }
    $('#selected-frame-name').textContent = state.selectedFrame.name;
    $('#selected-frame-meta').textContent =
      `${state.selectedFrame.photo_count || 1} ô · chụp ${state.selectedFrame.capture_count || 3} tấm`;
  }

  // ============================================
  // LOAD FRAMES
  // ============================================
  async function loadFrames() {
    const list = $('#frame-list');
    try {
      const { data, error } = await supabase
        .from('frames').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      state.frames = data || [];

      if (state.frames.length === 0) {
        list.innerHTML = '<p class="loading">Chưa có khung. Vào Quản trị để thêm.</p>';
        return;
      }

      list.innerHTML = state.frames.map((f) => `
        <div class="frame-item" data-id="${f.id}">
          <img src="${f.image_url}" alt="${f.name}" loading="lazy" />
          <div class="frame-info">${f.name}</div>
        </div>
      `).join('');

      list.querySelectorAll('.frame-item').forEach((el) => {
        el.addEventListener('click', async () => {
          const frame = state.frames.find((f) => f.id === el.dataset.id);
          if (frame) await selectFrame(frame);
        });
        el.addEventListener('dblclick', (e) => {
          e.preventDefault();
          const frame = state.frames.find((f) => f.id === el.dataset.id);
          if (frame) openFramePreview(frame);
        });
      });

      broadcastFullState();
    } catch (err) {
      console.error(err);
      list.innerHTML = `<p class="loading">Lỗi: ${err.message}</p>`;
    }
  }

  async function loadHashtags() {
    const list = $('#hashtag-list');
    try {
      const { data, error } = await supabase
        .from('hashtags').select('*').order('id', { ascending: true });
      if (error) throw error;
      state.hashtags = data || [];

      if (state.hashtags.length === 0) {
        list.innerHTML = '<p class="loading" style="font-size:11px;">Chưa có hashtag</p>';
        return;
      }
      list.innerHTML = state.hashtags.map((h) =>
        `<div class="hashtag" data-tag="${h.tag}">#${h.tag}</div>`
      ).join('');

      list.querySelectorAll('.hashtag').forEach((el) => {
        el.addEventListener('click', () => {
          const tag = el.dataset.tag;
          if (state.selectedTags.includes(tag)) {
            state.selectedTags = state.selectedTags.filter((t) => t !== tag);
            el.classList.remove('selected');
          } else {
            state.selectedTags.push(tag);
            el.classList.add('selected');
          }
          state.combinedPreview = null;
          schedulePreviewRender();

          RealtimeSync.sendState({ selectedTags: state.selectedTags });
        });
      });

      broadcastFullState();
    } catch (err) { console.error(err); }
  }

  async function uploadToBucket(bucket, blob, fileName) {
    const { error } = await supabase.storage
      .from(bucket)
      .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error(`Upload [${bucket}]: ${error.message}`);
    const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
    return data.publicUrl;
  }

  // ============================================
  // PICK GRID
  // ============================================
  function renderPickGrid() {
    const grid = $('#pick-grid');
    const need = state.selectedFrame.photo_count || 1;

    grid.innerHTML = state.allPhotos.map((src, i) => {
      const order = state.pickedIndices.indexOf(i);
      const isPicked = order !== -1;
      return `
        <div class="pick-item ${isPicked ? 'picked' : ''}" data-idx="${i}">
          <img src="${src}" alt="Ảnh ${i + 1}" />
          ${isPicked ? `<div class="pick-badge">${order + 1}</div>` : ''}
          <div class="pick-check">${isPicked ? '✓' : '+'}</div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.pick-item').forEach((el) => {
      const idx = parseInt(el.dataset.idx, 10);
      el.addEventListener('click', () => togglePick(idx));
      el.addEventListener('dblclick', () => {
        const items = state.allPhotos.map((s, i) => ({ src: s, caption: `Ảnh ${i + 1}/${state.allPhotos.length}` }));
        window.ZoomModal.open(items, idx);
      });
    });

    $('#pick-count').textContent = state.pickedIndices.length;
    $('#pick-total').textContent = need;
    $('#btn-picked-continue').disabled = state.pickedIndices.length !== need;
    state.photos = state.pickedIndices.map((i) => state.allPhotos[i]);

    const dotsEl = $('#pick-dots');
    if (dotsEl) {
      dotsEl.innerHTML = '';
      for (let i = 0; i < need; i++) {
        const dot = document.createElement('div');
        dot.className = `pick-dot ${i < state.pickedIndices.length ? 'filled' : ''}`;
        dot.textContent = i < state.pickedIndices.length ? (i + 1) : '';
        dotsEl.appendChild(dot);
      }
    }
  }

  function togglePick(idx) {
    const need = state.selectedFrame.photo_count || 1;
    const pos = state.pickedIndices.indexOf(idx);
    if (pos !== -1) state.pickedIndices.splice(pos, 1);
    else {
      if (state.pickedIndices.length >= need) {
        toast(`Chỉ được chọn ${need} tấm`, 'error');
        return;
      }
      state.pickedIndices.push(idx);
    }
    renderPickGrid();

    RealtimeSync.sendState({
      captureProgress: state.pickedIndices.length,
      captureTotal: need,
    });
  }

  // ============================================
  // HASHTAG + SHAPE + TEXT CONFIG
  // ============================================
  function getHashtagConfig() {
    const f = state.selectedFrame || {};
    const d = state.tuneOverride || {};
    return {
      x: d.x != null ? d.x : (f.hashtag_x ?? 0.5),
      y: d.y != null ? d.y : (f.hashtag_y ?? 0.92),
      size: d.size != null ? d.size : (f.hashtag_size || 32),
      color: d.color != null ? d.color : (f.hashtag_color || '#38bdf8'),
      rotation: d.rotation != null ? d.rotation : (f.hashtag_rotation || 0),
    };
  }

  function setHashtagContext() {
    const c = getHashtagConfig();
    window.__currentHashtags = state.selectedTags.slice();
    window.__hashtagX = c.x;
    window.__hashtagY = c.y;
    window.__hashtagSize = c.size;
    window.__hashtagColor = c.color;
    window.__hashtagRotation = c.rotation;
  }

  function getShapeOptions() {
    const f = state.selectedFrame || {};
    return {
      shapeType: f.shape_type || 'rect',
      shapeValue: f.shape_value || '',
      shapeScale: f.shape_scale != null ? f.shape_scale : 100,
      textOverlayUrl: f.text_overlay_url || '',
    };
  }

  let _tuneDebounce = null;
  function schedulePreviewRender() {
    const layer = document.getElementById('hashtag-drag-layer');
    if (layer && steps.decorate.classList.contains('active')) {
      updateHashtagDisplay();
      return;
    }
    clearTimeout(_tuneDebounce);
    _tuneDebounce = setTimeout(() => {
      if (state.photos.length && state.selectedFrame && steps.decorate.classList.contains('active')) {
        renderPreviewInDecorate();
      }
    }, 300);
  }

  // ============================================
  // RENDER PREVIEW DECORATE
  // ============================================
  async function renderPreviewInDecorate() {
    const wrap = $('#combined-preview-wrap');
    wrap.classList.remove('has-overlay');
    wrap.classList.add('loading-preview');
    wrap.innerHTML = `<div class="spinner"></div><p>AI đang xử lý...</p>`;

    try {
      const layout = state.selectedFrame.layout || 'auto';
      setHashtagContext();
      const shape = getShapeOptions();

      const combinedNoTag = await window.generatePhotoStrip(
        state.selectedFrame.image_url, state.photos, layout,
        { skipHashtag: true, ...shape }
      );

      wrap.classList.remove('loading-preview');
      wrap.classList.add('has-overlay');
      wrap.innerHTML = `
        <div class="preview-inner" id="preview-inner">
          <img id="combined-preview-img" src="${combinedNoTag}" alt="Ảnh ghép" />
          <div id="hashtag-drag-layer" class="hashtag-drag-layer">
            <span id="hashtag-text-el" class="hashtag-text"></span>
          </div>
        </div>
      `;

      const img = document.getElementById('combined-preview-img');
      if (!img.complete) await new Promise((r) => { img.onload = r; });

      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      setupHashtagOverlay();
      syncTunePanelUI();

      wrap.ondblclick = (e) => {
        e.preventDefault();
        window.ZoomModal.open([{ src: img.src, caption: 'Ảnh ghép (chưa hashtag)' }], 0);
      };

      state.combinedPreview = null;
    } catch (err) {
      console.error(err);
      wrap.innerHTML = `<p class="loading">Lỗi: ${err.message}</p>`;
      wrap.classList.remove('loading-preview');
    }
  }

  // ============================================
  // HASHTAG OVERLAY
  // ============================================
  function setupHashtagOverlay() {
    const layer = document.getElementById('hashtag-drag-layer');
    const img = document.getElementById('combined-preview-img');
    if (!layer || !img) return;
    updateHashtagDisplay();
    attachDragHandlers(layer);
  }

  function updateHashtagDisplay() {
    const layer = document.getElementById('hashtag-drag-layer');
    const span = document.getElementById('hashtag-text-el');
    const img = document.getElementById('combined-preview-img');
    if (!layer || !span || !img) return;

    const cfg = getHashtagConfig();
    const text = state.selectedTags.map((t) => '#' + t).join('  ');

    if (!text) {
      span.textContent = '';
      span.style.display = 'none';
      return;
    }
    span.textContent = text;
    span.style.display = '';

    const rect = layer.getBoundingClientRect();
    if (rect.width === 0) return;

    const scale = rect.width / (img.naturalWidth || rect.width);
    const displaySize = Math.max(12, Math.round(cfg.size * scale));

    span.style.fontSize = displaySize + 'px';
    span.style.color = cfg.color;
    span.style.left = (cfg.x * 100) + '%';
    span.style.top = (cfg.y * 100) + '%';
    span.style.transform = `translate(-50%, -50%) rotate(${cfg.rotation}deg)`;
  }

  function attachDragHandlers(layer) {
    if (layer._dragBound) return;
    layer._dragBound = true;

    let isDragging = false;

    const moveTo = (e) => {
      const rect = layer.getBoundingClientRect();
      if (rect.width === 0) return;

      let clientX, clientY;
      if (e.touches && e.touches.length) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }

      let x = (clientX - rect.left) / rect.width;
      let y = (clientY - rect.top) / rect.height;
      x = Math.max(0.02, Math.min(0.98, x));
      y = Math.max(0.02, Math.min(0.98, y));

      state.tuneOverride = { ...(state.tuneOverride || {}), x, y };
      updateHashtagDisplay();
    };

    const startDrag = (e) => {
      if (!state.selectedTags.length) {
        toast('Chọn hashtag trước rồi kéo nhé!', 'info');
        return;
      }
      e.preventDefault();
      isDragging = true;
      layer.classList.add('dragging');
      moveTo(e);

      document.addEventListener('mousemove', onDrag);
      document.addEventListener('mouseup', endDrag);
      document.addEventListener('touchmove', onDrag, { passive: false });
      document.addEventListener('touchend', endDrag);
    };

    const onDrag = (e) => {
      if (!isDragging) return;
      e.preventDefault();
      moveTo(e);
    };

    const endDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      layer.classList.remove('dragging');
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup', endDrag);
      document.removeEventListener('touchmove', onDrag);
      document.removeEventListener('touchend', endDrag);
      syncTunePanelUI();
    };

    layer.addEventListener('mousedown', startDrag);
    layer.addEventListener('touchstart', startDrag, { passive: false });
  }

  function drawHashtagOnOverlay() { updateHashtagDisplay(); }

  // ============================================
  // TUNE PANEL
  // ============================================
  const TUNE_PRESETS = {
    'top-left':      [0.12, 0.08],
    'top-center':    [0.5, 0.08],
    'top-right':     [0.88, 0.08],
    'center':        [0.5, 0.5],
    'bottom-center': [0.5, 0.92],
    'bottom-left':   [0.12, 0.92],
    'bottom-right':  [0.88, 0.92],
  };

  function syncTunePanelUI() {
    const cfg = getHashtagConfig();
    let matched = null;
    for (const [key, [px, py]] of Object.entries(TUNE_PRESETS)) {
      if (Math.abs(px - cfg.x) < 0.02 && Math.abs(py - cfg.y) < 0.02) { matched = key; break; }
    }
    document.querySelectorAll('.pos-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.pos === matched);
    });
    const sizeEl = document.getElementById('tune-size');
    const sizeVal = document.getElementById('tune-size-val');
    if (sizeEl) sizeEl.value = cfg.size;
    if (sizeVal) sizeVal.textContent = cfg.size;

    const rotateEl = document.getElementById('tune-rotate');
    const rotateVal = document.getElementById('tune-rotate-val');
    if (rotateEl) rotateEl.value = cfg.rotation;
    if (rotateVal) rotateVal.textContent = cfg.rotation;

    document.querySelectorAll('.color-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.color.toLowerCase() === cfg.color.toLowerCase());
    });
    const customColor = document.getElementById('tune-color-custom');
    if (customColor) customColor.value = cfg.color;
  }

  document.querySelectorAll('.pos-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [x, y] = TUNE_PRESETS[btn.dataset.pos] || [0.5, 0.92];
      state.tuneOverride = { ...(state.tuneOverride || {}), x, y };
      state.combinedPreview = null;
      syncTunePanelUI();
      schedulePreviewRender();
    });
  });

  const sizeSlider = document.getElementById('tune-size');
  if (sizeSlider) {
    sizeSlider.addEventListener('input', (e) => {
      const size = parseInt(e.target.value, 10);
      document.getElementById('tune-size-val').textContent = size;
      state.tuneOverride = { ...(state.tuneOverride || {}), size };
      state.combinedPreview = null;
      schedulePreviewRender();
    });
  }

  const rotateSlider = document.getElementById('tune-rotate');
  if (rotateSlider) {
    rotateSlider.addEventListener('input', (e) => {
      const rotation = parseInt(e.target.value, 10);
      const rotateVal = document.getElementById('tune-rotate-val');
      if (rotateVal) rotateVal.textContent = rotation;
      state.tuneOverride = { ...(state.tuneOverride || {}), rotation };
      state.combinedPreview = null;
      schedulePreviewRender();
    });
  }

  document.querySelectorAll('.color-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      state.tuneOverride = { ...(state.tuneOverride || {}), color };
      state.combinedPreview = null;
      syncTunePanelUI();
      schedulePreviewRender();
    });
  });

  const customColor = document.getElementById('tune-color-custom');
  if (customColor) {
    customColor.addEventListener('input', (e) => {
      state.tuneOverride = { ...(state.tuneOverride || {}), color: e.target.value };
      state.combinedPreview = null;
      syncTunePanelUI();
      schedulePreviewRender();
    });
  }

  const resetBtn = document.getElementById('tune-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      state.tuneOverride = null;
      state.combinedPreview = null;
      syncTunePanelUI();
      schedulePreviewRender();
      toast('Đã về mặc định', 'info');
    });
  }

  // ============================================
  // POSE OVERLAY
  // ============================================
  function drawPoseOverlay() {
    const canvas = document.getElementById('pose-overlay');
    const video = document.getElementById('video');
    if (!canvas || !video) return;

    const poseId = state.selectedFrame?.pose_id;
    const ctx = canvas.getContext('2d');

    if (!poseId || !window.PoseLibrary) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const rect = video.getBoundingClientRect();
    if (rect.width === 0) { setTimeout(drawPoseOverlay, 100); return; }
    canvas.width = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    try {
      window.PoseLibrary.renderPose(canvas, poseId, {
        fillColor: 'rgba(255, 255, 255, 0.35)',
        strokeColor: 'rgba(251, 191, 36, 0.85)',
      });
    } catch (err) { console.warn('[Pose] Lỗi:', err); }
  }

  function clearPoseOverlay() {
    const canvas = document.getElementById('pose-overlay');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // ============================================
  // FLOW
  // ============================================
  $('#btn-continue').addEventListener('click', async () => {
    stopPreviewCamera();
    showStep('capture');
    const count = state.selectedFrame.capture_count || 3;
    const need = state.selectedFrame.photo_count || 1;
    $('#capture-info').textContent = `Chụp ${count} tấm · chọn ${need}`;
    $('#capture-frame-name').textContent = state.selectedFrame.name || '—';
    $('#capture-progress').textContent = `0 / ${count}`;
    $('#btn-capture').innerHTML = `<span>Chụp ${count} tấm</span><span class="btn-icon">📸</span>`;
    camera = new window.CameraManager($('#video'), $('#countdown'));
    await camera.start();
    setTimeout(drawPoseOverlay, 300);

    broadcastFullState();
  });

  $('#btn-capture').addEventListener('click', async () => {
    const btn = $('#btn-capture');
    btn.disabled = true;
    btn.textContent = 'Đang chụp...';
    const count = state.selectedFrame.capture_count || 3;

    const shots = await camera.shootSequence(count, cfg.COUNTDOWN_SECONDS, (current) => {
      $('#shots-preview').innerHTML = current.map((s) => `<img src="${s}" />`).join('');
      $('#capture-progress').textContent = `${current.length} / ${count}`;

       RealtimeSync.sendState({
      step: 'pick',
      needPick: state.selectedFrame.photo_count || 1,
    });
    });

    state.allPhotos = shots;
    state.pickedIndices = [];
    camera.stop();
    clearPoseOverlay();
    showStep('pick');
    renderPickGrid();

    btn.disabled = false;
    btn.innerHTML = `<span>Chụp ${count} tấm</span><span class="btn-icon">📸</span>`;

    RealtimeSync.sendState({
      step: 'pick',
      allPhotos: shots,
      needPick: state.selectedFrame.photo_count || 1,
    });
  });

  $('#btn-back-1').addEventListener('click', () => {
    if (camera) camera.stop();
    clearPoseOverlay();
    showStep('select');
    setTimeout(async () => {
      if (!previewStream) await startPreviewCamera();
      if (state.selectedFrame) await updatePreviewOverlay();
    }, 300);

    broadcastFullState();
  });

  $('#btn-clear-picks').addEventListener('click', () => {
    state.pickedIndices = [];
    renderPickGrid();

    RealtimeSync.sendState({
      step: 'pick',
      captureProgress: 0,
    });
  });

  $('#btn-picked-continue').addEventListener('click', () => {
    const need = state.selectedFrame.photo_count || 1;
    if (state.pickedIndices.length !== need) {
      toast(`Cần chọn đủ ${need} tấm`, 'error');
      return;
    }
    state.tuneOverride = null;
    showStep('decorate');
    $('#photos-preview').innerHTML = state.photos
      .map((s, i) => `<img src="${s}" data-shot-index="${i}" />`).join('');
    $('#photos-preview').querySelectorAll('img').forEach((imgEl) => {
      imgEl.addEventListener('click', () => {
        const items = state.photos.map((s, idx) => ({ src: s, caption: `Ảnh ${idx + 1}/${state.photos.length}` }));
        window.ZoomModal.open(items, parseInt(imgEl.dataset.shotIndex, 10));
      });
    });
    renderPreviewInDecorate();

    RealtimeSync.sendState({
      step: 'decorate',
      selectedTags: state.selectedTags,
    });
  });

  $('#btn-back-3').addEventListener('click', async () => {
    if (camera) camera.stop();
    showStep('capture');
    camera = new window.CameraManager($('#video'), $('#countdown'));
    await camera.start();
    setTimeout(drawPoseOverlay, 300);

    broadcastFullState();
  });

  $('#btn-back-2').addEventListener('click', () => {
    state.combinedPreview = null;
    showStep('pick');
    broadcastFullState();
  });

  // ============================================
  // FINALIZE
  // ============================================
  $('#btn-finalize').addEventListener('click', async () => {
    const btn = $('#btn-finalize');
    btn.disabled = true;
    btn.textContent = 'Đang xử lý...';

    try {
      const timestamp = Date.now();
      const sessionId = `${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
      const layout = state.selectedFrame.layout || 'auto';

      setHashtagContext();
      const shape = getShapeOptions();

      const combinedDataUrl = await window.generatePhotoStrip(
        state.selectedFrame.image_url,
        state.photos,
        layout,
        { skipHashtag: false, ...shape }
      );

      toast('Đang tải ảnh gốc...', 'info');
      const individualUrls = [];
      for (let i = 0; i < state.photos.length; i++) {
        const blob = window.dataURLtoBlob(state.photos[i]);
        const fileName = `session-${sessionId}/shot-${i + 1}.jpg`;
        const url = await uploadToBucket(cfg.STORAGE_BUCKET_INDIVIDUAL, blob, fileName);
        individualUrls.push(url);
      }

      toast('Đang tải ảnh tổng hợp...', 'info');
      const combinedBlob = window.dataURLtoBlob(combinedDataUrl);
      const combinedFileName = `combined-${sessionId}.jpg`;
      const combinedUrl = await uploadToBucket(cfg.STORAGE_BUCKET_COMBINED, combinedBlob, combinedFileName);

      await supabase.from('photos').insert([{
        combined_url: combinedUrl,
        individual_urls: individualUrls,
        hashtags: state.selectedTags,
        frame_id: state.selectedFrame.id,
      }]);

      const resultWrap = $('#result-preview-wrap');
      resultWrap.innerHTML = `<img src="${combinedUrl}" alt="Ảnh" />`;
      resultWrap.onclick = () => window.ZoomModal.open([{ src: combinedUrl, caption: 'Ảnh tổng hợp' }], 0);

      const qrCombined = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(combinedUrl)}`;
      $('#qr-combined').src = qrCombined;
      $('#btn-view-combined').href = combinedUrl;
      $('#btn-download-combined').href = combinedUrl;

      $('#individual-list').innerHTML = individualUrls.map((url, i) =>
        `<img src="${url}" data-idx="${i}" />`
      ).join('');

      $('#individual-list').querySelectorAll('img').forEach((imgEl) => {
        imgEl.addEventListener('click', () => {
          const idx = parseInt(imgEl.dataset.idx, 10);
          const items = individualUrls.map((u, i) => ({ src: u, caption: `Ảnh gốc ${i + 1}/${individualUrls.length}` }));
          window.ZoomModal.open(items, idx);
        });
      });

      showStep('result');
      toast('Tạo ảnh thành công!', 'success');

      // ⭐ Gửi kết quả sang iPad
      if (_rtConnected) {
        RealtimeSync.sendState({
          step: 'result',
          finalPhotoUrl: combinedUrl,
          qrUrl: qrCombined,
        });
      }

    } catch (err) {
      console.error(err);
      toast('Lỗi: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Tạo QR';
    }
  });

  $('#btn-restart').addEventListener('click', () => {
    state.selectedFrame = null;
    state.selectedTags = [];
    state.allPhotos = [];
    state.pickedIndices = [];
    state.photos = [];
    state.combinedPreview = null;
    state.tuneOverride = null;
    clearPoseOverlay();
    document.querySelectorAll('.frame-item').forEach((x) => x.classList.remove('selected'));
    $('#hashtag-list').querySelectorAll('.hashtag').forEach((x) => x.classList.remove('selected'));
    $('#btn-continue').disabled = true;
    $('#shots-preview').innerHTML = '';
    $('#photos-preview').innerHTML = '';
    $('#pick-grid').innerHTML = '';
    $('#combined-preview-wrap').innerHTML = '';
    $('#result-preview-wrap').innerHTML = '';
    updateSelectedFrameInfo();
    updatePreviewOverlay();
    showStep('select');
    setTimeout(() => startPreviewCamera(), 300);

    broadcastFullState();
  });

  let _resizeDebounce = null;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeDebounce);
    _resizeDebounce = setTimeout(() => {
      if (steps.decorate.classList.contains('active')) updateHashtagDisplay();
      if (steps.capture.classList.contains('active')) drawPoseOverlay();
    }, 200);
  });

  // ============================================
  // ⭐ REALTIME SYNC VỚI iPAD
  // ============================================
  function initRealtimeSync() {
    const btnPair = document.getElementById('btn-show-ipad-pair');
    const modal = document.getElementById('ipad-pair-modal');
    if (!btnPair || !modal) return;

    const modalClose = modal.querySelector('.ipad-pair-close');
    const roomCodeEl = document.getElementById('ipad-room-code');
    const qrImg = document.getElementById('ipad-pair-qr-img');

    btnPair.addEventListener('click', () => {
      if (!_rtRoomId) {
        const host = window.location.hostname;
        if (host === 'localhost' || host === '127.0.0.1') {
          const ok = confirm(
            '⚠️ Bạn đang chạy trên localhost.\n\n' +
            'iPad KHÔNG thể truy cập localhost của laptop bạn.\n\n' +
            'Cách sửa:\n' +
            '1. Chạy server với LAN: python -m http.server 8000 --bind 0.0.0.0\n' +
            '2. Tìm IP LAN (ipconfig/ifconfig)\n' +
            '3. Mở trên laptop: http://192.168.x.x:8000\n' +
            '4. Sau đó mới kết nối iPad.\n\n' +
            'Tiếp tục?'
          );
          if (!ok) return;
        }

        _rtRoomId = RealtimeSync.genRoomId();
        roomCodeEl.textContent = _rtRoomId;

        const basePath = window.location.pathname.replace(/\/[^\/]*$/, '/');
        const ipadUrl = `${window.location.origin}${basePath}ipad.html?room=${_rtRoomId}`;
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(ipadUrl)}`;

        setupLaptopRealtime();
      }
      modal.classList.add('active');
    });

    modalClose.addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
  }

    function setupLaptopRealtime() {
    RealtimeSync.on('onConnect', () => {
      console.log('[Laptop] ✅ Đã kết nối phòng:', _rtRoomId);
      // ⭐ Bắt đầu stream NGAY khi connect (không cần đợi iPad pair)
      startVideoStream();
      // ⭐ Broadcast state liên tục mỗi 1s
      if (_rtHeartbeatTimer) clearInterval(_rtHeartbeatTimer);
      _rtHeartbeatTimer = setInterval(() => {
        broadcastFullState();
      }, 1000);
    });

    RealtimeSync.on('onCommand', (cmd) => {
      // ⭐ Xử lý request-state đặc biệt
      if (cmd.action === 'request-state') {
        console.log('[Laptop] iPad xin state');
        broadcastFullState();
        setTimeout(broadcastFullState, 300);
        setTimeout(broadcastFullState, 800);
        return;
      }
      handleIpadCommand(cmd);
    });

    RealtimeSync.on('onPair', (payload) => {
      if (payload.role === 'ipad' || payload.role === 'ipad-alive') {
        if (!_rtConnected) {
          _rtConnected = true;
          console.log('[Laptop] ✅ iPad đã kết nối');
          const btn = document.getElementById('btn-show-ipad-pair');
          if (btn) btn.classList.add('connected');
          const status = document.getElementById('ipad-pair-status');
          if (status) {
            status.classList.add('connected');
            status.textContent = '✅ iPad đã kết nối';
          }
        }

        // ⭐ Broadcast liên tục để chắc chắn iPad nhận
        broadcastFullState();
        setTimeout(broadcastFullState, 300);
        setTimeout(broadcastFullState, 800);
        setTimeout(broadcastFullState, 1500);
      }
    });

    RealtimeSync.connect(_rtRoomId, 'laptop');
  }

    function handleIpadCommand(cmd) {
    if (!cmd || !cmd.action) return;
    console.log('[Laptop] Nhận lệnh từ iPad:', cmd);

    switch (cmd.action) {
      case 'request-state': {
        // Đã xử lý ở setupLaptopRealtime
        break;
      }
      case 'select-frame': {
        const frame = state.frames.find((f) => f.id === cmd.frameId);
        if (frame) selectFrame(frame);
        break;
      }
      case 'continue-to-capture': {
        const btn = $('#btn-continue');
        if (btn && !btn.disabled) btn.click();
        break;
      }
      case 'capture': {
        const btn = $('#btn-capture');
        if (btn && !btn.disabled) btn.click();
        break;
      }
      case 'picked-continue': {
        if (Array.isArray(cmd.picks)) {
          state.pickedIndices = cmd.picks;
          state.photos = state.pickedIndices.map((i) => state.allPhotos[i]);
          renderPickGrid();
        }
        const btn = $('#btn-picked-continue');
        if (btn && !btn.disabled) btn.click();
        break;
      }
      case 'set-tags': {
        if (Array.isArray(cmd.tags)) {
          state.selectedTags = cmd.tags;
          document.querySelectorAll('#hashtag-list .hashtag').forEach((el) => {
            el.classList.toggle('selected', state.selectedTags.includes(el.dataset.tag));
          });
          state.combinedPreview = null;
          schedulePreviewRender();
        }
        break;
      }
      case 'finalize': {
        const btn = $('#btn-finalize');
        if (btn && !btn.disabled) btn.click();
        break;
      }
      case 'restart': {
        const btn = $('#btn-restart');
        if (btn) btn.click();
        break;
      }
    }
  }

    function broadcastFullState() {
    if (!_rtConnected) return;

    let currentStep = 'select';
    if (steps.capture.classList.contains('active')) currentStep = 'capture';
    else if (steps.pick.classList.contains('active')) currentStep = 'pick';
    else if (steps.decorate.classList.contains('active')) currentStep = 'decorate';
    else if (steps.result.classList.contains('active')) currentStep = 'result';

    // ⭐ CHỈ gửi ID + state nhẹ (không gửi image_url base64)
    const payload = {
      step: currentStep,
      selectedFrameId: state.selectedFrame?.id || null,
      selectedTags: state.selectedTags,
      captureProgress: state.pickedIndices.length,
      captureTotal: state.selectedFrame?.photo_count || 1,
    };

    console.log('[Broadcast] Step:', currentStep, '· FrameId:', payload.selectedFrameId);

    RealtimeSync.sendState(payload);
  }

  // ⭐ Stream 3fps, JPEG 0.4, 480px
  function startVideoStream() {
    if (_rtStreamTimer) clearInterval(_rtStreamTimer);

    console.log('[Stream] Bắt đầu stream video 3fps');

    _rtStreamTimer = setInterval(() => {
      if (!_rtConnected) return;

      let video = document.getElementById('preview-video');
      if (!video || video.readyState < 2 || !video.videoWidth) {
        video = document.getElementById('video');
      }
      if (!video || video.readyState < 2 || !video.videoWidth) return;

      try {
        const canvas = document.createElement('canvas');
        const maxW = 480;
        const ratio = video.videoHeight / video.videoWidth;
        canvas.width = maxW;
        canvas.height = Math.round(maxW * ratio);

        const ctx = canvas.getContext('2d');
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.4);
        RealtimeSync.sendVideo({ data: dataUrl, t: Date.now() });
      } catch (err) { /* ignore */ }
    }, 330);
  }

    function hookStateUpdates() {
    document.addEventListener('click', (e) => {
      const id = e.target.id;
      if (['btn-capture', 'btn-picked-continue', 'btn-finalize', 'btn-restart', 'btn-back-1', 'btn-back-2', 'btn-back-3'].includes(id)) {
        setTimeout(broadcastFullState, 400);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      initRealtimeSync();
      hookStateUpdates();
    }, 500);
  });

  // ============================================
  // INIT
  // ============================================
  loadFrames();
  loadHashtags();
  updateSelectedFrameInfo();
  updatePreviewOverlay();
})();