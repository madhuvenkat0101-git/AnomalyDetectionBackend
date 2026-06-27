'use strict';

const EventEmitter = require('events');
const { io } = require('socket.io-client');
const { normalizeTick } = require('./normalizeTick');
const logger = require('../logger');

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