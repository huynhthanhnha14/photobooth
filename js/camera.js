window.CameraManager = class CameraManager {
  constructor(videoEl, countdownEl, existingStream = null) {
    this.video = videoEl;
    this.countdownEl = countdownEl;
    this.stream = null;
    this._providedStream = existingStream || null;   // ⭐ stream từ iPad
  }

  async start() {
    try {
      if (this._providedStream && this._providedStream.active) {
        // ⭐ Dùng stream có sẵn (từ iPad qua WebRTC)
        this.stream = this._providedStream;
        console.log('[Camera] Dùng stream có sẵn từ iPad');
      } else {
        // Fallback: mở cam local
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        console.log('[Camera] Dùng cam local (getUserMedia)');
      }
      this.video.srcObject = this.stream;
      await this.video.play();
      return true;
    } catch (err) {
      console.error('Không mở được camera:', err);
      alert(
        '❌ Không thể truy cập camera.\n\n' +
        'Lưu ý: Trang phải chạy trên HTTPS hoặc localhost.\n\n' +
        'Chi tiết lỗi: ' + err.message
      );
      return false;
    }
  }

  stop() {
    // ⭐ KHÔNG stop track nếu là stream cung cấp từ ngoài (iPad)
    if (this.stream && !this._providedStream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    this.stream = null;
  }

  captureOne() {
    const canvas = document.createElement('canvas');
    canvas.width = this.video.videoWidth;
    canvas.height = this.video.videoHeight;
    const ctx = canvas.getContext('2d');
    // Mirror để khớp preview
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(this.video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.9);
  }

  async shootSequence(count, countdownSeconds, onShot) {
    const shots = [];
    for (let i = 0; i < count; i++) {
      for (let c = countdownSeconds; c > 0; c--) {
        this._showCountdown(c);
        await this._sleep(1000);
      }
      this._showCountdown('📸');
      shots.push(this.captureOne());
      if (onShot) onShot(shots.slice());
      await this._sleep(700);
    }
    this._hideCountdown();
    return shots;
  }

  _showCountdown(text) {
    if (!this.countdownEl) return;
    this.countdownEl.textContent = text;
    this.countdownEl.classList.add('show');
  }

  _hideCountdown() {
    if (!this.countdownEl) return;
    this.countdownEl.classList.remove('show');
  }

  _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
};