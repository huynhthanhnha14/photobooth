// ============================================
// iPAD CONTROLLER — Nhận video + gửi lệnh
// ============================================
(function () {
  const $ = (sel) => document.querySelector(sel);

  const state = {
    connected: false,
    roomId: null,
    frames: [],
    selectedFrame: null,
    selectedTags: [],
    step: 'select',
    photos: [],
    pickedIndices: [],
  };

  let _lastVideoTime = 0;
  let _reconnectTimer = null;

  function toast(msg, type = 'info') {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast show ${type}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.className = 'toast'), 3000);
  }

  // ============================================
  // KẾT NỐI
  // ============================================
  function connectToRoom(roomId) {
    if (!roomId || roomId.length < 4) {
      toast('Mã phòng không hợp lệ', 'error');
      return;
    }

    state.roomId = roomId.toUpperCase();

    // Đăng ký handlers
    RealtimeSync.on('onConnect', () => {
      console.log('[iPad] Đã kết nối phòng:', state.roomId);
      state.connected = true;
      RealtimeSync.sendPair({ role: 'ipad', joinedAt: Date.now() });
      showMainUI();
      toast('Đã kết nối!', 'success');
    });

    RealtimeSync.on('onState', (payload) => {
      handleStateUpdate(payload);
    });

    RealtimeSync.on('onVideo', (payload) => {
      handleVideoFrame(payload);
    });

    RealtimeSync.on('onPair', (payload) => {
      console.log('[iPad] Pair event:', payload);
      if (payload.role === 'laptop-left') {
        state.connected = false;
        toast('Laptop đã ngắt kết nối', 'error');
        showConnectUI();
      }
    });

    RealtimeSync.connect(state.roomId, 'ipad');

    // Hiện loading
    $('#connect-status').textContent = 'Đang kết nối...';
  }

  // ============================================
  // XỬ LÝ VIDEO FRAME
  // ============================================
  function handleVideoFrame(payload) {
    if (!payload || !payload.data) return;

    const img = $('#remote-video');
    if (!img) return;

    img.src = payload.data;
    _lastVideoTime = Date.now();

    // FPS
    if (!handleVideoFrame._lastFps) handleVideoFrame._lastFps = Date.now();
    if (Date.now() - handleVideoFrame._lastFps > 1000) {
      handleVideoFrame._lastFps = Date.now();
    }
  }

  // ============================================
  // XỬ LÝ STATE TỪ LAPTOP
  // ============================================
  function handleStateUpdate(payload) {
    if (!payload) return;
    console.log('[iPad] State:', payload);

    // Cập nhật step
    if (payload.step) {
      state.step = payload.step;
      updateStepUI(payload.step);
    }

    // Cập nhật khung đã chọn
    if (payload.selectedFrame) {
      state.selectedFrame = payload.selectedFrame;
      $('#selected-frame-name').textContent = payload.selectedFrame.name || '—';
      $('#selected-frame-meta').textContent =
        `${payload.selectedFrame.photo_count || 1} ô · chụp ${payload.selectedFrame.capture_count || 3} tấm`;

      // Highlight khung đang chọn
      document.querySelectorAll('.frame-item-ipad').forEach((el) => {
        el.classList.toggle('selected', el.dataset.id === payload.selectedFrame.id);
      });
    }

    // Cập nhật danh sách khung
    if (payload.frames && Array.isArray(payload.frames)) {
      state.frames = payload.frames;
      renderFrameList(payload.frames);
    }

    // Tiến độ chụp
    if (payload.captureProgress != null && payload.captureTotal != null) {
      $('#capture-progress').textContent = `${payload.captureProgress} / ${payload.captureTotal}`;
    }

    // Ảnh chụp được
    if (payload.allPhotos && Array.isArray(payload.allPhotos)) {
      state.photos = payload.allPhotos;
      renderPhotoPick(payload.allPhotos, payload.needPick || 1);
    }

    // Hashtag
    if (payload.hashtags && Array.isArray(payload.hashtags)) {
      renderHashtagList(payload.hashtags);
    }

    // Ảnh cuối
    if (payload.finalPhotoUrl) {
      showFinalResult(payload.finalPhotoUrl, payload.qrUrl);
    }
  }

  // ============================================
  // RENDER UI
  // ============================================
  function showConnectUI() {
    $('#connect-screen').style.display = 'flex';
    $('#main-screen').style.display = 'none';
  }

  function showMainUI() {
    $('#connect-screen').style.display = 'none';
    $('#main-screen').style.display = 'flex';
    $('#room-badge').textContent = `🏠 ${state.roomId}`;
  }

  function updateStepUI(step) {
    document.querySelectorAll('.progress-step').forEach((el) => {
      const s = parseInt(el.dataset.step, 10);
      const stepMap = { select: 1, capture: 2, pick: 3, decorate: 4, result: 5 };
      const cur = stepMap[step] || 1;
      el.classList.toggle('active', s === cur);
      el.classList.toggle('done', s < cur);
    });

    // Hiện panel tương ứng
    ['select', 'capture', 'pick', 'decorate', 'result'].forEach((s) => {
      const el = document.getElementById(`panel-${s}`);
      if (el) el.style.display = s === step ? 'flex' : 'none';
    });
  }

  function renderFrameList(frames) {
    const list = $('#ipad-frame-list');
    if (!list) return;
    if (!frames.length) {
      list.innerHTML = '<p class="loading">Chưa có khung</p>';
      return;
    }

    list.innerHTML = frames.map((f) => `
      <div class="frame-item-ipad" data-id="${f.id}">
        <img src="${f.image_url}" loading="lazy" />
        <div class="frame-item-ipad-name">${f.name}</div>
      </div>
    `).join('');

    list.querySelectorAll('.frame-item-ipad').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        RealtimeSync.sendCommand({ action: 'select-frame', frameId: id });
        toast('Đã chọn khung trên laptop', 'success');
      });
    });
  }

  function renderPhotoPick(photos, need) {
    const grid = $('#ipad-pick-grid');
    if (!grid) return;

    state.pickedIndices = [];

    grid.innerHTML = photos.map((src, i) => `
      <div class="pick-item-ipad" data-idx="${i}">
        <img src="${src}" />
        <div class="pick-check-ipad">+</div>
      </div>
    `).join('');

    grid.querySelectorAll('.pick-item-ipad').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx, 10);
        const pos = state.pickedIndices.indexOf(idx);
        if (pos === -1) {
          if (state.pickedIndices.length >= need) {
            toast(`Chỉ chọn ${need} tấm`, 'error');
            return;
          }
          state.pickedIndices.push(idx);
          el.classList.add('picked');
          el.querySelector('.pick-check-ipad').textContent = state.pickedIndices.length;
        } else {
          state.pickedIndices.splice(pos, 1);
          el.classList.remove('picked');
          el.querySelector('.pick-check-ipad').textContent = '+';
        }
      });
    });
  }

  function renderHashtagList(tags) {
    const list = $('#ipad-hashtag-list');
    if (!list) return;
    list.innerHTML = tags.map((h) =>
      `<div class="hashtag-ipad" data-tag="${h.tag}">#${h.tag}</div>`
    ).join('');

    list.querySelectorAll('.hashtag-ipad').forEach((el) => {
      el.addEventListener('click', () => {
        const tag = el.dataset.tag;
        if (state.selectedTags.includes(tag)) {
          state.selectedTags = state.selectedTags.filter((t) => t !== tag);
          el.classList.remove('selected');
        } else {
          state.selectedTags.push(tag);
          el.classList.add('selected');
        }
        RealtimeSync.sendCommand({ action: 'set-tags', tags: state.selectedTags });
      });
    });
  }

  function showFinalResult(photoUrl, qrUrl) {
    const wrap = $('#ipad-final-photo');
    if (wrap) {
      wrap.innerHTML = `
        <img src="${photoUrl}" />
        ${qrUrl ? `<img class="ipad-qr" src="${qrUrl}" />` : ''}
      `;
    }
    const dl = $('#ipad-download-btn');
    if (dl) dl.href = photoUrl;
  }

  // ============================================
  // NÚT ĐIỀU KHIỂN
  // ============================================
  function bindControlButtons() {
    const btnConnect = $('#btn-connect');
    if (btnConnect) {
      btnConnect.addEventListener('click', () => {
        const roomId = $('#room-input').value.trim().toUpperCase();
        connectToRoom(roomId);
      });
    }

    const roomInput = $('#room-input');
    if (roomInput) {
      roomInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') $('#btn-connect').click();
      });
      // Auto uppercase
      roomInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
      });
    }

    // Nút vào chụp
    const btnContinue = $('#ipad-btn-continue');
    if (btnContinue) {
      btnContinue.addEventListener('click', () => {
        RealtimeSync.sendCommand({ action: 'continue-to-capture' });
      });
    }

    // Nút chụp
    const btnCapture = $('#ipad-btn-capture');
    if (btnCapture) {
      btnCapture.addEventListener('click', () => {
        RealtimeSync.sendCommand({ action: 'capture' });
        btnCapture.disabled = true;
        btnCapture.textContent = 'Đang chụp...';
      });
    }

    // Nút tiếp tục sau pick
    const btnPickedContinue = $('#ipad-btn-picked-continue');
    if (btnPickedContinue) {
      btnPickedContinue.addEventListener('click', () => {
        RealtimeSync.sendCommand({
          action: 'picked-continue',
          picks: state.pickedIndices,
        });
      });
    }

    // Nút tạo QR
    const btnFinalize = $('#ipad-btn-finalize');
    if (btnFinalize) {
      btnFinalize.addEventListener('click', () => {
        RealtimeSync.sendCommand({ action: 'finalize' });
      });
    }

    // Nút chụp lại
    const btnRestart = $('#ipad-btn-restart');
    if (btnRestart) {
      btnRestart.addEventListener('click', () => {
        RealtimeSync.sendCommand({ action: 'restart' });
      });
    }

    // Nút ngắt kết nối
    const btnDisconnect = $('#btn-disconnect');
    if (btnDisconnect) {
      btnDisconnect.addEventListener('click', () => {
        RealtimeSync.disconnect();
        state.connected = false;
        showConnectUI();
      });
    }
  }

  // ============================================
  // KHỞI ĐỘNG
  // ============================================
  window.addEventListener('load', () => {
    bindControlButtons();
    showConnectUI();

    // Tự kết nối nếu URL có ?room=XXXXXX
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get('room');
    if (roomFromUrl) {
      $('#room-input').value = roomFromUrl.toUpperCase();
      setTimeout(() => connectToRoom(roomFromUrl.toUpperCase()), 500);
    }

    // Ping lại iPad để laptop biết còn kết nối
    setInterval(() => {
      if (state.connected) {
        RealtimeSync.sendPair({ role: 'ipad-alive', t: Date.now() });
      }
    }, 5000);
  });
})();