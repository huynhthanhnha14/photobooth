// ============================================
// REALTIME SYNC — Laptop ↔ iPad (chỉ signaling + state)
// ============================================
window.RealtimeSync = (function () {
  let channel = null;
  let roomId = null;
  let role = null;
  let handlers = {};

  function connect(rid, r) {
    if (channel) disconnect();
    roomId = rid;
    role = r;

    console.log(`[RealtimeSync] Connect room=${rid}, role=${r}`);

    channel = window.supabaseClient.channel(`booth-${roomId}`, {
      config: { broadcast: { self: false, ack: false } },
    });

    channel
      .on('broadcast', { event: 'state' }, (p) => handlers.onState && handlers.onState(p.payload))
      .on('broadcast', { event: 'command' }, (p) => handlers.onCommand && handlers.onCommand(p.payload))
      .on('broadcast', { event: 'video' }, (p) => handlers.onVideo && handlers.onVideo(p.payload))
      .on('broadcast', { event: 'pair' }, (p) => handlers.onPair && handlers.onPair(p.payload));

    return channel.subscribe((status, err) => {
      console.log(`[RealtimeSync] ${status}`, err || '');
      if (status === 'SUBSCRIBED' && handlers.onConnect) handlers.onConnect();
    });
  }

  function disconnect() {
    if (channel) { try { channel.unsubscribe(); } catch (e) {} channel = null; }
    roomId = null;
  }

  function sendState(data) {
    if (!channel) return;
    channel.send({ type: 'broadcast', event: 'state', payload: data }).catch(() => {});
  }

  function sendCommand(data) {
    if (!channel) return;
    channel.send({ type: 'broadcast', event: 'command', payload: data }).catch(() => {});
  }

  function sendVideo(data) {
    if (!channel) return;
    channel.send({ type: 'broadcast', event: 'video', payload: data }).catch(() => {});
  }

  function sendPair(data) {
    if (!channel) return;
    channel.send({ type: 'broadcast', event: 'pair', payload: data }).catch(() => {});
  }

  function genRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  return {
    connect, disconnect,
    sendState, sendCommand, sendVideo, sendPair,
    genRoomId,
    on: (e, cb) => { handlers[e] = cb; },
    getRoomId: () => roomId,
    getRole: () => role,
  };
})();