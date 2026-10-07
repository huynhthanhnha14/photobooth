// ============================================
// WebRTC STREAM — Laptop → iPad (P2P, mượt)
// ============================================
window.WebRTCStream = (function () {
  let pc = null;
  let localStream = null;
  let role = null;   // 'sender' (laptop) hoặc 'receiver' (iPad)
  let roomId = null;
  let channel = null;
  let remoteVideoEl = null;

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // ⭐ Laptop: gửi video sang iPad
  async function initSender(videoSource, rid) {
    role = 'sender';
    roomId = rid;

    if (!videoSource || !videoSource.srcObject) {
      console.error('[WebRTC] Không có video source');
      return false;
    }

    localStream = videoSource.srcObject;

    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Add tracks
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });

    // Gửi ICE candidates qua Supabase
    pc.onicecandidate = (event) => {
      if (event.candidate && channel) {
        channel.send({
          type: 'broadcast',
          event: 'webrtc-ice',
          payload: { role: 'sender', candidate: event.candidate },
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[WebRTC Sender] State:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        console.log('[WebRTC] ✅ Đã kết nối P2P');
      }
    };

    // Lắng nghe từ iPad qua kênh riêng
    channel = window.supabaseClient.channel(`webrtc-${roomId}`);
    channel
      .on('broadcast', { event: 'webrtc-answer' }, async ({ payload }) => {
        if (role !== 'sender' || !pc) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
          console.log('[WebRTC] Đã nhận answer');
        } catch (e) { console.error('setRemoteDescription error:', e); }
      })
      .on('broadcast', { event: 'webrtc-ice-ipad' }, async ({ payload }) => {
        if (role !== 'sender' || !pc) return;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch (e) { /* ignore */ }
      })
      .on('broadcast', { event: 'webrtc-request' }, async () => {
        // iPad xin stream → tạo offer mới
        if (role !== 'sender' || !pc) return;
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          channel.send({
            type: 'broadcast',
            event: 'webrtc-offer',
            payload: { offer },
          });
          console.log('[WebRTC] Đã gửi offer');
        } catch (e) { console.error(e); }
      });

    await channel.subscribe();
    console.log('[WebRTC] Sender ready, room:', roomId);
    return true;
  }

  // ⭐ iPad: nhận video
  async function initReceiver(videoEl, rid) {
    role = 'receiver';
    roomId = rid;
    remoteVideoEl = videoEl;

    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Nhận track → gắn vào video
    pc.ontrack = (event) => {
      console.log('[WebRTC Receiver] Nhận track:', event.track.kind);
      if (remoteVideoEl && event.streams[0]) {
        remoteVideoEl.srcObject = event.streams[0];
        remoteVideoEl.play().catch(() => {});
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && channel) {
        channel.send({
          type: 'broadcast',
          event: 'webrtc-ice-ipad',
          payload: { role: 'receiver', candidate: event.candidate },
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[WebRTC Receiver] State:', pc.connectionState);
    };

    // Lắng nghe offer + ICE
    channel = window.supabaseClient.channel(`webrtc-${roomId}`);
    channel
      .on('broadcast', { event: 'webrtc-offer' }, async ({ payload }) => {
        if (role !== 'receiver' || !pc) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          channel.send({
            type: 'broadcast',
            event: 'webrtc-answer',
            payload: { answer },
          });
          console.log('[WebRTC] Đã gửi answer');
        } catch (e) { console.error('Answer error:', e); }
      })
      .on('broadcast', { event: 'webrtc-ice' }, async ({ payload }) => {
        if (role !== 'receiver' || !pc) return;
        try {
          await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch (e) { /* ignore */ }
      });

    await channel.subscribe();

    // Xin stream từ laptop
    setTimeout(() => {
      channel.send({
        type: 'broadcast',
        event: 'webrtc-request',
        payload: { from: 'ipad' },
      });
      console.log('[WebRTC] Đã xin stream');
    }, 500);
  }

  function disconnect() {
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

  return { initSender, initReceiver, disconnect, getRole: () => role };
})();