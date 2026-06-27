'use strict';

require('dotenv').config();
const crypto = require('crypto');

const logger = require('./logger');
const { ConfigStore } = require('./config');
const { FeedClient } = require('./feed/FeedClient');
const { DetectionEngine } = require('./detection/DetectionEngine');
const { AlertStore } = require('./alerts/AlertStore');
const { ApiServer } = require('./api/server');
const { ScaleFanout } = require('./scale/simulator');

function main() {
  const configStore = new ConfigStore();
  const cfg = configStore.get();


  let apiKey = process.env.API_KEY;
  if (!apiKey) {
    apiKey = crypto.randomBytes(24).toString('hex');
    logger.warn('API_KEY not set — generated an ephemeral key for this run', { apiKey });
  }

  const alertStore = new AlertStore(cfg.alerts?.maxStored ?? 200);
  const engine = new DetectionEngine(configStore);
  const api = new ApiServer({ port: Number(process.env.PORT) || 4000, apiKey, alertStore });
  const feed = new FeedClient(cfg.feed);

  const scaleFactor = Number(process.env.SCALE_FACTOR) || 0;
  const fanout = new ScaleFanout(scaleFactor, engine);

  // Wire detection -> storage + broadcast + log
  engine.on('alert', (alert) => {
    alertStore.add(alert);
    api.broadcastAlert(alert);
    logger.info('ALERT', alert);
  });

  // Wire feed -> detection (+ scale fanout) + broadcast
  feed.on('tick', (tick) => {
    engine.process(tick);
    fanout.fanout(tick);
    api.broadcastTick(tick);
  });

  // Hot-reload: re-subscribe symbols and refresh detectors when config changes
  configStore.on('change', (next) => {
    engine.updateConfig(next);
    feed.setSymbols(Object.keys(next.symbols));
  });

  const symbols = Object.keys(cfg.symbols);
  fanout.logPlan(symbols.length);
  feed.setSymbols(symbols);
  feed.start();
  api.start();

  logger.info('service started', { symbols, scaleFactor });

  // Graceful shutdown
  const shutdown = (sig) => {
    logger.info('shutting down', { sig });
    feed.stop();
    api.stop();
    setTimeout(() => process.exit(0), 200);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => logger.error('uncaughtException', { err: err.message, stack: err.stack }));
  process.on('unhandledRejection', (err) => logger.error('unhandledRejection', { err: String(err) }));
}

main();