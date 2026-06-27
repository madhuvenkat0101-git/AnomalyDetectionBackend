'use strict';

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const logger = require('./logger');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');


class ConfigStore extends EventEmitter {
  constructor(filePath = CONFIG_PATH) {
    super();
    this.filePath = filePath;
    this.current = this._read();
    this._watch();
  }

  get() {
    return this.current;
  }

  _read() {
    const raw = fs.readFileSync(this.filePath, 'utf8');
    const cfg = JSON.parse(raw);
    this._validate(cfg);
    return cfg;
  }

  _validate(cfg) {
    if (!cfg.symbols || typeof cfg.symbols !== 'object') {
      throw new Error('config.symbols missing');
    }
    for (const [sym, c] of Object.entries(cfg.symbols)) {
      if (c.strategy === 'spike') {
        if (!(c.thresholdPercent > 0) || !(c.windowSec > 0)) {
          throw new Error(`spike config for ${sym} needs thresholdPercent>0 and windowSec>0`);
        }
      } else if (c.strategy === 'movingAverage') {
        if (!(c.deviationPercent > 0) || !(c.sampleSize > 1)) {
          throw new Error(`movingAverage config for ${sym} needs deviationPercent>0 and sampleSize>1`);
        }
      } else {
        throw new Error(`unknown strategy '${c.strategy}' for ${sym}`);
      }
    }
  }

  _watch() {
    let debounce = null;
    try {
      fs.watch(this.filePath, () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          try {
            const next = this._read();
            this.current = next;
            logger.info('config hot-reloaded');
            this.emit('change', next);
          } catch (err) {
            logger.error('config reload failed, keeping previous', { err: err.message });
          }
        }, 150);
      });
    } catch (err) {
      logger.warn('config watch unavailable; hot-reload disabled', { err: err.message });
    }
  }
}

module.exports = { ConfigStore, CONFIG_PATH };