(function () {
  const supabase = window.supabaseClient;
  const cfg = window.APP_CONFIG;
  const $ = (sel) => document.querySelector(sel);

  // ============================================
  // ⭐ MODE DETECTION
  // ============================================
  const urlParams = new URLSearchParams(window.location.search);
  const urlRoom = urlParams.get('room');
  const isIpadMode = !!urlRoom;
  const isHostMode = !isIpadMode;

  document.body.classList.add(isIpadMode ? 'mode-ipad' : 'mode-host');
  console.log('[Mode]', isIpadMode ? '📱 iPAD (mirror)' : '💻 LAPTOP (host)');

  // ============================================
  // STATE
  // ============================================
  const state = {
    frames: [], hashtags: [],
    selectedFrame: null, selectedTags: [],
    allPhotos: [], pickedIndices: [], photos: [],
    combinedPreview: null,
    tuneOverride: null,
    _lastCombinedUrl: null,
    _lastQrUrl: null,
    _lastSessionId: null
    
  };
let _pendingInfo = null
  let camera = null;
  let previewStream = null;
  let _previewFrameOriginal = null;
  let _previewFrameCleared = null;

  let _rtRoomId = isIpadMode ? urlRoom.toUpperCase() : null;
  let _rtConnected = false;
  let _rtHeartbeatTimer = null;
  let _currentFacingMode = 'user';
  let _webrtcSenderStarted = false;
  let _webrtcReceiverStarted = false;
  let _webrtcRetryTimer = null;

  const steps = {
    select: $('#step-select'),
    capture: $('#step-capture'),
    pick: $('#step-pick'),
    decorate: $('#step-decorate'),
    result: $('#step-result'),
  };

  // ============================================
  // HELPERS
  // ============================================
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

  // ============================================
// ⭐ SIDEBAR TOGGLE — Thu gọn / Mở rộng
// ============================================
function updateSidebarToggleIcons() {
  const collapsed = document.body.classList.contains('sidebar-collapsed');
  document.querySelectorAll('.sidebar-toggle-btn').forEach((b) => {
    b.textContent = collapsed ? '▶' : '◀';
    b.title = collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên';
  });
}

function initSidebarToggle() {
  // Khôi phục trạng thái lần trước
  try {
    if (localStorage.getItem('photobooth_sidebar_collapsed') === '1') {
      document.body.classList.add('sidebar-collapsed');
    }
  } catch (e) { /* ignore */ }

  document.querySelectorAll('.step-sidebar').forEach((sidebar) => {
    if (sidebar.querySelector('.sidebar-toggle-btn')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sidebar-toggle-btn';
    btn.setAttribute('aria-label', 'Thu gọn / Mở rộng thanh bên');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const collapsed = document.body.classList.toggle('sidebar-collapsed');
      try {
        localStorage.setItem(
          'photobooth_sidebar_collapsed',
          collapsed ? '1' : '0'
        );
      } catch (err) { /* ignore */ }
      updateSidebarToggleIcons();
      // Cho preview/canvas tính lại kích thước sau khi transition xong
      setTimeout(() => window.dispatchEvent(new Event('resize')), 320);
    });

    sidebar.appendChild(btn);
  });

  updateSidebarToggleIcons();
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

  function makeThumbnail(dataUrl, maxSize = 220, quality = 0.5) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ratio = img.naturalHeight / img.naturalWidth;
        if (img.naturalWidth >= img.naturalHeight) {
          canvas.width = maxSize;
          canvas.height = Math.round(maxSize * ratio);
        } else {
          canvas.height = maxSize;
          canvas.width = Math.round(maxSize / ratio);
        }
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  // ============================================
  // ⭐ PREVIEW CAMERA — Chỉ chạy ở HOST MODE
  // ============================================
  async function startPreviewCamera() {
    if (isIpadMode) {
      // iPad không mở camera local — chờ WebRTC
      console.log('[iPad] Bỏ qua getUserMedia — chờ WebRTC stream');
      return;
    }

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
    if (isIpadMode) return;
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
    if (isIpadMode) {
      toast('iPad dùng camera của laptop', 'info');
      return;
    }
    if (previewStream) stopPreviewCamera();
    else startPreviewCamera();
  });

  const btnSwitchCam = document.getElementById('btn-switch-camera');
  if (btnSwitchCam) btnSwitchCam.addEventListener('click', switchCamera);

  // ============================================
  // ZOOM
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
      if (previewBox.classList.contains('zoomed') && e.target === previewBox) closeZoom();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeZoom();
    });
  }

  // ============================================
  // COMPUTE SLOTS + PREVIEW
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
          if (isTransparent || isBrightWhite || isLightGray) d[idx + 3] = 0;
        }
      }
      frameCtx.putImageData(imgData, x, y);
    } catch (e) {
      frameCtx.clearRect(x, y, w, h);
    }
  }

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
    _previewFrameOriginal = state.selectedFrame.image_url;

    // ⭐ Tính slot + xóa cứng vùng slot khỏi frame → tạo lỗ trong suốt
    const layout = state.selectedFrame.layout || 'auto';
    const photoCount = state.selectedFrame.photo_count || 1;
    const slots = await computeSlots(frameImg, layout, photoCount);

    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(frameImg, 0, 0, W, H);

    if (slots && slots.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      slots.forEach((s) => {
        ctx.beginPath();
        if (s.isCircle) {
          ctx.arc(s.x + s.w / 2, s.y + s.h / 2, Math.min(s.w, s.h) / 2, 0, Math.PI * 2);
        } else {
          ctx.rect(s.x, s.y, s.w, s.h);
        }
        ctx.fill();
      });
      ctx.restore();
      console.log('[Preview] Đã xóa lỗ slot:', slots.length);
    }

    _previewFrameCleared = c.toDataURL('image/png');
    refreshPreviewFrameImage();
    overlay.classList.add('show');
    placeholder.classList.add('hidden');

    if (textOverlay) {
  const url = state.selectedFrame.text_overlay_url;
  if (url) {
    // ⭐ Nếu có cờ remove_bg → xử lý trước khi hiển thị
    if (state.selectedFrame.text_remove_bg !== 0 && state.selectedFrame.text_remove_bg != null) {
      try {
        const txtImg = await loadImageEl(url);
        const c2 = document.createElement('canvas');
        c2.width = txtImg.naturalWidth;
        c2.height = txtImg.naturalHeight;
        const ctx2 = c2.getContext('2d', { willReadFrequently: true });
        ctx2.drawImage(txtImg, 0, 0);
        const imgData = ctx2.getImageData(0, 0, c2.width, c2.height);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
          if (a < 50) continue;
          const isWhite = r > 235 && g > 235 && b > 235;
          const isLightGray = Math.abs(r - g) < 15 && Math.abs(g - b) < 15 && r > 200;
          const isCream = r > 230 && g > 225 && b > 200 && (r - b) < 35;
          if (isWhite || isLightGray || isCream) d[i + 3] = 0;
        }
        ctx2.putImageData(imgData, 0, 0);
        textOverlay.src = c2.toDataURL('image/png');
      } catch (e) {
        console.warn('[Preview Text] Không xử lý được:', e);
        textOverlay.src = url;
      }
    } else {
      textOverlay.src = url;
    }
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
    if (isHostMode) broadcastFullState();
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
    if (isIpadMode) {
      RealtimeSync.sendCommand({ action: 'select-frame', frameId: frame.id });
    } else {
      await selectFrame(frame);
    }
  }

  fpSelectBtn.addEventListener('click', selectFromPreview);
  fpCancelBtn.addEventListener('click', closeFramePreview);
  fpCloseBtn.addEventListener('click', closeFramePreview);
  fpModal.addEventListener('click', (e) => { if (e.target === fpModal) closeFramePreview(); });

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
  // LOAD FRAMES + HASHTAGS
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
          if (!frame) return;
          if (isIpadMode) {
            RealtimeSync.sendCommand({ action: 'select-frame', frameId: frame.id });
            // Optimistic UI
            document.querySelectorAll('.frame-item').forEach((x) => x.classList.remove('selected'));
            el.classList.add('selected');
            state.selectedFrame = frame;
            updateSelectedFrameInfo();
            await updatePreviewOverlay();
            $('#btn-continue').disabled = false;
          } else {
            await selectFrame(frame);
          }
        });
        el.addEventListener('dblclick', (e) => {
          e.preventDefault();
          const frame = state.frames.find((f) => f.id === el.dataset.id);
          if (frame) openFramePreview(frame);
        });
      });

      if (isHostMode) broadcastFullState();
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
          if (isIpadMode) {
            RealtimeSync.sendCommand({ action: 'set-tags', tags: state.selectedTags });
          } else {
            RealtimeSync.sendState({ selectedTags: state.selectedTags });
          }
        });
      });
      if (isHostMode) broadcastFullState();
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
    const need = state.selectedFrame?.photo_count || 1;
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

    if (isIpadMode) {
      RealtimeSync.sendCommand({ action: 'set-picks', picks: state.pickedIndices });
    } else {
      RealtimeSync.sendState({
        captureProgress: state.pickedIndices.length,
        captureTotal: need,
      });
    }
  }

  // ============================================
  // HASHTAG + SHAPE CONFIG
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
    textRemoveBg: f.text_remove_bg !== 0,   // ⭐ mặc định true
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

  async function renderPreviewInDecorate() {
    if (isIpadMode) {
      // iPad không render — chỉ hiển thị ảnh combined cuối cùng từ laptop
      return;
    }

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
  { skipHashtag: true, clearSlot: true, ...shape }   // ← thêm clearSlot
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
        window.ZoomModal.open([{ src: img.src, caption: 'Ảnh ghép' }], 0);
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

  // ============================================
  // TUNE PANEL
  // ============================================
  const TUNE_PRESETS = {
    'top-left': [0.12, 0.08], 'top-center': [0.5, 0.08], 'top-right': [0.88, 0.08],
    'center': [0.5, 0.5], 'bottom-center': [0.5, 0.92],
    'bottom-left': [0.12, 0.92], 'bottom-right': [0.88, 0.92],
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
      document.getElementById('tune-rotate-val').textContent = rotation;
      state.tuneOverride = { ...(state.tuneOverride || {}), rotation };
      state.combinedPreview = null;
      schedulePreviewRender();
    });
  }

  document.querySelectorAll('.color-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tuneOverride = { ...(state.tuneOverride || {}), color: btn.dataset.color };
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
  // FLOW BUTTONS — iPad sends commands, Host acts
  // ============================================
  $('#btn-continue').addEventListener('click', async () => {
    if (isIpadMode) {
      RealtimeSync.sendCommand({ action: 'continue-to-capture' });
      return;
    }
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
    broadcastFullState();
  });

  $('#btn-capture').addEventListener('click', async () => {
    if (isIpadMode) {
      RealtimeSync.sendCommand({ action: 'capture' });
      return;
    }

    const btn = $('#btn-capture');
    btn.disabled = true;
    btn.textContent = 'Đang chụp...';
    const count = state.selectedFrame.capture_count || 3;

    // Hook countdown to broadcast
    const origShow = camera._showCountdown.bind(camera);
    const origHide = camera._hideCountdown.bind(camera);
    camera._showCountdown = (text) => {
      origShow(text);
      RealtimeSync.sendState({ captureCountdown: String(text) });
    };
    camera._hideCountdown = () => {
      origHide();
      RealtimeSync.sendState({ captureCountdown: null });
    };

    const shots = await camera.shootSequence(count, cfg.COUNTDOWN_SECONDS, (current) => {
      $('#shots-preview').innerHTML = current.map((s) => `<img src="${s}" />`).join('');
      $('#capture-progress').textContent = `${current.length} / ${count}`;
      RealtimeSync.sendState({
        step: 'capture',
        captureProgress: current.length,
        captureTotal: count,
      });
    });

    camera._showCountdown = origShow;
    camera._hideCountdown = origHide;

    state.allPhotos = shots;
    state.pickedIndices = [];
    camera.stop();
    showStep('pick');
    renderPickGrid();

    btn.disabled = false;
    btn.innerHTML = `<span>Chụp ${count} tấm</span><span class="btn-icon">📸</span>`;

    // Nén thumbs gửi sang iPad
    const needPick = state.selectedFrame.photo_count || 1;
    const thumbs = [];
    for (let i = 0; i < shots.length; i++) {
      thumbs.push(await makeThumbnail(shots[i], 220, 0.5));
    }

    RealtimeSync.sendState({
      step: 'pick',
      allPhotos: thumbs,
      needPick: needPick,
      captureCountdown: null,
    });
    setTimeout(() => {
      RealtimeSync.sendState({ step: 'pick', allPhotos: thumbs, needPick });
    }, 800);
  });

  $('#btn-back-1').addEventListener('click', () => {
    if (isIpadMode) {
      RealtimeSync.sendCommand({ action: 'back-to-select' });
      return;
    }
    if (camera) camera.stop();
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
    if (isIpadMode) {
      RealtimeSync.sendCommand({ action: 'set-picks', picks: [] });
    } else {
      RealtimeSync.sendState({ step: 'pick', captureProgress: 0 });
    }
  });

  $('#btn-picked-continue').addEventListener('click', () => {
    if (isIpadMode) {
      RealtimeSync.sendCommand({ action: 'picked-continue', picks: state.pickedIndices });
      return;
    }
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
    RealtimeSync.sendState({ step: 'decorate', selectedTags: state.selectedTags });
  });

  $('#btn-back-3').addEventListener('click', async () => {
    if (isIpadMode) {
      RealtimeSync.sendCommand({ action: 'back-to-capture' });
      return;
    }
    if (camera) camera.stop();
    showStep('capture');
    camera = new window.CameraManager($('#video'), $('#countdown'));
    await camera.start();
    broadcastFullState();
  });

  $('#btn-back-2').addEventListener('click', () => {
    if (isIpadMode) {
      RealtimeSync.sendCommand({ action: 'back-to-pick' });
      return;
    }
    state.combinedPreview = null;
    showStep('pick');
    broadcastFullState();
  });

  // ============================================
  // FINALIZE
  // ============================================
  // ============================================
// ⭐ INFO MODAL — Nhập thông tin trước khi tạo QR
// ============================================
const infoModal = document.getElementById('info-modal');
const btnInfoCancel = document.getElementById('info-modal-cancel');
const btnInfoSubmit = document.getElementById('info-modal-submit');

function openInfoModal() {
  ['modal-mssv', 'modal-name', 'modal-birthyear'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.classList.remove('error'); }
  });
  const status = document.getElementById('info-modal-status');
  if (status) { status.textContent = ''; status.className = 'info-save-status'; }
  infoModal.classList.add('active');
  setTimeout(() => document.getElementById('modal-mssv')?.focus(), 300);
}

function closeInfoModal() {
  infoModal.classList.remove('active');
}

if (infoModal) {
  btnInfoCancel.addEventListener('click', closeInfoModal);
  infoModal.addEventListener('click', (e) => { if (e.target === infoModal) closeInfoModal(); });

  ['modal-mssv', 'modal-name', 'modal-birthyear'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keypress', (e) => { if (e.key === 'Enter') btnInfoSubmit.click(); });
  });

  btnInfoSubmit.addEventListener('click', async () => {
    const mssv = document.getElementById('modal-mssv').value.trim();
    const name = document.getElementById('modal-name').value.trim();
    const birthyear = document.getElementById('modal-birthyear').value.trim();
    const status = document.getElementById('info-modal-status');

    document.getElementById('modal-mssv').classList.remove('error');
    document.getElementById('modal-name').classList.remove('error');

    if (!mssv) {
      document.getElementById('modal-mssv').classList.add('error');
      if (status) { status.textContent = '⚠️ Vui lòng nhập MSSV'; status.className = 'info-save-status error'; }
      return toast('Nhập MSSV', 'error');
    }
    if (!name) {
      document.getElementById('modal-name').classList.add('error');
      if (status) { status.textContent = '⚠️ Vui lòng nhập Họ tên'; status.className = 'info-save-status error'; }
      return toast('Nhập Họ tên', 'error');
    }

    _pendingInfo = {
      student_id: mssv,
      full_name: name,
      birth_year: birthyear || null,
    };
    closeInfoModal();

    if (isIpadMode) {
      // iPad → gửi info + lệnh finalize cho laptop
      RealtimeSync.sendCommand({ action: 'finalize', info: _pendingInfo });
      const btn = $('#btn-finalize');
      btn.disabled = true;
      btn.textContent = 'Đang xử lý...';
      return;
    }
    await runFinalize();
  });
}

// ⭐ Bấm "Tạo QR" → mở modal nhập info (không chạy finalize ngay)
$('#btn-finalize').addEventListener('click', () => {
  openInfoModal();
});

// ============================================
// ⭐ RUN FINALIZE — Chạy sau khi đã có info
// ============================================
async function runFinalize() {
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
  state.selectedFrame.image_url, state.photos, layout,
  { skipHashtag: false, clearSlot: true, ...shape }  // ← thêm clearSlot
);

    toast('Đang tải ảnh gốc...', 'info');
    const individualUrls = [];
    for (let i = 0; i < state.photos.length; i++) {
      const blob = window.dataURLtoBlob(state.photos[i]);
      const fileName = `session-${sessionId}/shot-${i + 1}.jpg`;
      individualUrls.push(await uploadToBucket(cfg.STORAGE_BUCKET_INDIVIDUAL, blob, fileName));
    }

    toast('Đang tải ảnh tổng hợp...', 'info');
    const combinedBlob = window.dataURLtoBlob(combinedDataUrl);
    const combinedFileName = `combined-${sessionId}.jpg`;
    const combinedUrl = await uploadToBucket(cfg.STORAGE_BUCKET_COMBINED, combinedBlob, combinedFileName);

    // ⭐ Insert kèm info luôn (không cần update sau)
    await supabase.from('photos').insert([{
      combined_url: combinedUrl,
      individual_urls: individualUrls,
      hashtags: state.selectedTags,
      frame_id: state.selectedFrame.id,
      student_id: _pendingInfo?.student_id || null,
      full_name: _pendingInfo?.full_name || null,
      birth_year: _pendingInfo?.birth_year || null,
      hometown: null,
    }]);

    const resultWrap = $('#result-preview-wrap');
    if (resultWrap) resultWrap.innerHTML = '';

    const qrCombined = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(combinedUrl)}`;
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

    // ⭐ Pre-fill form bước 5 với info đã nhập + khóa lại
    if (_pendingInfo) {
      const mssvEl = document.getElementById('result-mssv');
      const nameEl = document.getElementById('result-name');
      const birthEl = document.getElementById('result-birthyear');
      const homeEl = document.getElementById('result-hometown');
      if (mssvEl) mssvEl.value = _pendingInfo.student_id || '';
      if (nameEl) nameEl.value = _pendingInfo.full_name || '';
      if (birthEl) birthEl.value = _pendingInfo.birth_year || '';
      if (homeEl) homeEl.value = '';
      ['result-mssv', 'result-name', 'result-hometown', 'result-birthyear'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) { el.disabled = true; el.classList.remove('error'); }
      });
      const saveBtn = document.getElementById('btn-save-info');
      if (saveBtn) {
        saveBtn.innerHTML = '<span>✅ Đã lưu thông tin</span>';
        saveBtn.disabled = true;
      }
      const statusEl = document.getElementById('info-save-status');
      if (statusEl) {
        statusEl.textContent = '✅ Thông tin đã được lưu cùng ảnh';
        statusEl.className = 'info-save-status success';
      }
    }

    state._lastCombinedUrl = combinedUrl;
    state._lastQrUrl = qrCombined;
    state._lastSessionId = sessionId;

    RealtimeSync.sendState({
      step: 'result',
      finalPhotoUrl: combinedUrl,
      qrUrl: qrCombined,
    });

  } catch (err) {
    console.error(err);
    toast('Lỗi: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Tạo QR';
    _pendingInfo = null;
  }
}

  $('#btn-restart').addEventListener('click', () => {
    if (isIpadMode) {
      RealtimeSync.sendCommand({ action: 'restart' });
      return;
    }
    state.selectedFrame = null;
    state.selectedTags = [];
    state.allPhotos = [];
    state.pickedIndices = [];
    state.photos = [];
    state.combinedPreview = null;
    state.tuneOverride = null;
    document.querySelectorAll('.frame-item').forEach((x) => x.classList.remove('selected'));
    document.querySelectorAll('#hashtag-list .hashtag').forEach((x) => x.classList.remove('selected'));
    $('#btn-continue').disabled = true;
    $('#shots-preview').innerHTML = '';
    $('#photos-preview').innerHTML = '';
    $('#pick-grid').innerHTML = '';
    $('#combined-preview-wrap').innerHTML = '';
    // Reset info form bước 5
['result-mssv', 'result-name', 'result-hometown', 'result-birthyear'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) { el.value = ''; el.disabled = false; el.classList.remove('error'); }
});
const _saveBtn = document.getElementById('btn-save-info');
if (_saveBtn) {
  _saveBtn.innerHTML = '<span>💾 Lưu thông tin</span>';
  _saveBtn.disabled = false;
}
const _statusEl = document.getElementById('info-save-status');
if (_statusEl) { _statusEl.textContent = ''; _statusEl.className = 'info-save-status'; }
    updateSelectedFrameInfo();
    updatePreviewOverlay();
    showStep('select');
    setTimeout(() => startPreviewCamera(), 300);
    broadcastFullState();
  });

  // ============================================
  // ⭐ INFO FORM (chỉ iPad hoặc cả 2)
  // ============================================
  function bindInfoForm() {
    const btnSave = document.getElementById('btn-save-info');
    if (!btnSave) return;

    btnSave.addEventListener('click', async () => {
      const mssv = document.getElementById('result-mssv').value.trim();
      const name = document.getElementById('result-name').value.trim();
      const hometown = document.getElementById('result-hometown').value.trim();
      const birthyear = document.getElementById('result-birthyear').value.trim();
      const statusEl = document.getElementById('info-save-status');

      document.getElementById('result-mssv').classList.remove('error');
      document.getElementById('result-name').classList.remove('error');

      if (!mssv) {
        document.getElementById('result-mssv').classList.add('error');
        if (statusEl) { statusEl.textContent = '⚠️ Vui lòng nhập MSSV'; statusEl.className = 'info-save-status error'; }
        return toast('Nhập MSSV', 'error');
      }
      if (!name) {
        document.getElementById('result-name').classList.add('error');
        if (statusEl) { statusEl.textContent = '⚠️ Vui lòng nhập Họ tên'; statusEl.className = 'info-save-status error'; }
        return toast('Nhập Họ tên', 'error');
      }

      btnSave.disabled = true;
      const originalHTML = btnSave.innerHTML;
      btnSave.innerHTML = '<span>⏳ Đang lưu...</span>';

      try {
        const combinedUrl = state._lastCombinedUrl;
        if (!combinedUrl) throw new Error('Không tìm thấy ảnh');

        const { error } = await supabase
          .from('photos')
          .update({
            student_id: mssv,
            full_name: name,
            hometown: hometown,
            birth_year: birthyear,
          })
          .eq('combined_url', combinedUrl);

        if (error) throw error;

        if (statusEl) {
          statusEl.textContent = '✅ Đã lưu thông tin thành công!';
          statusEl.className = 'info-save-status success';
        }
        toast('Đã lưu thông tin!', 'success');
      } catch (err) {
        console.error(err);
        if (statusEl) { statusEl.textContent = '❌ Lỗi: ' + err.message; statusEl.className = 'info-save-status error'; }
        toast('Lỗi: ' + err.message, 'error');
      } finally {
        btnSave.disabled = false;
        btnSave.innerHTML = originalHTML;
      }
    });

    ['result-mssv', 'result-name', 'result-hometown', 'result-birthyear'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('keypress', (e) => { if (e.key === 'Enter') btnSave.click(); });
    });
  }

  // ============================================
  // ⭐ REALTIME SYNC
  // ============================================
  function initRealtimeSync() {
    if (isIpadMode) {
      // iPad tự kết nối vào room đã cho
      setupIpadRealtime();
    } else {
      // Laptop — chờ user bấm nút 📱 để tạo phòng
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
            if (!confirm('⚠️ Bạn đang dùng localhost → iPad không kết nối được.\n\nDùng IP LAN (VD 192.168.x.x)?')) return;
          }
          _rtRoomId = RealtimeSync.genRoomId();
          _rtConnected = false;
          _webrtcSenderStarted = false;
          roomCodeEl.textContent = _rtRoomId;

          const basePath = window.location.pathname.replace(/\/[^\/]*$/, '/');
          const ipadUrl = `${window.location.origin}${basePath}index.html?room=${_rtRoomId}`;
          qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&data=${encodeURIComponent(ipadUrl)}`;

          setupHostRealtime();
        }
        modal.classList.add('active');
      });

      modalClose.addEventListener('click', () => modal.classList.remove('active'));
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); });
    }
  }

  // ⭐ iPad — Mirror mode
  function setupIpadRealtime() {
    const badge = document.getElementById('mode-badge');
    if (badge) {
      badge.style.display = 'flex';
      badge.textContent = `📱 Đang đồng bộ`;
    }

    // Ẩn nút pair iPad (vì đang là iPad)
    const btnPair = document.getElementById('btn-show-ipad-pair');
    if (btnPair) btnPair.style.display = 'none';

    // Đổi text nút toggle camera → thông báo
    const camToggleText = document.getElementById('cam-toggle-text');
    if (camToggleText) camToggleText.textContent = 'Camera từ laptop';

    RealtimeSync.on('onConnect', () => {
      console.log('[iPad] ✅ Kết nối phòng:', _rtRoomId);
      _rtConnected = true;
      RealtimeSync.sendPair({ role: 'ipad', joinedAt: Date.now() });
      toast('Đã kết nối với laptop!', 'success');

      // Start WebRTC receiver
      if (!_webrtcReceiverStarted) {
        _webrtcReceiverStarted = true;
        setTimeout(() => {
          const videoEl = document.getElementById('preview-video');
          if (videoEl) {
            WebRTCStream.initReceiver(videoEl, _rtRoomId).then((ok) => {
              if (ok) {
                // Báo cho host biết iPad đã sẵn sàng
                RealtimeSync.sendCommand({ action: 'request-state' });
              } else {
                _webrtcReceiverStarted = false;
                setTimeout(() => {
                  if (!WebRTCStream.isReady()) {
                    WebRTCStream.initReceiver(videoEl, _rtRoomId);
                    _webrtcReceiverStarted = true;
                  }
                }, 3000);
              }
            });
          }
        }, 500);
      }

      // Ping alive
      if (_rtHeartbeatTimer) clearInterval(_rtHeartbeatTimer);
      _rtHeartbeatTimer = setInterval(() => {
        RealtimeSync.sendPair({ role: 'ipad-alive', t: Date.now() });
      }, 3000);
    });

    RealtimeSync.on('onState', (payload) => {
      handleRemoteState(payload);
    });

    RealtimeSync.connect(_rtRoomId, 'ipad');
  }

  // ⭐ iPad nhận state từ laptop
  async function handleRemoteState(payload) {
    if (!payload) return;
    console.log('[iPad] State:', payload);

    if (payload.step) {
      showStep(payload.step);
      if (payload.step === 'capture') {
        const count = state.selectedFrame?.capture_count || 3;
        const need = state.selectedFrame?.photo_count || 1;
        $('#capture-info').textContent = `Chụp ${count} tấm · chọn ${need}`;
        $('#capture-frame-name').textContent = state.selectedFrame?.name || '—';
        $('#btn-capture').innerHTML = `<span>Chụp ${count} tấm</span><span class="btn-icon">📸</span>`;
      }
    }

    if (payload.captureCountdown !== undefined) {
      const el = document.getElementById('countdown');
      if (el) {
        if (payload.captureCountdown) {
          el.textContent = payload.captureCountdown;
          el.classList.add('show');
        } else {
          el.classList.remove('show');
        }
      }
    }

    if (payload.selectedFrameId !== undefined) {
      const frame = state.frames.find((f) => f.id === payload.selectedFrameId);
      if (frame) {
        state.selectedFrame = frame;
        updateSelectedFrameInfo();
        document.querySelectorAll('.frame-item').forEach((el) => {
          el.classList.toggle('selected', el.dataset.id === frame.id);
        });
        $('#btn-continue').disabled = false;
        await updatePreviewOverlay();
      }
    }

    if (payload.captureProgress != null && payload.captureTotal != null) {
      const el = $('#capture-progress');
      if (el) el.textContent = `${payload.captureProgress} / ${payload.captureTotal}`;
    }

    if (payload.allPhotos && Array.isArray(payload.allPhotos) && payload.allPhotos.length > 0) {
      state.allPhotos = payload.allPhotos;
      state.pickedIndices = [];
      if (payload.needPick && state.selectedFrame) {
        // Cập nhật needPick từ remote
      }
      renderPickGrid();
    }

    if (payload.selectedTags && Array.isArray(payload.selectedTags)) {
      state.selectedTags = payload.selectedTags;
      document.querySelectorAll('#hashtag-list .hashtag').forEach((el) => {
        el.classList.toggle('selected', state.selectedTags.includes(el.dataset.tag));
      });
    }

    if (payload.finalPhotoUrl) {
      const qr = payload.qrUrl;
      $('#qr-combined').src = qr;
      $('#btn-view-combined').href = payload.finalPhotoUrl;
      $('#btn-download-combined').href = payload.finalPhotoUrl;
      state._lastCombinedUrl = payload.finalPhotoUrl;
      state._lastQrUrl = qr;
    }
  }

  // ⭐ Laptop — Host mode
  function setupHostRealtime() {
    RealtimeSync.on('onConnect', () => {
      console.log('[Laptop] ✅ Đã kết nối phòng:', _rtRoomId);
      broadcastFullState();
    });

    RealtimeSync.on('onCommand', (cmd) => {
      handleIpadCommand(cmd);
    });

    RealtimeSync.on('onPair', (payload) => {
      if (payload.role === 'ipad' || payload.role === 'ipad-alive') {
        if (!_rtConnected) {
          _rtConnected = true;
          console.log('[Laptop] ✅ iPad kết nối');
          const btn = document.getElementById('btn-show-ipad-pair');
          if (btn) btn.classList.add('connected');
          const status = document.getElementById('ipad-pair-status');
          if (status) {
            status.classList.add('connected');
            status.textContent = '✅ iPad đã kết nối';
          }
          startWebRTCSender();
        }
        broadcastFullState();
        setTimeout(broadcastFullState, 500);
        setTimeout(broadcastFullState, 1500);
      }
    });

    RealtimeSync.connect(_rtRoomId, 'laptop');

    // Auto ping state mỗi 2s
    if (_rtHeartbeatTimer) clearInterval(_rtHeartbeatTimer);
    _rtHeartbeatTimer = setInterval(() => {
      if (_rtConnected) broadcastFullState();
    }, 2000);
  }

  function startWebRTCSender() {
    if (_webrtcSenderStarted) return;
    _webrtcSenderStarted = true;

    const videoEl = document.getElementById('preview-video') || document.getElementById('video');
    if (!videoEl || !videoEl.srcObject) {
      _webrtcSenderStarted = false;
      setTimeout(startWebRTCSender, 1000);
      return;
    }

    WebRTCStream.initSender(videoEl, _rtRoomId).then((ok) => {
      if (!ok) {
        _webrtcSenderStarted = false;
        setTimeout(startWebRTCSender, 2000);
      } else {
        if (_webrtcRetryTimer) clearTimeout(_webrtcRetryTimer);
        _webrtcRetryTimer = setTimeout(() => {
          if (!WebRTCStream.isReady()) {
            WebRTCStream.disconnect();
            _webrtcSenderStarted = false;
            startWebRTCSender();
          }
        }, 5000);
      }
    });
  }

  function handleIpadCommand(cmd) {
    if (!cmd || !cmd.action) return;
    console.log('[Laptop] Nhận lệnh iPad:', cmd);

    switch (cmd.action) {
      case 'request-state': {
        broadcastFullState();
        setTimeout(broadcastFullState, 300);
        setTimeout(broadcastFullState, 800);
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
      case 'set-picks': {
        if (Array.isArray(cmd.picks)) {
          state.pickedIndices = cmd.picks;
          state.photos = state.pickedIndices.map((i) => state.allPhotos[i]);
          renderPickGrid();
        }
        break;
      }
      case 'picked-continue': {
        if (Array.isArray(cmd.picks)) {
          state.pickedIndices = cmd.picks;
          state.photos = state.pickedIndices.map((i) => state.allPhotos[i]);
          renderPickGrid();
        }
        setTimeout(() => {
          const btn = $('#btn-picked-continue');
          if (btn && !btn.disabled) btn.click();
        }, 300);
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
  if (cmd.info) {
    _pendingInfo = cmd.info;
    runFinalize();
  }
  break;
}
      case 'restart': {
        const btn = $('#btn-restart');
        if (btn) btn.click();
        break;
      }
      case 'back-to-select':
      case 'back-to-capture':
      case 'back-to-pick': {
        const map = {
          'back-to-select': '#btn-back-1',
          'back-to-capture': '#btn-back-3',
          'back-to-pick': '#btn-back-2',
        };
        const btn = $(map[cmd.action]);
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

    RealtimeSync.sendState({
      step: currentStep,
      selectedFrameId: state.selectedFrame?.id || null,
      selectedTags: state.selectedTags,
      captureProgress: state.pickedIndices.length,
      captureTotal: state.selectedFrame?.photo_count || 1,
      needPick: state.selectedFrame?.photo_count || 1,
    });
  }

  // ============================================
  // INIT
  // ============================================
  window.addEventListener('load', () => {
    if (isHostMode) {
      setTimeout(() => startPreviewCamera(), 500);
    }
    bindInfoForm();
    initRealtimeSync();
  });

  loadFrames();
  loadHashtags();
  updateSelectedFrameInfo();
  updatePreviewOverlay();
})();

