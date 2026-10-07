// ============================================
// REALTIME SYNC — Đồng bộ Laptop ↔ iPad qua Supabase
// ============================================
window.RealtimeSync = (function () {
  let channel = null;
  let roomId = null;
  let role = null;   // 'laptop' hoặc 'ipad'
  let handlers = {};

  function connect(rid, r) {
    if (channel) disconnect();

    roomId = rid;
    role = r;

    channel = window.supabaseClient.channel(`booth-${roomId}`, {
      config: {
        broadcast: { self: false, ack: false },
      },
    });

    channel
      .on('broadcast', { event: 'state' }, (payload) => {
        if (handlers.onState) handlers.onState(payload.payload);
      })
      .on('broadcast', { event: 'command' }, (payload) => {
        if (handlers.onCommand) handlers.onCommand(payload.payload);
      })
      .on('broadcast', { event: 'video' }, (payload) => {
        if (handlers.onVideo) handlers.onVideo(payload.payload);
      })
      .on('broadcast', { event: 'pair' }, (payload) => {
        if (handlers.onPair) handlers.onPair(payload.payload);
      });

    return channel.subscribe((status) => {
      console.log('[Realtime] Status:', status, '· Room:', roomId, '· Role:', role);
      if (status === 'SUBSCRIBED' && handlers.onConnect) handlers.onConnect();
    });
  }

  function disconnect() {
    if (channel) {
      try { channel.unsubscribe(); } catch (e) {}
      channel = null;
    }
    roomId = null;
  }

  function sendState(data) {
    if (!channel) return;
    channel.send({ type: 'broadcast', event: 'state', payload: data });
  }

  function sendCommand(data) {
    if (!channel) return;
    channel.send({ type: 'broadcast', event: 'command', payload: data });
  }

  function sendVideo(data) {
    if (!channel) return;
    channel.send({ type: 'broadcast', event: 'video', payload: data });
  }

  function sendPair(data) {
    if (!channel) return;
    channel.send({ type: 'broadcast', event: 'pair', payload: data });
  }

  function genRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  return {
    connect,
    disconnect,
    sendState,
    sendCommand,
    sendVideo,
    sendPair,
    genRoomId,
    on: (event, cb) => { handlers[event] = cb; },
    getRoomId: () => roomId,
    getRole: () => role,
  };
})();