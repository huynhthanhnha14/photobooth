// ============================================
// WebRTC STREAM — Hỗ trợ 2 chiều (forward + reverse)
//  - forward:  Laptop → iPad  (iPad xem cam laptop)
//  - reverse:  iPad  → Laptop (Laptop xem cam iPad) ⭐ MỚI
// ============================================
window.WebRTCStream = (function () {
  const peers = {};   // name → { pc, channel, role, roomId, ... }

  const ICE_SERVERS = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
    iceCandidatePoolSize: 10,
  };

  function _peer(name) {
    if (!peers[name]) {
      peers[name] = {
        name, pc: null, channel: null, role: null, roomId: null,
        remoteVideoEl: null, localStream: null, isConnected: false,
      };
    }
    return peers[name];
  }

  function _prefix(name) {
    return name === 'forward' ? 'webrtc' : 'webrtc-reverse';
  }

  async function _initSender(name, videoSource, roomId) {
    const p = _peer(name);
    p.role = 'sender';
    p.roomId = roomId;

    if (!videoSource || !videoSource.srcObject) {
      console.error(`[WebRTC ${name}] ❌ Không có video source`);
      return false;
    }
    p.localStream = videoSource.srcObject;
    const tracks = p.localStream.getVideoTracks();
    if (!tracks.length) {
      console.error(`[WebRTC ${name}] ❌ Không có video track`);
      return false;
    }

    p.pc = new RTCPeerConnection(ICE_SERVERS);
    tracks.forEach((t) => p.pc.addTrack(t, p.localStream));

    const evt = _prefix(name);

    p.pc.onicecandidate = (e) => {
      if (e.candidate && p.channel) {
        p.channel.send({
          type: 'broadcast',
          event: `${evt}-ice`,
          payload: { from: 'sender', candidate: e.candidate },
        }).catch(() => {});
      }
    };
    p.pc.onconnectionstatechange = () => {
      console.log(`[WebRTC ${name}] state:`, p.pc?.connectionState);
      if (p.pc?.connectionState === 'connected') {
        p.isConnected = true;
        console.log(`[WebRTC ${name}] ✅ P2P SENDER CONNECTED`);
      }
      if (p.pc?.connectionState === 'failed' || p.pc?.connectionState === 'disconnected') {
        p.isConnected = false;
      }
    };

    p.channel = window.supabaseClient.channel(`webrtc-${name}-${roomId}`);
    p.channel
      .on('broadcast', { event: `${evt}-ready` }, async () => {
        if (p.role !== 'sender' || !p.pc) return;
        console.log(`[WebRTC ${name}] Receiver ready → tạo offer`);
        try {
          const offer = await p.pc.createOffer();
          await p.pc.setLocalDescription(offer);
          p.channel.send({
            type: 'broadcast',
            event: `${evt}-offer`,
            payload: { offer: p.pc.localDescription },
          });
        } catch (e) { console.error(`[WebRTC ${name}] offer:`, e); }
      })
      .on('broadcast', { event: `${evt}-answer` }, async ({ payload }) => {
        if (p.role !== 'sender' || !p.pc || !payload?.answer) return;
        try {
          await p.pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
          console.log(`[WebRTC ${name}] Nhận answer ✅`);
        } catch (e) { console.error(`[WebRTC ${name}] answer:`, e); }
      })
      .on('broadcast', { event: `${evt}-ice-rx` }, async ({ payload }) => {
        if (p.role !== 'sender' || !p.pc || !payload?.candidate) return;
        try { await p.pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch (e) {}
      });

    await p.channel.subscribe();
    console.log(`[WebRTC ${name}] Sender ready · room=${roomId}`);
    return true;
  }

  async function _initReceiver(name, videoEl, roomId) {
    const p = _peer(name);
    p.role = 'receiver';
    p.roomId = roomId;
    p.remoteVideoEl = videoEl;

    p.pc = new RTCPeerConnection(ICE_SERVERS);

    p.pc.ontrack = (event) => {
      console.log(`[WebRTC ${name}] ✅ Nhận track:`, event.track.kind);
      if (p.remoteVideoEl && event.streams[0]) {
        p.remoteVideoEl.srcObject = event.streams[0];
        p.remoteVideoEl.play().catch((e) => console.error(`[WebRTC ${name}] play:`, e));
        // ⭐ Callback để app.js biết đã nhận stream
        if (typeof p.onTrack === 'function') p.onTrack(event.streams[0]);
      }
    };
    p.pc.onicecandidate = (e) => {
      if (e.candidate && p.channel) {
        p.channel.send({
          type: 'broadcast',
          event: `${evt}-ice-rx`,
          payload: { from: 'receiver', candidate: e.candidate },
        }).catch(() => {});
      }
    };
    p.pc.onconnectionstatechange = () => {
      console.log(`[WebRTC ${name}] state:`, p.pc?.connectionState);
      if (p.pc?.connectionState === 'connected') {
        p.isConnected = true;
        console.log(`[WebRTC ${name}] ✅ P2P RECEIVER CONNECTED`);
      }
    };

    const evt = _prefix(name);

    p.channel = window.supabaseClient.channel(`webrtc-${name}-${roomId}`);
    p.channel
      .on('broadcast', { event: `${evt}-offer` }, async ({ payload }) => {
        if (p.role !== 'receiver' || !p.pc || !payload?.offer) return;
        console.log(`[WebRTC ${name}] Nhận offer → tạo answer`);
        try {
          await p.pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
          const answer = await p.pc.createAnswer();
          await p.pc.setLocalDescription(answer);
          p.channel.send({
            type: 'broadcast',
            event: `${evt}-answer`,
            payload: { answer: p.pc.localDescription },
          });
        } catch (e) { console.error(`[WebRTC ${name}] answer:`, e); }
      })
      .on('broadcast', { event: `${evt}-ice` }, async ({ payload }) => {
        if (p.role !== 'receiver' || !p.pc || !payload?.candidate) return;
        try { await p.pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch (e) {}
      });

    await p.channel.subscribe();

    // Báo sender biết đã ready
    setTimeout(() => {
      p.channel.send({
        type: 'broadcast',
        event: `${evt}-ready`,
        payload: { from: 'receiver' },
      });
      console.log(`[WebRTC ${name}] Đã gửi ready`);
    }, 500);

    return true;
  }

  function disconnect(name) {
    const names = name ? [name] : Object.keys(peers);
    names.forEach((n) => {
      const p = peers[n];
      if (!p) return;
      if (p.pc) { try { p.pc.close(); } catch (e) {} p.pc = null; }
      if (p.channel) { try { p.channel.unsubscribe(); } catch (e) {} p.channel = null; }
      if (p.remoteVideoEl) p.remoteVideoEl.srcObject = null;
      p.isConnected = false;
      p.localStream = null;
    });
    if (!name) {
      Object.keys(peers).forEach((k) => delete peers[k]);
    }
  }

  // Đăng ký callback khi nhận track (dùng cho reverse receiver ở laptop)
  function onTrack(name, cb) {
    _peer(name).onTrack = cb;
  }

  return {
    // Forward (Laptop → iPad) — giữ nguyên API cũ
    initSender: (video, roomId) => _initSender('forward', video, roomId),
    initReceiver: (video, roomId) => _initReceiver('forward', video, roomId),

    // Reverse (iPad → Laptop) — ⭐ MỚI
    initReverseSender: (video, roomId) => _initSender('reverse', video, roomId),
    initReverseReceiver: (video, roomId) => _initReceiver('reverse', video, roomId),

    onTrack,
    disconnect,
    isReady: (name) => name ? (peers[name]?.isConnected || false)
                            : Object.values(peers).some((p) => p.isConnected),
  };
})();