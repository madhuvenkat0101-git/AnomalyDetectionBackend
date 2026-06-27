'use strict';

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const logger = require('../logger');


class ApiServer {
  constructor({ port, apiKey, alertStore }) {
    this.port = port;
    this.apiKey = apiKey;
    this.alertStore = alertStore;
    this.app = express();
    this.httpServer = http.createServer(this.app);
    this.io = new Server(this.httpServer, { cors: { origin: '*' } });
    this._routes();
  }

  _authMiddleware() {
    const expected = this.apiKey;
    return (req, res, next) => {
      const provided = req.get('x-api-key') || '';
      const a = Buffer.from(provided);
      const b = Buffer.from(expected);
      const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!ok) return res.status(401).json({ success: false, error: 'unauthorized' });
      next();
    };
  }

  _routes() {
    this.app.disable('x-powered-by');

    this.app.use(
      cors({
        origin: '*',
        methods: ['GET'],
        allowedHeaders: ['Content-Type', 'x-api-key'],
      })
    );

    // Public, cheap liveness probe.
    this.app.get('/health', (req, res) => {
      res.json({ success: true, alerts: this.alertStore.size(), uptimeSec: Math.round(process.uptime()) });
    });

    const limiter = rateLimit({
      windowMs: 60 * 1000,
      max: 60,                  // 60 req/min/IP
      standardHeaders: true,
      legacyHeaders: false,
    });

    // Secured: returns the last N alerts (default 10, capped at 100).
    this.app.get('/api/alerts', limiter, this._authMiddleware(), (req, res) => {
      let limit = parseInt(req.query.limit, 10);
      if (!Number.isFinite(limit) || limit <= 0) limit = 10;
      limit = Math.min(limit, 100);
      res.json({ success: true, count: Math.min(limit, this.alertStore.size()), data: this.alertStore.recent(limit) });
    });
  }

  // Live broadcast to any connected dashboard / consumer.
  broadcastTick(tick) { this.io.emit('tick', tick); }
  broadcastAlert(alert) { this.io.emit('alert', alert); }

  start() {
    this.httpServer.listen(this.port, () => {
      logger.info('api listening', { port: this.port });
    });
  }

  stop() {
    this.io.close();
    this.httpServer.close();
  }
}

module.exports = { ApiServer };