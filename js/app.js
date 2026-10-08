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
    _lastSessionId: null,
  };
  let _pendingInfo = null;

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

  // ⭐ Reverse stream — iPad gửi cam lên laptop
  let _remoteIpadStream = null;
  let _reverseReceiverStarted = false;
  let _ipadLocalStream = null;

  // ⭐ Fingerprint chống spam state
  let _lastStateFingerprint = '';

  // ⭐ Cache ảnh + ChromaKey
  const _chromaCache = new Map();
  const _imgCache = new Map();

  // ⭐ Hashtag position persistence
  const HASHTAG_POS_KEY = (frameId) => `hashtag_pos_${frameId}`;

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
    document.body.setAttribute('data-current-step', name);
    updateHUD();
  }

  function toast(msg, type = 'info') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast show ${type}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.className = 'toast'), 3000);
  }

  // ============================================
  // ⭐ HUD BAR — update tiến độ ngang
  // ============================================
  function updateHUD() {
    const stepEl = document.getElementById('hud-step');
    const progEl = document.getElementById('hud-progress');
    const frameEl = document.getElementById('hud-frame');
    const statusEl = document.getElementById('hud-status');
    if (!stepEl) return;

    let stepName = 'Chọn khung';
    if (steps.capture.classList.contains('active')) stepName = 'Chụp ảnh';
    else if (steps.pick.classList.contains('active')) stepName = 'Chọn ảnh';
    else if (steps.decorate.classList.contains('active')) stepName = 'Xem trước';
    else if (steps.result.classList.contains('active')) stepName = 'Hoàn tất';
    stepEl.textContent = stepName;

    let prog = '—';
    if (steps.capture.classList.contains('active')) {
      const total = state.selectedFrame?.capture_count || 3;
      prog = `${state.allPhotos.length} / ${total}`;
    } else if (steps.pick.classList.contains('active')) {
      const need = state.selectedFrame?.photo_count || 1;
      prog = `${state.pickedIndices.length} / ${need}`;
    } else if (steps.select.classList.contains('active')) {
      prog = state.selectedFrame ? '1 / 1' : '0 / 1';
    } else if (steps.decorate.classList.contains('active')) {
      prog = '✓';
    } else if (steps.result.classList.contains('active')) {
      prog = '✓';
    }
    progEl.textContent = prog;

    frameEl.textContent = state.selectedFrame?.name || '—';

    if (isIpadMode) {
      statusEl.textContent = _rtConnected ? '📱 iPad' : '⏳...';
    } else {
      statusEl.textContent = _rtConnected ? '💻 Đã nối' : '💻 Laptop';
    }
  }

  // ============================================
  // ⭐ HASHTAG POSITION — Lưu/Load localStorage
  // ============================================
  function saveHashtagPos() {
    if (!state.selectedFrame || !state.tuneOverride) return;
    try {
      const key = HASHTAG_POS_KEY(state.selectedFrame.id);
      localStorage.setItem(key, JSON.stringify(state.tuneOverride));
      console.log('[Hashtag] Đã lưu vị trí:', state.tuneOverride);
    } catch (e) { /* ignore */ }
  }

  function loadHashtagPos() {
    if (!state.selectedFrame) return null;
    try {
      const key = HASHTAG_POS_KEY(state.selectedFrame.id);
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : null;
    } catch (e) { return null; }
  }

  function clearHashtagPos(frameId) {
    if (!frameId) return;
    try {
      localStorage.removeItem(HASHTAG_POS_KEY(frameId));
    } catch (e) { /* ignore */ }
  }

  // ============================================
  // ⭐ SIDEBAR TOGGLE
  // ============================================
  function updateSidebarToggleIcons() {
    const collapsed = document.body.classList.contains('sidebar-collapsed');
    document.querySelectorAll('.sidebar-toggle-btn').forEach((b) => {
      b.textContent = collapsed ? '▶' : '◀';
      b.title = collapsed ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên';
    });
  }

  function initSidebarToggle() {
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
          localStorage.setItem('photobooth_sidebar_collapsed', collapsed ? '1' : '0');
        } catch (err) { /* ignore */ }
        updateSidebarToggleIcons();
        setTimeout(() => window.dispatchEvent(new Event('resize')), 320);
      });
      sidebar.appendChild(btn);
    });
    updateSidebarToggleIcons();
  }

  // ============================================
  // ⭐ HASHTAG FLOAT PANEL
  // ============================================
  function initHashtagFloatPanel() {
    const panel = document.getElementById('hashtag-float-panel');
    const header = document.getElementById('hfp-header');
    const toggle = document.getElementById('hfp-toggle');
    const count = document.getElementById('hfp-count');
    if (!panel) return;

    toggle?.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('collapsed');
      toggle.textContent = panel.classList.contains('collapsed') ? '▲' : '▼';
    });

    function updateCount() {
      const listEl = document.getElementById('hashtag-list');
      if (!listEl || !count) return;
      const sel = listEl.querySelectorAll('.hashtag.selected').length;
      const oldVal = parseInt(count.textContent, 10) || 0;
      count.textContent = sel;
      if (sel !== oldVal) {
        count.classList.remove('pop');
        void count.offsetWidth;
        count.classList.add('pop');
      }
    }

    const listEl = document.getElementById('hashtag-list');
    if (listEl && window.MutationObserver) {
      new MutationObserver(updateCount).observe(listEl, {
        subtree: true, attributes: true, attributeFilter: ['class'],
      });
      updateCount();
    }

    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

    function onDragStart(e) {
      if (e.target.closest('button')) return;
      dragging = true;
      const r = panel.getBoundingClientRect();
      startX = e.touches ? e.touches[0].clientX : e.clientX;
      startY = e.touches ? e.touches[0].clientY : e.clientY;
      startLeft = r.left;
      startTop = r.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = startLeft + 'px';
      panel.style.top = startTop + 'px';
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd);
      document.addEventListener('touchmove', onDragMove, { passive: false });
      document.addEventListener('touchend', onDragEnd);
    }
    function onDragMove(e) {
      if (!dragging) return;
      e.preventDefault?.();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      const r = panel.getBoundingClientRect();
      let nl = startLeft + (cx - startX);
      let nt = startTop + (cy - startY);
      nl = Math.max(0, Math.min(window.innerWidth - r.width, nl));
      nt = Math.max(0, Math.min(window.innerHeight - r.height, nt));
      panel.style.left = nl + 'px';
      panel.style.top = nt + 'px';
    }
    function onDragEnd() {
      dragging = false;
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
      document.removeEventListener('touchmove', onDragMove);
      document.removeEventListener('touchend', onDragEnd);
    }

    header?.addEventListener('mousedown', onDragStart);
    header?.addEventListener('touchstart', onDragStart, { passive: false });
  }

  // ============================================
  // IMAGE UTILS
  // ============================================
  function loadImageEl(src) {
    if (_imgCache.has(src)) {
      const cached = _imgCache.get(src);
      if (cached.complete && cached.naturalWidth) return Promise.resolve(cached);
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        _imgCache.set(src, img);
        resolve(img);
      };
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
  // ⭐ PREVIEW CAMERA — iPad mở cam local, Laptop fallback
  // ============================================
  async function startPreviewCamera() {
    if (isIpadMode) {
      // ⭐ iPad mở cam local của CHÍNH NÓ
      try {
        if (_ipadLocalStream) return;
        _ipadLocalStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        const previewVideo = $('#preview-video');
        previewVideo.srcObject = _ipadLocalStream;
        await previewVideo.play();

        $('#camera-status').classList.add('active');
        $('#camera-status-text').textContent = 'Camera iPad đang bật';
        $('#cam-toggle-icon').textContent = '📷';
        $('#cam-toggle-text').textContent = 'Tắt camera iPad';

        // ⭐ Gửi stream iPad lên laptop qua reverse channel
        if (_rtRoomId && !_reverseReceiverStarted) {
          _reverseReceiverStarted = true;
          setTimeout(() => {
            const videoSrc = document.getElementById('preview-video');
            WebRTCStream.initReverseSender(videoSrc, _rtRoomId).then((ok) => {
              if (!ok) {
                _reverseReceiverStarted = false;
                setTimeout(() => {
                  if (!WebRTCStream.isReady('reverse')) {
                    WebRTCStream.initReverseSender(videoSrc, _rtRoomId);
                    _reverseReceiverStarted = true;
                  }
                }, 3000);
              }
            });
          }, 800);
        }
      } catch (err) {
        console.error('[iPad] Không mở được cam local:', err);
        toast('iPad cần HTTPS để mở cam: ' + err.message, 'error');
      }
      return;
    }

    // ═══ HOST MODE (laptop) ═══
    try {
      if (previewStream) return;

      // ⭐ 1. Ưu tiên stream từ iPad nếu đã có
      if (_remoteIpadStream && _remoteIpadStream.active) {
        previewStream = _remoteIpadStream;
        console.log('[Preview] Dùng stream từ iPad');
      } else {
        // ⭐ 2. Thử mở cam local, nếu bị từ chối → chờ iPad
        try {
          previewStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: _currentFacingMode,
              width: { ideal: 1280 },
              height: { ideal: 960 },
            },
            audio: false,
          });
          console.log('[Preview] Dùng cam local laptop');
        } catch (camErr) {
          console.warn('[Preview] Không mở được cam local:', camErr.message);
          console.log('[Preview] Chờ stream từ iPad...');

          $('#camera-status').classList.add('active');
          $('#camera-status-text').textContent = '⏳ Chờ camera iPad';
          $('#cam-toggle-icon').textContent = '📱';
          $('#cam-toggle-text').textContent = 'Chờ iPad';

          const pv = $('#preview-video');
          if (pv) pv.poster = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect fill="%230a1628" width="400" height="300"/><text x="200" y="150" fill="%2338bdf8" font-family="sans-serif" font-size="16" text-anchor="middle">⏳ Đang chờ camera iPad...</text></svg>';

          setTimeout(() => {
            if (_remoteIpadStream && _remoteIpadStream.active) {
              startPreviewCamera();
            }
          }, 2000);
          return;
        }
      }

      const previewVideo = $('#preview-video');
      previewVideo.srcObject = previewStream;
      previewVideo.poster = '';
      await previewVideo.play();

      $('#camera-status').classList.add('active');
      $('#camera-status-text').textContent =
        (_remoteIpadStream && _remoteIpadStream.active) ? '📱 Camera iPad' : 'Camera đang bật';
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
      if (previewStream !== _remoteIpadStream) {
        previewStream.getTracks().forEach((t) => t.stop());
      }
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
      if (_ipadLocalStream) {
        _ipadLocalStream.getTracks().forEach((t) => t.stop());
        _ipadLocalStream = null;
        $('#preview-video').srcObject = null;
        $('#camera-status').classList.remove('active');
        $('#camera-status-text').textContent = 'Camera iPad đang tắt';
        $('#cam-toggle-icon').textContent = '📷';
        $('#cam-toggle-text').textContent = 'Bật camera iPad';
        WebRTCStream.disconnect('reverse');
        _reverseReceiverStarted = false;
      } else {
        startPreviewCamera();
      }
      return;
    }
    if (previewStream) stopPreviewCamera();
    else startPreviewCamera();
  });

  const btnSwitchCam = document.getElementById('btn-switch-camera');
  if (btnSwitchCam) btnSwitchCam.addEventListener('click', switchCamera);

  // ============================================
  // ZOOM PREVIEW (step select)
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

    return ratioSlots.map(([rx, ry, rw, rh]) => {
      const x = rx * W, y = ry * H;
      const w = rw * W, h = rh * H;
      return {
        x, y, w, h,
        isBrightBox: false,
        isCircle,
        shape: isCircle ? 'circle' : 'rect',
        radius: isCircle ? Math.min(w, h) / 2 : 0,
      };
    });
  }

  // ⭐ Helper: vẽ rounded rect path
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

  // ============================================
  // ⭐ UPDATE PREVIEW OVERLAY — 3 chế độ
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
      if (textOverlay) { textOverlay.removeAttribute('src'); textOverlay.style.display = 'none'; }
      return;
    }

    try {
      const f = state.selectedFrame;
      const hasRealFrame = f.image_url && f.image_url.length > 100;

      // ─── CHẾ ĐỘ 1: KHÔNG CÓ FRAME THỰC ───
      if (!hasRealFrame) {
        overlay.classList.remove('show');
        overlay.removeAttribute('src');
        placeholder.classList.add('hidden');
        box.style.setProperty('--frame-aspect', '3 / 4');

        if (textOverlay && f.text_overlay_url) {
          if (f.text_remove_bg !== 0) {
            try {
              const txtImg = await loadImageEl(f.text_overlay_url);
              textOverlay.src = await cleanTextImage(txtImg);
            } catch (e) {
              textOverlay.src = f.text_overlay_url;
            }
          } else {
            textOverlay.src = f.text_overlay_url;
          }
          textOverlay.style.display = 'block';
        }
        return;
      }

      // ─── CHẾ ĐỘ 2: FRAME_REMOVE_BG = 1 ───
      if (f.frame_remove_bg === 1) {
        // ⭐ Cache hit
        if (_chromaCache.has(f.image_url)) {
          _previewFrameOriginal = _chromaCache.get(f.image_url);
          _previewFrameCleared = _previewFrameOriginal;
          const cachedImg = _imgCache.get(f.image_url);
          if (cachedImg) {
            box.style.setProperty('--frame-aspect', `${cachedImg.naturalWidth} / ${cachedImg.naturalHeight}`);
          }
          refreshPreviewFrameImage();
          overlay.classList.add('show');
          placeholder.classList.add('hidden');
          if (textOverlay) {
            const url = f.text_overlay_url;
            if (url) {
              if (f.text_remove_bg !== 0) {
                const txtImg = await loadImageEl(url);
                textOverlay.src = await cleanTextImage(txtImg);
              } else {
                textOverlay.src = url;
              }
              textOverlay.style.display = 'block';
            } else {
              textOverlay.removeAttribute('src');
              textOverlay.style.display = 'none';
            }
          }
          return;
        }

        const frameImg = await loadImageEl(f.image_url);
        if (!frameImg.naturalWidth) return;
        box.style.setProperty('--frame-aspect', `${frameImg.naturalWidth} / ${frameImg.naturalHeight}`);

        if (window.ChromaKey) {
          try {
            const cleanedUrl = await window.ChromaKey.toDataURL(frameImg, {
              hardThreshold: 238,
              softThreshold: 200,
              satTolerance: 0.14,
              feather: 1,
            });
            _chromaCache.set(f.image_url, cleanedUrl);
            _previewFrameOriginal = cleanedUrl;
            _previewFrameCleared = cleanedUrl;
            console.log('[Preview] ✅ ChromaKey tách nền frame');
          } catch (e) {
            console.warn('[Preview] ChromaKey lỗi:', e);
            _previewFrameOriginal = f.image_url;
            _previewFrameCleared = f.image_url;
          }
        } else {
          _previewFrameOriginal = f.image_url;
          _previewFrameCleared = f.image_url;
        }

        refreshPreviewFrameImage();
        overlay.classList.add('show');
        placeholder.classList.add('hidden');

        if (textOverlay) {
          const url = f.text_overlay_url;
          if (url) {
            if (f.text_remove_bg !== 0) {
              const txtImg = await loadImageEl(url);
              textOverlay.src = await cleanTextImage(txtImg);
            } else {
              textOverlay.src = url;
            }
            textOverlay.style.display = 'block';
          } else {
            textOverlay.removeAttribute('src');
            textOverlay.style.display = 'none';
          }
        }
        return;
      }

      // ─── CHẾ ĐỘ 3: FRAME SLOT CŨ ───
      const frameImg = await loadImageEl(f.image_url);
      if (!frameImg.naturalWidth) return;
      const W = frameImg.naturalWidth;
      const H = frameImg.naturalHeight;
      box.style.setProperty('--frame-aspect', `${W} / ${H}`);
      _previewFrameOriginal = f.image_url;

      const layout = f.layout || 'auto';
      const photoCount = f.photo_count || 1;
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
          const shape = s.shape || (s.isCircle ? 'circle' : 'rect');
          const radius = s.radius || 0;
          if (shape === 'circle') {
            ctx.arc(s.x + s.w / 2, s.y + s.h / 2, Math.min(s.w, s.h) / 2, 0, Math.PI * 2);
          } else if (shape === 'rounded-rect' && radius > 0) {
            _roundRectPath(ctx, s.x, s.y, s.w, s.h, radius);
          } else {
            ctx.rect(s.x, s.y, s.w, s.h);
          }
          ctx.fill();
        });
        ctx.restore();
      }

      _previewFrameCleared = c.toDataURL('image/png');
      refreshPreviewFrameImage();
      overlay.classList.add('show');
      placeholder.classList.add('hidden');

      if (textOverlay) {
        const url = f.text_overlay_url;
        if (url) {
          if (f.text_remove_bg !== 0) {
            const txtImg = await loadImageEl(url);
            textOverlay.src = await cleanTextImage(txtImg);
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

  // ============================================
  // ⭐ CLEAN TEXT IMAGE — cache + ChromaKey
  // ============================================
  function cleanTextImage(img) {
    const key = img.src || '';
    if (key && _chromaCache.has(key)) {
      return Promise.resolve(_chromaCache.get(key));
    }
    const run = (window.ChromaKey && window.ChromaKey.toDataURL)
      ? window.ChromaKey.toDataURL(img).catch(() => _legacyCleanText(img))
      : _legacyCleanText(img);
    return run.then((url) => {
      if (key) _chromaCache.set(key, url);
      return url;
    });
  }

  function _legacyCleanText(img) {
    return new Promise((resolve) => {
      try {
        const w = img.naturalWidth, h = img.naturalHeight;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        const total = w * h;
        const THRESHOLD = 235;
        const visited = new Uint8Array(total);
        const qx = new Int32Array(total);
        const qy = new Int32Array(total);
        let head = 0, tail = 0;
        const isWhite = (idx) => {
          const i = idx * 4;
          return d[i] > THRESHOLD && d[i+1] > THRESHOLD && d[i+2] > THRESHOLD && d[i+3] > 128;
        };
        const tryPush = (x, y) => {
          if (x < 0 || x >= w || y < 0 || y >= h) return;
          const idx = y * w + x;
          if (visited[idx] || !isWhite(idx)) return;
          visited[idx] = 1;
          qx[tail] = x; qy[tail] = y; tail++;
        };
        for (let x = 0; x < w; x++) { tryPush(x, 0); tryPush(x, h-1); }
        for (let y = 0; y < h; y++) { tryPush(0, y); tryPush(w-1, y); }
        while (head < tail) {
          const x = qx[head], y = qy[head]; head++;
          d[(y * w + x) * 4 + 3] = 0;
          tryPush(x+1, y); tryPush(x-1, y); tryPush(x, y+1); tryPush(x, y-1);
        }
        ctx.putImageData(imgData, 0, 0);
        resolve(c.toDataURL('image/png'));
      } catch (e) {
        console.warn('[Clean Text] Lỗi:', e);
        resolve(img.src);
      }
    });
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
    // ⭐ Load vị trí hashtag đã lưu (nếu có)
    state.tuneOverride = loadHashtagPos();
    document.querySelectorAll('.frame-item').forEach((el) => {
      el.classList.toggle('selected', el.dataset.id === frame.id);
    });
    $('#btn-continue').disabled = false;
    updateSelectedFrameInfo();
    await updatePreviewOverlay();
    toast(`Đã chọn: ${frame.name}`, 'success');
    if (isHostMode) broadcastFullState();
    updateHUD();
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
    // ⭐ R2 nếu đã cấu hình, fallback Supabase
    const r2Cfg = cfg.R2;
    const useR2 = r2Cfg && r2Cfg.ACCOUNT_ID && !r2Cfg.ACCOUNT_ID.includes('YOUR_');
    if (useR2 && window.R2Storage) {
      const prefix = 'photos';
      const key = `${prefix}/${fileName}`;
      const url = await window.R2Storage.upload(blob, key);
      console.log(`[Upload R2] ✅ ${url}`);
      return url;
    }
    const { error } = await supabase.storage
      .from(bucket)
      .upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error(`Upload [${bucket}]: ${error.message}`);
    const { data } = supabase.storage.from(bucket).getPublicUrl(fileName);
    return data.publicUrl;
  }

  // ============================================
  // PICK GRID — long-press zoom + zoom button
  // ============================================
  function renderPickGrid() {
    const grid = $('#pick-grid');
    const need = state.selectedFrame?.photo_count || 1;
    const frag = document.createDocumentFragment();

    state.allPhotos.forEach((src, i) => {
      const order = state.pickedIndices.indexOf(i);
      const isPicked = order !== -1;
      const div = document.createElement('div');
      div.className = `pick-item ${isPicked ? 'picked' : ''}`;
      div.dataset.idx = i;
      div.innerHTML = `
        <img src="${src}" alt="Ảnh ${i + 1}" loading="lazy" />
        ${isPicked ? `<div class="pick-badge">${order + 1}</div>` : ''}
        <div class="pick-check">${isPicked ? '✓' : '+'}</div>
        <button class="pick-zoom-btn" title="Xem to">🔍</button>
      `;

      let longPressTimer = null;
      let longPressTriggered = false;
      let touchStartX = 0, touchStartY = 0;

      const startLongPress = (e) => {
        longPressTriggered = false;
        const touch = e.touches?.[0] || e;
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        longPressTimer = setTimeout(() => {
          longPressTriggered = true;
          openPickZoom(i);
        }, 500);
      };
      const cancelLongPress = () => {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      };
      const moveCheck = (e) => {
        const touch = e.touches?.[0] || e;
        const dx = Math.abs(touch.clientX - touchStartX);
        const dy = Math.abs(touch.clientY - touchStartY);
        if (dx > 10 || dy > 10) cancelLongPress();
      };

      div.addEventListener('click', (e) => {
        if (longPressTriggered) { longPressTriggered = false; return; }
        togglePick(i);
      });
      div.addEventListener('touchstart', startLongPress, { passive: true });
      div.addEventListener('touchend', cancelLongPress);
      div.addEventListener('touchcancel', cancelLongPress);
      div.addEventListener('touchmove', moveCheck, { passive: true });
      div.addEventListener('mousedown', startLongPress);
      div.addEventListener('mouseup', cancelLongPress);
      div.addEventListener('mouseleave', cancelLongPress);

      const zoomBtn = div.querySelector('.pick-zoom-btn');
      zoomBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        openPickZoom(i);
      });

      frag.appendChild(div);
    });

    grid.innerHTML = '';
    grid.appendChild(frag);

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
    updateHUD();
  }

  // ⭐ Zoom ảnh pick — có nút "Chọn ảnh này"
  function openPickZoom(startIdx) {
    const items = state.allPhotos.map((s, i) => ({
      src: s,
      caption: `Ảnh ${i + 1}/${state.allPhotos.length}`,
    }));
    window.ZoomModal.open(items, startIdx);

    setTimeout(() => {
      const zoomModal = document.getElementById('zoom-modal');
      if (!zoomModal) return;
      let actionBtn = zoomModal.querySelector('.zoom-action-btn');
      if (!actionBtn) {
        actionBtn = document.createElement('button');
        actionBtn.className = 'zoom-action-btn';
        actionBtn.innerHTML = '<span id="zoom-action-icon">+</span> <span id="zoom-action-text">Chọn ảnh này</span>';
        const info = zoomModal.querySelector('.zoom-info');
        if (info) info.parentNode.insertBefore(actionBtn, info);

        actionBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const imgEl = document.getElementById('zoom-img');
          if (!imgEl) return;
          const idx = state.allPhotos.findIndex((s) => s === imgEl.src);
          if (idx !== -1) {
            togglePick(idx);
            updateZoomActionBtn();
          }
        });
      }

      function updateZoomActionBtn() {
        const imgEl = document.getElementById('zoom-img');
        const btn = zoomModal.querySelector('.zoom-action-btn');
        if (!imgEl || !btn) return;
        const idx = state.allPhotos.findIndex((s) => s === imgEl.src);
        const isPicked = state.pickedIndices.includes(idx);
        const iconEl = document.getElementById('zoom-action-icon');
        const textEl = document.getElementById('zoom-action-text');
        if (iconEl) iconEl.textContent = isPicked ? '✓' : '+';
        if (textEl) textEl.textContent = isPicked ? 'Bỏ chọn ảnh này' : 'Chọn ảnh này';
        btn.classList.toggle('picked', isPicked);
      }
      updateZoomActionBtn();

      const prev = zoomModal.querySelector('.zoom-prev');
      const next = zoomModal.querySelector('.zoom-next');
      prev?.addEventListener('click', () => setTimeout(updateZoomActionBtn, 50));
      next?.addEventListener('click', () => setTimeout(updateZoomActionBtn, 50));
    }, 100);
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
  // HASHTAG CONFIG
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
      style: d.style != null ? d.style : (f.hashtag_style || 'default'),
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
    window.__hashtagStyle = c.style;
  }

  function getShapeOptions() {
    const f = state.selectedFrame || {};
    return {
      shapeType: f.shape_type || 'rect',
      shapeValue: f.shape_value || '',
      shapeScale: f.shape_scale != null ? f.shape_scale : 100,
      textOverlayUrl: f.text_overlay_url || '',
      textRemoveBg: f.text_remove_bg !== 0,
      frameRemoveBg: f.frame_remove_bg === 1,
      fullBleed: (!f.image_url || f.image_url === '' || f.image_url.length < 100)
                 || f.frame_remove_bg === 1,
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
    if (isIpadMode) return;

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
        { skipHashtag: true, clearSlot: true, ...shape }
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

    const displayW = img.offsetWidth || layer.offsetWidth;
    if (displayW === 0) return;
    const naturalW = img.naturalWidth || displayW;
    const scale = displayW / naturalW;

    const displaySize = Math.max(12, Math.round(cfg.size * scale));
    span.style.fontSize = displaySize + 'px';
    span.style.color = cfg.color;
    span.style.left = (cfg.x * 100) + '%';
    span.style.top = (cfg.y * 100) + '%';
    span.style.transform = `translate(-50%, -50%) rotate(${cfg.rotation}deg)`;

    // ⭐ Style class
    span.classList.remove(
      'style-default', 'style-outline', 'style-shadow',
      'style-glow', 'style-neon', 'style-gradient'
    );
    span.classList.add('style-' + (cfg.style || 'default'));
  }

  // ⭐ Attach drag + 2-finger pinch/rotate
  function attachDragHandlers(layer) {
    if (layer._dragBound) return;
    layer._dragBound = true;

    let mode = null;
    const pinch = { startDist: 0, startAngle: 0, startSize: 0, startRotation: 0 };

    const getDist = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const getAngle = (t1, t2) => Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * 180 / Math.PI;

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

    const onStart = (e) => {
      if (!state.selectedTags.length) {
        toast('Chọn hashtag trước rồi kéo nhé!', 'info');
        return;
      }

      if (e.touches && e.touches.length === 2) {
        e.preventDefault();
        mode = 'pinch';
        pinch.startDist = getDist(e.touches[0], e.touches[1]);
        pinch.startAngle = getAngle(e.touches[0], e.touches[1]);
        const cfg = getHashtagConfig();
        pinch.startSize = cfg.size;
        pinch.startRotation = cfg.rotation;
        layer.classList.add('dragging');
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
        document.addEventListener('touchcancel', onEnd);
        return;
      }

      if (e.touches && e.touches.length === 1) {
        e.preventDefault();
        mode = 'drag';
        layer.classList.add('dragging');
        moveTo(e);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
        document.addEventListener('touchcancel', onEnd);
        return;
      }

      if (e.type === 'mousedown') {
        e.preventDefault();
        mode = 'drag';
        layer.classList.add('dragging');
        moveTo(e);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
      }
    };

    const onMove = (e) => {
      if (mode === 'pinch' && e.touches && e.touches.length === 2) {
        e.preventDefault();
        const dist = getDist(e.touches[0], e.touches[1]);
        const angle = getAngle(e.touches[0], e.touches[1]);
        const scaleFactor = dist / Math.max(1, pinch.startDist);
        const newSize = Math.max(12, Math.min(220, Math.round(pinch.startSize * scaleFactor)));
        let deltaAngle = angle - pinch.startAngle;
        while (deltaAngle > 180) deltaAngle -= 360;
        while (deltaAngle < -180) deltaAngle += 360;
        const newRotation = Math.round(pinch.startRotation + deltaAngle);
        state.tuneOverride = {
          ...(state.tuneOverride || {}),
          size: newSize,
          rotation: newRotation,
        };
        updateHashtagDisplay();
        return;
      }
      if (mode === 'drag') {
        if (e.cancelable) e.preventDefault();
        moveTo(e);
      }
    };

    const onEnd = (e) => {
      if (e && e.touches && e.touches.length > 0) {
        if (mode === 'pinch' && e.touches.length === 1) {
          mode = 'drag';
          moveTo(e);
        }
        return;
      }
      if (!mode) return;
      mode = null;
      layer.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      syncTunePanelUI();
      // ⭐ Lưu vị trí
      saveHashtagPos();
    };

    layer.addEventListener('mousedown', onStart);
    layer.addEventListener('touchstart', onStart, { passive: false });
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
    document.querySelectorAll('.style-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.style === (cfg.style || 'default'));
    });
  }

  document.querySelectorAll('.pos-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [x, y] = TUNE_PRESETS[btn.dataset.pos] || [0.5, 0.92];
      state.tuneOverride = { ...(state.tuneOverride || {}), x, y };
      state.combinedPreview = null;
      syncTunePanelUI();
      schedulePreviewRender();
      saveHashtagPos();
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
      saveHashtagPos();
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
      saveHashtagPos();
    });
  }

  document.querySelectorAll('.color-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tuneOverride = { ...(state.tuneOverride || {}), color: btn.dataset.color };
      state.combinedPreview = null;
      syncTunePanelUI();
      schedulePreviewRender();
      saveHashtagPos();
    });
  });

  const customColor = document.getElementById('tune-color-custom');
  if (customColor) {
    customColor.addEventListener('input', (e) => {
      state.tuneOverride = { ...(state.tuneOverride || {}), color: e.target.value };
      state.combinedPreview = null;
      syncTunePanelUI();
      schedulePreviewRender();
      saveHashtagPos();
    });
  }

  document.querySelectorAll('.style-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const style = btn.dataset.style;
      state.tuneOverride = { ...(state.tuneOverride || {}), style };
      state.combinedPreview = null;
      document.querySelectorAll('.style-btn').forEach((b) => {
        b.classList.toggle('active', b.dataset.style === style);
      });
      const layer = document.getElementById('hashtag-drag-layer');
      if (layer) updateHashtagDisplay();
      schedulePreviewRender();
      saveHashtagPos();
    });
  });

  const resetBtn = document.getElementById('tune-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      state.tuneOverride = null;
      state.combinedPreview = null;
      // ⭐ Xóa vị trí đã lưu
      if (state.selectedFrame) clearHashtagPos(state.selectedFrame.id);
      syncTunePanelUI();
      schedulePreviewRender();
      toast('Đã về mặc định', 'info');
    });
  }

  // ============================================
  // FLOW BUTTONS
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
    camera = new window.CameraManager(
      $('#video'),
      $('#countdown'),
      _remoteIpadStream && _remoteIpadStream.active ? _remoteIpadStream : null
    );
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
      updateHUD();
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

    const needPick = state.selectedFrame.photo_count || 1;
    const thumbs = await Promise.all(shots.map((s) => makeThumbnail(s, 180, 0.55)));

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

    // ⭐ Load vị trí đã lưu cho frame này (nếu có)
    const _saved = loadHashtagPos();
    if (_saved && !state.tuneOverride) {
      state.tuneOverride = _saved;
      console.log('[Hashtag] Đã khôi phục vị trí:', _saved);
    }

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
    camera = new window.CameraManager(
      $('#video'),
      $('#countdown'),
      _remoteIpadStream && _remoteIpadStream.active ? _remoteIpadStream : null
    );
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
  // INFO MODAL
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
    document.body.classList.add('info-modal-open');
    setTimeout(() => {
      const mssvEl = document.getElementById('modal-mssv');
      if (mssvEl) {
        mssvEl.focus();
        scrollInputIntoView(mssvEl);
      }
    }, 350);
  }

  function closeInfoModal() {
    infoModal.classList.remove('active');
    document.body.classList.remove('info-modal-open');
    document.activeElement?.blur();
  }

  function scrollInputIntoView(inputEl) {
    if (!inputEl) return;
    const vv = window.visualViewport;
    if (!vv) {
      inputEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    setTimeout(() => {
      const rect = inputEl.getBoundingClientRect();
      const viewportH = vv.height;
      const viewportTop = vv.offsetTop;
      if (rect.bottom > viewportTop + viewportH - 100) {
        const scrollAmount = rect.bottom - (viewportTop + viewportH - 100);
        const modal = document.querySelector('.info-modal-content');
        if (modal) modal.scrollTop += scrollAmount + 60;
      }
    }, 300);
  }

  if (infoModal) {
    btnInfoCancel.addEventListener('click', closeInfoModal);
    infoModal.addEventListener('click', (e) => { if (e.target === infoModal) closeInfoModal(); });

    ['modal-mssv', 'modal-name', 'modal-birthyear'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('focus', () => scrollInputIntoView(el));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const order = ['modal-mssv', 'modal-name', 'modal-birthyear'];
          const curIdx = order.indexOf(id);
          if (curIdx < order.length - 1) {
            document.getElementById(order[curIdx + 1])?.focus();
          } else {
            btnInfoSubmit?.click();
          }
        }
      });
    });

    // ⭐ Keyboard handling cho iPad
    if (window.visualViewport) {
      let _lastViewportH = window.visualViewport.height;
      const handleViewportResize = () => {
        const vv = window.visualViewport;
        const keyboardOpen = vv.height < _lastViewportH - 100;
        _lastViewportH = vv.height;
        document.body.classList.toggle('keyboard-open', keyboardOpen);
        if (infoModal.classList.contains('active') && keyboardOpen) {
          const active = document.activeElement;
          if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
            scrollInputIntoView(active);
          }
        }
      };
      window.visualViewport.addEventListener('resize', handleViewportResize);
      window.visualViewport.addEventListener('scroll', handleViewportResize);
    }

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
        RealtimeSync.sendCommand({ action: 'finalize', info: _pendingInfo });
        const btn = $('#btn-finalize');
        btn.disabled = true;
        btn.textContent = 'Đang xử lý...';
        return;
      }
      await runFinalize();
    });
  }

  $('#btn-finalize').addEventListener('click', () => {
    openInfoModal();
  });

  // ============================================
  // RUN FINALIZE
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
        { skipHashtag: false, clearSlot: true, ...shape }
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

  // ============================================
  // RESTART
  // ============================================
  $('#btn-restart').addEventListener('click', () => {
    if (isIpadMode) {
      RealtimeSync.sendCommand({ action: 'restart' });
      return;
    }
    // ⭐ Xóa vị trí hashtag đã lưu của frame hiện tại
    if (state.selectedFrame) clearHashtagPos(state.selectedFrame.id);

    state.selectedFrame = null;
    state.selectedTags = [];
    state.allPhotos = [];
    state.pickedIndices = [];
    state.photos = [];
    state.combinedPreview = null;
    state.tuneOverride = null;

    if (_remoteIpadStream && _remoteIpadStream !== previewStream) {
      _remoteIpadStream = null;
    }

    document.querySelectorAll('.frame-item').forEach((x) => x.classList.remove('selected'));
    document.querySelectorAll('#hashtag-list .hashtag').forEach((x) => x.classList.remove('selected'));
    $('#btn-continue').disabled = true;
    $('#shots-preview').innerHTML = '';
    $('#photos-preview').innerHTML = '';
    $('#pick-grid').innerHTML = '';
    $('#combined-preview-wrap').innerHTML = '';

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
    updateHUD();
  });

  // ============================================
  // INFO FORM (bước 5)
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
  // REALTIME SYNC
  // ============================================
  function initRealtimeSync() {
    if (isIpadMode) {
      setupIpadRealtime();
    } else {
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

      function closePairModal() {
        modal.classList.remove('active');
        if (_rtConnected) {
          RealtimeSync.sendCommand({ action: 'restart' });
        }
        setTimeout(() => {
          const restartBtn = document.getElementById('btn-restart');
          if (restartBtn && !steps.select.classList.contains('active')) {
            restartBtn.click();
          } else {
            showStep('select');
            if (!previewStream) startPreviewCamera();
          }
        }, 250);
      }

      modalClose.addEventListener('click', closePairModal);
      modal.addEventListener('click', (e) => { if (e.target === modal) closePairModal(); });
    }
  }

  // ⭐ iPad — Mirror mode
  function setupIpadRealtime() {
    const badge = document.getElementById('mode-badge');
    if (badge) {
      badge.style.display = 'flex';
      badge.textContent = `📱 Đang đồng bộ`;
    }

    const btnPair = document.getElementById('btn-show-ipad-pair');
    if (btnPair) btnPair.style.display = 'none';

    const camToggleText = document.getElementById('cam-toggle-text');
    if (camToggleText) camToggleText.textContent = 'Bật camera iPad';

    RealtimeSync.on('onConnect', () => {
      console.log('[iPad] ✅ Kết nối phòng:', _rtRoomId);
      _rtConnected = true;
      RealtimeSync.sendPair({ role: 'ipad', joinedAt: Date.now() });
      toast('Đã kết nối với laptop!', 'success');
      setTimeout(() => startPreviewCamera(), 600);

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

    updateHUD();
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
          startReverseReceiver();
        }
        broadcastFullState();
        setTimeout(broadcastFullState, 500);
        setTimeout(broadcastFullState, 1500);
        updateHUD();
      }
    });

    RealtimeSync.connect(_rtRoomId, 'laptop');

    if (_rtHeartbeatTimer) clearInterval(_rtHeartbeatTimer);
    _rtHeartbeatTimer = setInterval(() => {
      if (!_rtConnected) return;
      const fingerprint = [
        state.selectedFrame?.id || '',
        state.selectedTags.join(','),
        state.pickedIndices.join(','),
      ].join('|');
      if (fingerprint !== _lastStateFingerprint) {
        _lastStateFingerprint = fingerprint;
        broadcastFullState();
      }
      updateHUD();
    }, 4000);
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

  // ⭐ Nhận stream cam từ iPad (reverse)
  function startReverseReceiver() {
    if (!_rtRoomId) return;
    console.log('[Laptop] Khởi động reverse receiver...');

    WebRTCStream.onTrack('reverse', (stream) => {
      _remoteIpadStream = stream;
      console.log('[Laptop] ✅ Nhận stream từ iPad');

      if (steps.select.classList.contains('active')) {
        const pv = $('#preview-video');
        if (pv) {
          if (previewStream && previewStream !== stream) {
            try { previewStream.getTracks().forEach((t) => t.stop()); } catch (e) {}
          }
          previewStream = stream;
          pv.srcObject = stream;
          pv.poster = '';
          pv.play().catch(() => {});
          $('#camera-status').classList.add('active');
          $('#camera-status-text').textContent = '📱 Camera iPad (remote)';
          $('#cam-toggle-icon').textContent = '📱';
          $('#cam-toggle-text').textContent = 'Camera iPad';
        }
      }

      if (steps.capture.classList.contains('active') && camera) {
        const v = $('#video');
        if (v) {
          v.srcObject = stream;
          v.play().catch(() => {});
          camera._providedStream = stream;
          camera.stream = stream;
        }
      }

      console.log('[Laptop] Đã lưu stream iPad, sẵn sàng dùng');
    });

    let hiddenVideo = document.getElementById('_hidden_ipad_video');
    if (!hiddenVideo) {
      hiddenVideo = document.createElement('video');
      hiddenVideo.id = '_hidden_ipad_video';
      hiddenVideo.autoplay = true;
      hiddenVideo.playsInline = true;
      hiddenVideo.muted = true;
      hiddenVideo.style.display = 'none';
      document.body.appendChild(hiddenVideo);
    }

    WebRTCStream.initReverseReceiver(hiddenVideo, _rtRoomId).then((ok) => {
      console.log('[Laptop] Reverse receiver init:', ok);
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

    _lastStateFingerprint = [
      state.selectedFrame?.id || '',
      state.selectedTags.join(','),
      state.pickedIndices.join(','),
      currentStep,
    ].join('|');

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
  // ⭐ INIT
  // ============================================
  window.addEventListener('load', () => {
    const vpCfg = cfg.VIEWPORT || {};
    if (
      window.ViewportScaler &&
      (
        (isHostMode && vpCfg.ENABLED_HOST !== false) ||
        (isIpadMode && vpCfg.ENABLED_IPAD === true)
      )
    ) {
      ViewportScaler.init({
        logicalWidth: vpCfg.LOGICAL_WIDTH || 1920,
        logicalHeight: vpCfg.LOGICAL_HEIGHT || 1080,
      });
      console.log('[ViewportScaler] Đã kích hoạt khung 16:9');
    }

    initSidebarToggle();
    initHashtagFloatPanel();

    if (isHostMode) {
      setTimeout(() => startPreviewCamera(), 500);
    }
    bindInfoForm();
    initRealtimeSync();
  });

  // ⭐ Load song song
  Promise.all([loadFrames(), loadHashtags()]).then(() => {
    updateSelectedFrameInfo();
    updatePreviewOverlay();
    updateHUD();
  }).catch((err) => {
    console.error('[Init] Lỗi load:', err);
  });
})();