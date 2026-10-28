'use strict';
(function () {
  const TR = window.TR;
  const PREFIX = 'tir-yarisi-';
  // No 0/O or 1/I/L: the code is read out to the other player or typed off another screen.
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const CODE_LEN = 5;
  // A local guest that hears nothing from a host in this long takes the room to be missing.
  const LOCAL_WAIT_MS = 1500;

  const makeCode = () => Array.from({ length: CODE_LEN }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);

  // A link is { send(text), close() }, plus drop() on a host to let go of its guest. Its owner's handlers
  // are onReady (host: room is up), onOpen, onData(text), onClose and onError(kind), where kind is one
  // of 'taken' (host: code in use), 'missing' (guest: no such room) or 'network'.
  const KINDS = { 'unavailable-id': 'taken', 'peer-unavailable': 'missing' };
  const kindOf = (e) => KINDS[e && e.type] || 'network';

  // A host accepts the newest connection and closes the one before: the code is known only to its guest,
  // and a guest that reloads its tab comes back on a new connection before the old one is seen to die.
  function peerHost(code, h) {
    const peer = new window.Peer(PREFIX + code, { debug: 0 });
    let conn = null, closed = false;
    peer.on('open', () => h.onReady());
    peer.on('connection', (c) => {
      if (conn) conn.close();
      conn = c;
      c.on('open', () => conn === c && h.onOpen());
      c.on('data', (d) => conn === c && h.onData(d));
      c.on('close', () => {
        if (conn !== c) return;
        conn = null;
        h.onClose();
      });
    });
    peer.on('disconnected', () => {
      if (!closed) peer.reconnect();
    });
    peer.on('error', (e) => h.onError(kindOf(e)));
    return {
      send: (s) => conn && conn.open && conn.send(s),
      drop() {
        if (conn) conn.close();
        conn = null;
      },
      close() {
        closed = true;
        peer.destroy();
      },
    };
  }

  function peerJoin(code, h) {
    const peer = new window.Peer({ debug: 0 });
    let conn = null;
    peer.on('open', () => {
      conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'raw' });
      conn.on('open', () => h.onOpen());
      conn.on('data', (d) => h.onData(d));
      conn.on('close', () => h.onClose());
    });
    peer.on('error', (e) => h.onError(kindOf(e)));
    return { send: (s) => conn && conn.open && conn.send(s), close: () => peer.destroy() };
  }

  // Two tabs of one browser, for development and tests: ?net=local.
  function localLink(code, role, h) {
    const ch = new BroadcastChannel(PREFIX + code);
    const other = role === 'host' ? 'guest' : 'host';
    const post = (k, d) => ch.postMessage({ to: other, k, d });
    let open = false;
    ch.onmessage = (e) => {
      const m = e.data;
      if (m.to !== role) return;
      if (m.k === 'hi') {
        if (role === 'host') post('hi');
        else if (open) return;
        open = true;
        h.onOpen();
      } else if (m.k === 'bye') {
        if (!open) return;
        open = false;
        h.onClose();
      } else if (open) h.onData(m.d);
    };
    if (role === 'host') setTimeout(() => h.onReady(), 0);
    else {
      post('hi');
      setTimeout(() => !open && h.onError('missing'), LOCAL_WAIT_MS);
    }
    return {
      send: (s) => open && post('d', s),
      drop() {
        if (open) post('bye');
        open = false;
      },
      close() {
        if (open) post('bye');
        open = false;
        ch.close();
      },
    };
  }

  const local = () => /[?&]net=local\b/.test(window.location.search);

  TR.Net = {
    makeCode,
    cleanCode,
    CODE_LEN,
    available: () => local() || typeof window.Peer === 'function',
    host: (code, h) => (local() ? localLink(code, 'host', h) : peerHost(code, h)),
    join: (code, h) => (local() ? localLink(code, 'guest', h) : peerJoin(code, h)),
  };
})();
