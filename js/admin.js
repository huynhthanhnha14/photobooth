(function () {
  const supabase = window.supabaseClient;
  const $ = (sel) => document.querySelector(sel);

  if (!supabase) {
    const list = $('#admin-frame-list');
    if (list) list.innerHTML = '<p class="loading">❌ Chưa kết nối Supabase — F12 kiểm tra.</p>';
    return;
  }

  let pendingFrameDataUrl = null;
  let pendingTextOverlayDataUrl = null;

  function toast(msg, type = 'info') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = `toast show ${type}`;
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.className = 'toast'), 3000);
  }

  // Upload khung
  $('#frame-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Chỉ chấp nhận ảnh', 'error');
    const label = $('#file-label');
    label.textContent = '⏳ Đang nén...';
    try {
      const result = await window.ImageCompressor.compressFrame(file);
      pendingFrameDataUrl = result.dataUrl;
      label.textContent = '✅ ' + file.name;
      toast(`Nén: ${window.ImageCompressor.formatSize(result.originalSize)} → ${window.ImageCompressor.formatSize(result.compressedSize)}`, 'success');
    } catch (err) {
      label.textContent = '❌ Lỗi';
      toast('Lỗi: ' + err.message, 'error');
      pendingFrameDataUrl = null;
    }
  });

  // Upload PNG chữ
  $('#frame-text-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type !== 'image/png') return toast('Chỉ chấp nhận PNG', 'error');
    const label = $('#text-file-label');
    label.textContent = '⏳ Đang nén...';
    try {
      const result = await window.ImageCompressor.compressFrame(file);
      pendingTextOverlayDataUrl = result.dataUrl;
      label.textContent = '✅ ' + file.name;
      toast('Đã nạp PNG chữ', 'success');
    } catch (err) {
      label.textContent = '❌ Lỗi';
      toast('Lỗi: ' + err.message, 'error');
      pendingTextOverlayDataUrl = null;
    }
  });

  // Load danh sách
  async function loadFrames() {
    const list = $('#admin-frame-list');
    const { data, error } = await supabase.from('frames').select('*').order('created_at', { ascending: false });
    if (error) { list.innerHTML = `<p class="loading">Lỗi: ${error.message}</p>`; return; }
    if (!data.length) { list.innerHTML = '<p class="loading">Chưa có khung nào.</p>'; return; }

    list.innerHTML = data.map((f) => {
      const sizeKB = Math.round((f.image_url.length - 22) * 3 / 4 / 1024);
      const badges = [
        f.shape_type && f.shape_type !== 'rect' ? '🎨' : '',
        f.pose_id ? '🎭' : '',
        f.text_overlay_url ? '🅰️' : '',
      ].filter(Boolean).join('');
      return `
        <div class="admin-frame-item">
          <img src="${f.image_url}" loading="lazy" />
          <div class="admin-frame-item-info">
            <div class="admin-frame-item-name">${f.name}</div>
            <div class="admin-frame-item-meta">${f.photo_count || 1} ô · ${f.capture_count || 3} shot · ${sizeKB}KB ${badges}</div>
          </div>
          <button class="admin-frame-item-del" data-del-frame="${f.id}">✕</button>
        </div>`;
    }).join('');

    list.querySelectorAll('[data-del-frame]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Xóa khung này?')) return;
        const { error } = await supabase.from('frames').delete().eq('id', btn.dataset.delFrame);
        if (error) return toast('Lỗi: ' + error.message, 'error');
        toast('Đã xóa', 'success');
        loadFrames();
      });
    });
  }

  // Thêm khung
  $('#btn-add-frame').addEventListener('click', async () => {
    const name = $('#frame-name').value.trim();
    const layout = $('#frame-layout').value;
    const photo_count = parseInt($('#frame-photo-count').value, 10) || 1;
    const capture_count = parseInt($('#frame-capture-count').value, 10) || 3;

    const preset = $('#frame-hashtag-preset').value;
    const size = parseInt($('#frame-hashtag-size').value, 10) || 32;
    const color = $('#frame-hashtag-color').value || '#fbbf24';

    const PRESET_POS = {
      'bottom-center': [0.5, 0.92], 'bottom-left': [0.12, 0.92], 'bottom-right': [0.88, 0.92],
      'top-center': [0.5, 0.08], 'top-left': [0.12, 0.08], 'top-right': [0.88, 0.08],
      'center': [0.5, 0.5],
    };
    let hx, hy;
    if (preset === 'custom') {
      hx = parseFloat($('#frame-hashtag-x').value) || 0.5;
      hy = parseFloat($('#frame-hashtag-y').value) || 0.92;
    } else {
      [hx, hy] = PRESET_POS[preset] || [0.5, 0.92];
    }

    const shape_type = $('#frame-shape-type').value || 'rect';
    const shape_text = $('#frame-shape-text')?.value?.trim() || '';
    const shape_value = shape_type === 'text' ? shape_text : '';
    const pose_id = $('#frame-pose').value || '';

    if (!name) return toast('Nhập tên khung', 'error');
    if (!pendingFrameDataUrl) return toast('Chọn ảnh khung', 'error');
    if (capture_count < photo_count) return toast('Số shot >= số ô', 'error');
    if (shape_type === 'text' && !shape_value) return toast('Nhập chữ', 'error');

    const btn = $('#btn-add-frame');
    btn.disabled = true;
    btn.textContent = 'Đang lưu...';

    const { error } = await supabase.from('frames').insert([{
      name,
      image_url: pendingFrameDataUrl,
      text_overlay_url: pendingTextOverlayDataUrl || '',
      layout, photo_count, capture_count,
      hashtag_x: hx, hashtag_y: hy, hashtag_size: size, hashtag_color: color,
      shape_type, shape_value, shape_scale: 100, pose_id,
    }]);

    btn.disabled = false;
    btn.textContent = '➕ Thêm khung';

    if (error) return toast('Lỗi: ' + error.message, 'error');
    toast('Đã thêm khung', 'success');

    $('#frame-name').value = '';
    $('#frame-file').value = '';
    $('#frame-text-file').value = '';
    $('#file-label').textContent = '📁 Chọn file';
    $('#text-file-label').textContent = '📁 Chọn PNG chữ';
    if (shape_text) $('#frame-shape-text').value = '';
    $('#frame-pose').value = '';
    pendingFrameDataUrl = null;
    pendingTextOverlayDataUrl = null;
    loadFrames();
  });

  // Hashtag
  async function loadHashtags() {
    const list = $('#admin-hashtag-list');
    const { data, error } = await supabase.from('hashtags').select('*').order('id', { ascending: true });
    if (error) { list.innerHTML = `<p class="loading">Lỗi: ${error.message}</p>`; return; }
    if (!data.length) { list.innerHTML = '<p class="loading">Chưa có hashtag.</p>'; return; }

    list.innerHTML = data.map((h) =>
      `<div class="hashtag-chip">#${h.tag}<span class="del" data-del-tag="${h.id}">✕</span></div>`
    ).join('');

    list.querySelectorAll('[data-del-tag]').forEach((el) => {
      el.addEventListener('click', async () => {
        if (!confirm('Xóa hashtag?')) return;
        const { error } = await supabase.from('hashtags').delete().eq('id', el.dataset.delTag);
        if (error) return toast('Lỗi: ' + error.message, 'error');
        toast('Đã xóa', 'success');
        loadHashtags();
      });
    });
  }

  $('#btn-add-hashtag').addEventListener('click', async () => {
    const tag = $('#hashtag-input').value.trim().replace(/^#/, '');
    if (!tag) return toast('Nhập hashtag', 'error');
    const { error } = await supabase.from('hashtags').insert([{ tag }]);
    if (error) return toast('Lỗi: ' + error.message, 'error');
    toast('Đã thêm', 'success');
    $('#hashtag-input').value = '';
    loadHashtags();
  });

  $('#hashtag-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') $('#btn-add-hashtag').click();
  });

  loadFrames();
  loadHashtags();
})();