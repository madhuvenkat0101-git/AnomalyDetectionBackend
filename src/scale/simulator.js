'use strict';

const logger = require('../logger');

class ScaleFanout {
  constructor(factor, engine) {
    this.factor = Math.max(0, factor | 0);
    this.engine = engine;
  }

  // Call once per real tick (in addition to processing the real tick itself).
  fanout(tick) {
    if (this.factor <= 0) return;
    for (let i = 1; i <= this.factor; i++) {
      // deterministic per-shadow perturbation (no Math.random -> reproducible)
      const jitter = 1 + ((i * 7) % 23 - 11) / 1000; // ~ ±1.1%
      this.engine.process({
        symbol: `${tick.symbol}-SIM${String(i).padStart(2, '0')}`,
        price: tick.price * jitter,
        ts: tick.ts,
      });
    }
  }

  logPlan(realSymbolCount) {
    if (this.factor > 0) {
      logger.warn('SCALE SIMULATION ACTIVE — shadow symbols are synthetic, not the real feed', {
        realSymbols: realSymbolCount,
        shadowPerReal: this.factor,
        totalConcurrentStreams: realSymbolCount * (1 + this.factor),
      });
    }
  }
}

module.exports = { ScaleFanout };