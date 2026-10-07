// ============================================
// WebRTC STREAM — 30fps P2P qua LAN
// ============================================
window.WebRTCStream = (function () {
  let pc = null;
  let localStream = null;
  let role = null;
  let roomId = null;
  let channel = null;
  let remoteVideoEl = null;
  let isConnected = false;

  // ⭐ Nhiều STUN server để tăng tỉ lệ kết nối thành công
  const ICE_SERVERS = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.services.mozilla.com' },
    ],
    iceCandidatePoolSize: 10,
  };

  // ============================================
  // LAPTOP: SENDER
  // ============================================
  async function initSender(videoSource, rid) {
    role = 'sender';
    roomId = rid;

    if (!videoSource || !videoSource.srcObject) {
      console.error('[WebRTC] ❌ Không có video source');
      return false;
    }

    localStream = videoSource.srcObject;
    const tracks = localStream.getVideoTracks();
    if (!tracks.length) {
      console.error('[WebRTC] ❌ Không có video track');
      return false;
    }

    console.log('[WebRTC Sender] Khởi tạo · Track:', tracks[0].label);

    // Tạo peer connection
    pc = new RTCPeerConnection(ICE_SERVERS);

    // Add video track
    tracks.forEach((track) => {
      pc.addTrack(track, localStream);
    });

    // Gửi ICE candidates qua Supabase
    pc.onicecandidate = (event) => {
      if (event.candidate && channel) {
        channel.send({
          type: 'broadcast',
          event: 'webrtc-ice',
          payload: { from: 'sender', candidate: event.candidate },
        }).catch(() => {});
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC Sender] ICE state:', pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log('[WebRTC Sender] Connection:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        isConnected = true;
        console.log('[WebRTC] ✅ KẾT NỐI P2P THÀNH CÔNG');
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        isConnected = false;
        console.warn('[WebRTC] ⚠️ Mất kết nối');
      }
    };

    // Signaling channel
    channel = window.supabaseClient.channel(`webrtc-${roomId}`);

    channel
      .on('broadcast', { event: 'webrtc-ready' }, async ({ payload }) => {
        // iPad đã ready → tạo offer
        if (role !== 'sender' || !pc) return;
        console.log('[WebRTC Sender] iPad ready, tạo offer...');
        await createOffer();
      })
      .on('broadcast', { event: 'webrtc-answer' }, async ({ payload }) => {
        if (role !== 'sender' || !pc) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
          console.log('[WebRTC Sender] ✅ Đã nhận answer');
        } catch (e) { console.error('[WebRTC Sender] setRemoteDescription:', e); }
      })
      .on('broadcast', { event: 'webrtc-ice-ipad' }, async ({ payload }) => {
        if (role !== 'sender' || !pc || !payload.candidate) return;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch (e) { /* ignore */ }
      });

    await channel.subscribe();
    console.log('[WebRTC Sender] Ready · Room:', roomId);
    return true;
  }

  async function createOffer() {
    try {
      const offer = await pc.createOffer({
        offerToReceiveVideo: false,
        offerToReceiveAudio: false,
      });
      await pc.setLocalDescription(offer);

      channel.send({
        type: 'broadcast',
        event: 'webrtc-offer',
        payload: { offer: pc.localDescription },
      });
      console.log('[WebRTC Sender] Đã gửi offer');
    } catch (e) {
      console.error('[WebRTC Sender] createOffer:', e);
    }
  }

  // ============================================
  // iPAD: RECEIVER
  // ============================================
  async function initReceiver(videoEl, rid) {
    role = 'receiver';
    roomId = rid;
    remoteVideoEl = videoEl;

    console.log('[WebRTC Receiver] Khởi tạo · Room:', roomId);

    pc = new RTCPeerConnection(ICE_SERVERS);

    // Khi nhận được video track
    pc.ontrack = (event) => {
      console.log('[WebRTC Receiver] ✅ Nhận track:', event.track.kind);
      if (remoteVideoEl && event.streams[0]) {
        remoteVideoEl.srcObject = event.streams[0];
        remoteVideoEl.play().then(() => {
          console.log('[WebRTC Receiver] Video playing');
          const ph = document.getElementById('video-placeholder');
          if (ph) ph.style.display = 'none';
        }).catch((e) => console.error('play error:', e));
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && channel) {
        channel.send({
          type: 'broadcast',
          event: 'webrtc-ice-ipad',
          payload: { from: 'receiver', candidate: event.candidate },
        }).catch(() => {});
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC Receiver] ICE state:', pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log('[WebRTC Receiver] Connection:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        isConnected = true;
        console.log('[WebRTC] ✅ KẾT NỐI P2P THÀNH CÔNG');
      }
    };

    // Signaling channel
    channel = window.supabaseClient.channel(`webrtc-${roomId}`);

    channel
      .on('broadcast', { event: 'webrtc-offer' }, async ({ payload }) => {
        if (role !== 'receiver' || !pc) return;
        console.log('[WebRTC Receiver] Nhận offer');
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          channel.send({
            type: 'broadcast',
            event: 'webrtc-answer',
            payload: { answer: pc.localDescription },
          });
          console.log('[WebRTC Receiver] Đã gửi answer');
        } catch (e) { console.error('[WebRTC Receiver] answer:', e); }
      })
      .on('broadcast', { event: 'webrtc-ice' }, async ({ payload }) => {
        if (role !== 'receiver' || !pc || !payload.candidate) return;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch (e) { /* ignore */ }
      });

    await channel.subscribe();

    // Thông báo cho sender biết receiver đã ready
    setTimeout(() => {
      channel.send({
        type: 'broadcast',
        event: 'webrtc-ready',
        payload: { from: 'ipad' },
      });
      console.log('[WebRTC Receiver] Đã gửi ready');
    }, 500);

    return true;
  }

  function disconnect() {
    isConnected = false;
    if (pc) {
      try { pc.close(); } catch (e) {}
      pc = null;
    }
    if (channel) {
      try { channel.unsubscribe(); } catch (e) {}
      channel = null;
    }
    if (remoteVideoEl) {
      remoteVideoEl.srcObject = null;
    }
    localStream = null;
  }

  return { initSender, initReceiver, disconnect, isReady: () => isConnected };
})();