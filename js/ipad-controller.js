// ============================================
// iPAD CONTROLLER — WebRTC + Pick ảnh + Supabase
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
  };

  let _reconnectTimer = null;
  let _webrtcStarted = false;

  function toast(msg, type = 'info') {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast show ${type}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.className = 'toast'), 3000);
  }

  // ============================================
  // LOAD SUPABASE
  // ============================================
  async function loadFramesFromDB() {
    try {
      const { data, error } = await supabase
        .from('frames').select('*').order('created_at', { ascending: false });
      if (error) { console.error(error); return; }
      state.frames = data || [];
      console.log('[iPad] Có', state.frames.length, 'khung');
      renderFrameList(state.frames);
    } catch (err) { console.error(err); }
  }

  async function loadHashtagsFromDB() {
    try {
      const { data, error } = await supabase
        .from('hashtags').select('*').order('id', { ascending: true });
      if (error) { console.error(error); return; }
      state.hashtags = data || [];
      renderHashtagList(state.hashtags);
    } catch (err) { console.error(err); }
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

    RealtimeSync.on('onConnect', async () => {
      console.log('[iPad] ✅ Đã kết nối phòng:', state.roomId);
      state.connected = true;
      RealtimeSync.sendPair({ role: 'ipad', joinedAt: Date.now() });
      showMainUI();
      toast('Đã kết nối!', 'success');

      await loadFramesFromDB();
      await loadHashtagsFromDB();

      if (!_webrtcStarted) {
        _webrtcStarted = true;
        setTimeout(() => {
          const videoEl = document.getElementById('remote-video-img');
          if (videoEl) {
            WebRTCStream.initReceiver(videoEl, state.roomId).then((ok) => {
              if (!ok) {
                _webrtcStarted = false;
                setTimeout(() => {
                  if (!WebRTCStream.isReady()) {
                    WebRTCStream.initReceiver(videoEl, state.roomId);
                    _webrtcStarted = true;
                  }
                }, 3000);
              }
            });
          }
        }, 500);
      }

      if (_reconnectTimer) clearInterval(_reconnectTimer);
      _reconnectTimer = setInterval(() => {
        if (state.connected) RealtimeSync.sendPair({ role: 'ipad-alive', t: Date.now() });
      }, 3000);

      RealtimeSync.sendCommand({ action: 'request-state' });
    });

    RealtimeSync.on('onState', (payload) => handleStateUpdate(payload));

    RealtimeSync.on('onPair', (payload) => {
      if (payload.role === 'laptop-left') {
        state.connected = false;
        toast('Laptop ngắt kết nối', 'error');
        showConnectUI();
      }
    });

    RealtimeSync.connect(state.roomId, 'ipad');

    const status = $('#connect-status');
    if (status) status.textContent = 'Đang kết nối...';
  }

  // ============================================
  // STATE UPDATE
  // ============================================
  function handleStateUpdate(payload) {
    if (!payload) return;
    console.log('[iPad] State:', payload);

    if (payload.step) {
      state.step = payload.step;
      updateStepUI(payload.step);
    }

    if (payload.selectedFrameId !== undefined) {
      const frame = state.frames.find((f) => f.id === payload.selectedFrameId);
      if (frame) {
        state.selectedFrame = frame;
        const nameEl = $('#selected-frame-name');
        if (nameEl) nameEl.textContent = frame.name || '—';
        const metaEl = $('#selected-frame-meta');
        if (metaEl) metaEl.textContent = `${frame.photo_count || 1} ô · chụp ${frame.capture_count || 3} tấm`;
        document.querySelectorAll('.frame-item-ipad').forEach((el) => {
          el.classList.toggle('selected', el.dataset.id === frame.id);
        });
        const btnContinue = $('#ipad-btn-continue');
        if (btnContinue) btnContinue.disabled = false;
      }
    }

    if (payload.captureProgress != null && payload.captureTotal != null) {
      const el = $('#capture-progress');
      if (el) el.textContent = `${payload.captureProgress} / ${payload.captureTotal}`;
    }

    // ⭐ Nhận thumbnails để render pick grid
    if (payload.allPhotos && Array.isArray(payload.allPhotos) && payload.allPhotos.length > 0) {
      state.photos = payload.allPhotos;
      state.pickedIndices = [];
      renderPhotoPick(payload.allPhotos, payload.needPick || 1);
    }

    if (payload.selectedTags && Array.isArray(payload.selectedTags)) {
      state.selectedTags = payload.selectedTags;
      document.querySelectorAll('.hashtag-ipad').forEach((el) => {
        el.classList.toggle('selected', state.selectedTags.includes(el.dataset.tag));
      });
    }

    if (payload.finalPhotoUrl) {
      showFinalResult(payload.finalPhotoUrl, payload.qrUrl);
    }
  }

  // ============================================
  // RENDER
  // ============================================
  function showConnectUI() {
    $('#connect-screen') && ($('#connect-screen').style.display = 'flex');
    $('#main-screen') && ($('#main-screen').style.display = 'none');
  }

  function showMainUI() {
    $('#connect-screen') && ($('#connect-screen').style.display = 'none');
    $('#main-screen') && ($('#main-screen').style.display = 'flex');
    const badge = $('#room-badge');
    if (badge) badge.textContent = `🏠 ${state.roomId}`;
  }

  function updateStepUI(step) {
    const stepMap = { select: 1, capture: 2, pick: 3, decorate: 4, result: 5 };
    const cur = stepMap[step] || 1;

    document.querySelectorAll('.pill-step').forEach((el) => {
      const s = parseInt(el.dataset.step, 10);
      el.classList.toggle('active', s === cur);
      el.classList.toggle('done', s < cur);
    });

    const isCapture = step === 'capture';
    $('#panel-capture') && ($('#panel-capture').style.display = isCapture ? 'flex' : 'none');

    const panels = ['select', 'capture-side', 'pick', 'decorate', 'result'];
    panels.forEach((p) => {
      const el = document.getElementById(`panel-${p}`);
      if (el) {
        let show = false;
        if (p === 'select' && step === 'select') show = true;
        if (p === 'capture-side' && isCapture) show = true;
        if (p === 'pick' && step === 'pick') show = true;
        if (p === 'decorate' && step === 'decorate') show = true;
        if (p === 'result' && step === 'result') show = true;
        el.style.display = show ? 'flex' : 'none';
      }
    });
  }

  function renderFrameList(frames) {
    const list = $('#ipad-frame-list');
    if (!list) return;

    if (!frames.length) {
      list.innerHTML = '<div class="empty-state"><span>Chưa có khung nào</span></div>';
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
        document.querySelectorAll('.frame-item-ipad').forEach((x) => x.classList.remove('selected'));
        el.classList.add('selected');
        const btnContinue = $('#ipad-btn-continue');
        if (btnContinue) btnContinue.disabled = false;
        toast('Đã chọn khung', 'success');
      });
    });
  }

  function renderPhotoPick(photos, need) {
    const grid = $('#ipad-pick-grid');
    if (!grid) return;

    grid.innerHTML = photos.map((src, i) => {
      const picked = state.pickedIndices.indexOf(i);
      return `
        <div class="pick-item-ipad ${picked !== -1 ? 'picked' : ''}" data-idx="${i}">
          <img src="${src}" />
          <div class="pick-check-ipad">${picked !== -1 ? picked + 1 : '+'}</div>
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
            if (pos2 !== -1) el2.querySelector('.pick-check-ipad').textContent = pos2 + 1;
          });
        }
        const btn = $('#ipad-btn-picked-continue');
        if (btn) btn.disabled = state.pickedIndices.length !== need;
      });
    });
  }

  function renderHashtagList(tags) {
    const list = $('#ipad-hashtag-list');
    if (!list) return;

    if (!tags.length) {
      list.innerHTML = '<div class="empty-state"><span>Chưa có hashtag</span></div>';
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
    $('#btn-connect')?.addEventListener('click', () => {
      connectToRoom($('#room-input').value.trim().toUpperCase());
    });

    $('#room-input')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') $('#btn-connect').click();
    });

    $('#room-input')?.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
    });

    $('#ipad-btn-continue')?.addEventListener('click', () => {
      RealtimeSync.sendCommand({ action: 'continue-to-capture' });
    });

    const btnCapture = $('#ipad-btn-capture');
    if (btnCapture) {
      btnCapture.addEventListener('click', () => {
        RealtimeSync.sendCommand({ action: 'capture' });
        btnCapture.disabled = true;
        btnCapture.innerHTML = '<span class="btn-icon-big">⏳</span><span>ĐANG CHỤP...</span>';
        setTimeout(() => {
          btnCapture.disabled = false;
          btnCapture.innerHTML = '<span class="btn-icon-big">📸</span><span>BẮT ĐẦU CHỤP</span>';
        }, 25000);
      });
    }

    $('#ipad-btn-picked-continue')?.addEventListener('click', () => {
      RealtimeSync.sendCommand({
        action: 'picked-continue',
        picks: state.pickedIndices,
      });
    });

    $('#ipad-btn-finalize')?.addEventListener('click', () => {
      RealtimeSync.sendCommand({ action: 'finalize' });
    });

    $('#ipad-btn-restart')?.addEventListener('click', () => {
      RealtimeSync.sendCommand({ action: 'restart' });
    });

    $('#btn-disconnect')?.addEventListener('click', () => {
      if (_reconnectTimer) clearInterval(_reconnectTimer);
      WebRTCStream.disconnect();
      _webrtcStarted = false;
      RealtimeSync.disconnect();
      state.connected = false;
      showConnectUI();
    });
  }

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