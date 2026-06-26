'use strict';

const EventEmitter = require('events');
const { io } = require('socket.io-client');
const { normalizeTick } = require('./normalizeTick');
const logger = require('../logger');

// Owns the Socket.IO connection to the TealVue mock feed.
//   - connect with automatic reconnection (socket.io handles backoff)
//   - (re)subscribe to configured symbols on every (re)connect
//   - capture ticks regardless of exact event name (onAny) and normalize them
//   - re-emit clean 'tick' events: { symbol, price, ts, raw }
// It knows nothing about anomaly detection (single responsibility).
class FeedClient extends EventEmitter {
  constructor(feedConfig) {
    super();
    this.cfg = feedConfig;
    this.symbols = new Set();
    this.socket = null;
    this.connected = false;
  }

  setSymbols(symbols) {
    this.symbols = new Set(symbols.map((s) => s.toUpperCase()));
    if (this.connected) this._subscribeAll();
  }

  start() {
    this.socket = io(this.cfg.url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
    });

    this.socket.on('connect', () => {
      this.connected = true;
      logger.info('feed connected', { id: this.socket.id });
      this._subscribeAll();
      this.emit('connect');
    });

    this.socket.on('disconnect', (reason) => {
      this.connected = false;
      logger.warn('feed disconnected', { reason });
      this.emit('disconnect', reason);
    });

    this.socket.on('connect_error', (err) => {
      logger.warn('feed connect_error', { err: err.message });
    });

    // Capture every inbound event. Acks/status events are dropped by the
    // normalizer (no symbol+price); real ticks for subscribed symbols pass through.
    this.socket.onAny((event, ...args) => {
      for (const payload of args) {
        const tick = normalizeTick(payload);
        if (tick && this.symbols.has(tick.symbol)) {
          this.emit('tick', tick);
        }
      }
    });

    return this;
  }

  // CRITICAL FIX: api_docs.md documents two things that combine into a bug
  // if ignored:
  //   1. The subscribe payload format is `string[]` (an array), not a bare
  //      string.
  //   2. "Dynamic Single-Symbol Switching: Overwrites any prior subscription
  //      on the connection state instantly" - meaning a SECOND subscribe
  //      call replaces the first, it does not add to it.
  // The old code looped and called socket.emit('subscribe', symbol) once
  // per symbol with a bare string payload - each call silently overwrote
  // the previous one, so only the LAST symbol in the loop ever ended up
  // actually subscribed, and even that one was sent in the wrong shape.
  // The fix: ONE subscribe call, with an array containing every symbol.
  _subscribeAll() {
    if (this.symbols.size === 0) return;
    const evt = this.cfg.subscribeEvent || 'subscribe';
    const payload = [...this.symbols];
    this.socket.emit(evt, payload);
    logger.info('subscribed', { evt, symbols: payload });
  }

  stop() {
    if (this.socket) this.socket.close();
  }
}

module.exports = { FeedClient };