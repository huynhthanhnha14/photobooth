// ============================================
// iPAD CONTROLLER — Tự load Supabase + Nhận lệnh
// ============================================
(function () {
  const supabase = window.supabaseClient;
  const $ = (sel) => document.querySelector(sel);

  const state = {
    connected: false,
    roomId: null,
    frames: [],
    hashtags: [],
    selectedFrame: null,
    selectedTags: [],
    step: 'select',
    photos: [],
    pickedIndices: [],
    frameCount: 0,
  };

  let _reconnectTimer = null;
  let _videoFpsStart = 0;
  let _videoFpsCount = 0;

  function toast(msg, type = 'info') {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast show ${type}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.className = 'toast'), 3000);
  }

  // ============================================
  // LOAD TỪ SUPABASE (không qua laptop)
  // ============================================
  async function loadFramesFromDB() {
    try {
      console.log('[iPad] Đang tải khung từ Supabase...');
      const { data, error } = await supabase
        .from('frames')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[iPad] Lỗi load frames:', error);
        return;
      }

      state.frames = data || [];
      console.log('[iPad] Đã tải', state.frames.length, 'khung');
      renderFrameList(state.frames);
    } catch (err) {
      console.error('[iPad] Lỗi load frames:', err);
    }
  }

  async function loadHashtagsFromDB() {
    try {
      const { data, error } = await supabase
        .from('hashtags')
        .select('*')
        .order('id', { ascending: true });

      if (error) {
        console.error('[iPad] Lỗi load hashtags:', error);
        return;
      }

      state.hashtags = data || [];
      console.log('[iPad] Đã tải', state.hashtags.length, 'hashtags');
      renderHashtagList(state.hashtags);
    } catch (err) {
      console.error('[iPad] Lỗi load hashtags:', err);
    }
  }

  // ============================================
  // KẾT NỐI REALTIME
  // ============================================
  function connectToRoom(roomId) {
    if (!roomId || roomId.length < 4) {
      toast('Mã phòng không hợp lệ', 'error');
      return;
    }

    state.roomId = roomId.toUpperCase();
    console.log('[iPad] Đang kết nối phòng:', state.roomId);

    RealtimeSync.on('onConnect', async () => {
      console.log('[iPad] ✅ Đã kết nối phòng:', state.roomId);
      state.connected = true;
      RealtimeSync.sendPair({ role: 'ipad', joinedAt: Date.now() });
      showMainUI();
      toast('Đã kết nối!', 'success');

      // ⭐ Load frames + hashtags từ Supabase
      await loadFramesFromDB();
      await loadHashtagsFromDB();

      // Ping định kỳ để laptop biết iPad còn sống
      if (_reconnectTimer) clearInterval(_reconnectTimer);
      _reconnectTimer = setInterval(() => {
        if (state.connected) {
          RealtimeSync.sendPair({ role: 'ipad-alive', t: Date.now() });
        }
      }, 3000);

      // ⭐ Xin state từ laptop
      RealtimeSync.sendCommand({ action: 'request-state' });
    });

    RealtimeSync.on('onState', (payload) => handleStateUpdate(payload));
    RealtimeSync.on('onVideo', (payload) => handleVideoFrame(payload));

    RealtimeSync.on('onPair', (payload) => {
      if (payload.role === 'laptop-left') {
        state.connected = false;
        toast('Laptop đã ngắt kết nối', 'error');
        showConnectUI();
      }
    });

    RealtimeSync.connect(state.roomId, 'ipad');

    const status = $('#connect-status');
    if (status) status.textContent = 'Đang kết nối...';
  }

  // ============================================
  // VIDEO FRAME
  // ============================================
  function handleVideoFrame(payload) {
    if (!payload || !payload.data) return;

    const img = document.getElementById('remote-video-img');
    if (!img) return;

    img.src = payload.data;

    const ph = document.getElementById('video-placeholder');
    if (ph) ph.style.display = 'none';

    // FPS counter
    _videoFpsCount++;
    const now = Date.now();
    if (!_videoFpsStart) _videoFpsStart = now;
    if (now - _videoFpsStart >= 2000) {
      const fps = (_videoFpsCount / 2).toFixed(1);
      const badge = document.getElementById('video-fps');
      if (badge) badge.textContent = `${fps} fps`;
      _videoFpsStart = now;
      _videoFpsCount = 0;
    }
  }

  // ============================================
  // STATE UPDATE (từ laptop)
  // ============================================
  function handleStateUpdate(payload) {
    if (!payload) return;
    console.log('[iPad] Nhận state:', payload);

    if (payload.step) {
      state.step = payload.step;
      updateStepUI(payload.step);
    }

    // Selected frame (chỉ ID, không phải full data)
    if (payload.selectedFrameId !== undefined) {
      const frame = state.frames.find((f) => f.id === payload.selectedFrameId);
      if (frame) {
        state.selectedFrame = frame;
        const nameEl = $('#selected-frame-name');
        if (nameEl) nameEl.textContent = frame.name || '—';
        const metaEl = $('#selected-frame-meta');
        if (metaEl) {
          metaEl.textContent = `${frame.photo_count || 1} ô · chụp ${frame.capture_count || 3} tấm`;
        }
        document.querySelectorAll('.frame-item-ipad').forEach((el) => {
          el.classList.toggle('selected', el.dataset.id === frame.id);
        });
      }
    }

    // Progress
    if (payload.captureProgress != null && payload.captureTotal != null) {
      const el = $('#capture-progress');
      if (el) el.textContent = `${payload.captureProgress} / ${payload.captureTotal}`;
    }

    // Photos
    if (payload.allPhotos && Array.isArray(payload.allPhotos)) {
      state.photos = payload.allPhotos;
      renderPhotoPick(payload.allPhotos, payload.needPick || 1);
    }

    // Selected tags
    if (payload.selectedTags && Array.isArray(payload.selectedTags)) {
      state.selectedTags = payload.selectedTags;
      document.querySelectorAll('.hashtag-ipad').forEach((el) => {
        el.classList.toggle('selected', state.selectedTags.includes(el.dataset.tag));
      });
    }

    // Final result
    if (payload.finalPhotoUrl) {
      showFinalResult(payload.finalPhotoUrl, payload.qrUrl);
    }
  }

  // ============================================
  // RENDER
  // ============================================
  function showConnectUI() {
    const cs = $('#connect-screen');
    const ms = $('#main-screen');
    if (cs) cs.style.display = 'flex';
    if (ms) ms.style.display = 'none';
  }

  function showMainUI() {
    const cs = $('#connect-screen');
    const ms = $('#main-screen');
    if (cs) cs.style.display = 'none';
    if (ms) ms.style.display = 'flex';
    const badge = $('#room-badge');
    if (badge) badge.textContent = `🏠 ${state.roomId}`;
  }

  function updateStepUI(step) {
    const stepMap = { select: 1, capture: 2, pick: 3, decorate: 4, result: 5 };
    const cur = stepMap[step] || 1;
    document.querySelectorAll('.progress-step').forEach((el) => {
      const s = parseInt(el.dataset.step, 10);
      el.classList.toggle('active', s === cur);
      el.classList.toggle('done', s < cur);
    });

    ['select', 'capture', 'pick', 'decorate', 'result'].forEach((s) => {
      const el = document.getElementById(`panel-${s}`);
      if (el) el.style.display = s === step ? 'flex' : 'none';
    });
  }

  function renderFrameList(frames) {
    const list = $('#ipad-frame-list');
    if (!list) return;

    if (!frames.length) {
      list.innerHTML = '<p class="loading">Chưa có khung nào</p>';
      return;
    }

    list.innerHTML = frames.map((f) => `
      <div class="frame-item-ipad" data-id="${f.id}">
        <img src="${f.image_url}" loading="lazy" alt="${f.name}" />
        <div class="frame-item-ipad-name">${f.name}</div>
      </div>
    `).join('');

    list.querySelectorAll('.frame-item-ipad').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        RealtimeSync.sendCommand({ action: 'select-frame', frameId: id });
        // Highlight ngay
        document.querySelectorAll('.frame-item-ipad').forEach((x) => x.classList.remove('selected'));
        el.classList.add('selected');
        toast('Đã chọn khung', 'success');
      });
    });

    console.log('[iPad] Đã render', frames.length, 'khung');
  }

  function renderPhotoPick(photos, need) {
    const grid = $('#ipad-pick-grid');
    if (!grid) return;

    grid.innerHTML = photos.map((src, i) => {
      const picked = state.pickedIndices.indexOf(i);
      const isPicked = picked !== -1;
      return `
        <div class="pick-item-ipad ${isPicked ? 'picked' : ''}" data-idx="${i}">
          <img src="${src}" />
          <div class="pick-check-ipad">${isPicked ? picked + 1 : '+'}</div>
        </div>
      `;
    }).join('');

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
          grid.querySelectorAll('.pick-item-ipad').forEach((el2) => {
            const idx2 = parseInt(el2.dataset.idx, 10);
            const pos2 = state.pickedIndices.indexOf(idx2);
            if (pos2 !== -1) {
              el2.querySelector('.pick-check-ipad').textContent = pos2 + 1;
            }
          });
        }
      });
    });
  }

  function renderHashtagList(tags) {
    const list = $('#ipad-hashtag-list');
    if (!list) return;

    if (!tags.length) {
      list.innerHTML = '<p class="loading" style="font-size:12px;">Chưa có hashtag</p>';
      return;
    }

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
  // CONTROLS
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
      roomInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
      });
    }

    const btnContinue = $('#ipad-btn-continue');
    if (btnContinue) {
      btnContinue.addEventListener('click', () => {
        RealtimeSync.sendCommand({ action: 'continue-to-capture' });
      });
    }

    const btnCapture = $('#ipad-btn-capture');
    if (btnCapture) {
      btnCapture.addEventListener('click', () => {
        RealtimeSync.sendCommand({ action: 'capture' });
        btnCapture.disabled = true;
        btnCapture.innerHTML = '⏳ Đang chụp...';
        setTimeout(() => {
          btnCapture.disabled = false;
          btnCapture.innerHTML = '📸 <span>BẮT ĐẦU CHỤP</span>';
        }, 20000);
      });
    }

    const btnPickedContinue = $('#ipad-btn-picked-continue');
    if (btnPickedContinue) {
      btnPickedContinue.addEventListener('click', () => {
        RealtimeSync.sendCommand({
          action: 'picked-continue',
          picks: state.pickedIndices,
        });
      });
    }

    const btnFinalize = $('#ipad-btn-finalize');
    if (btnFinalize) {
      btnFinalize.addEventListener('click', () => {
        RealtimeSync.sendCommand({ action: 'finalize' });
      });
    }

    const btnRestart = $('#ipad-btn-restart');
    if (btnRestart) {
      btnRestart.addEventListener('click', () => {
        RealtimeSync.sendCommand({ action: 'restart' });
      });
    }

    const btnDisconnect = $('#btn-disconnect');
    if (btnDisconnect) {
      btnDisconnect.addEventListener('click', () => {
        if (_reconnectTimer) clearInterval(_reconnectTimer);
        RealtimeSync.disconnect();
        state.connected = false;
        showConnectUI();
      });
    }
  }

  // ============================================
  // INIT
  // ============================================
  window.addEventListener('load', () => {
    bindControlButtons();
    showConnectUI();

    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get('room');
    if (roomFromUrl) {
      $('#room-input').value = roomFromUrl.toUpperCase();
      setTimeout(() => connectToRoom(roomFromUrl.toUpperCase()), 500);
    }
  });
})();