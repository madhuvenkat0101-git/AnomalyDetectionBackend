'use strict';

class SpikeStrategy {
  constructor({ thresholdPercent, windowSec }) {
    this.threshold = thresholdPercent;
    this.windowMs = windowSec * 1000;
    this.buf = []; // [{ ts, price }] ordered by ts, pruned to window
  }

  update(price, ts) {
    this.buf.push({ ts, price });
    const cutoff = ts - this.windowMs;
    while (this.buf.length && this.buf[0].ts < cutoff) this.buf.shift();

    let min = Infinity, max = -Infinity;
    for (const s of this.buf) {
      if (s.price < min) min = s.price;
      if (s.price > max) max = s.price;
    }
    const upPct = ((price - min) / min) * 100;   // rise from window low
    const downPct = ((max - price) / max) * 100; // fall from window high

    if (upPct >= this.threshold) {
      return {
        triggered: true, direction: 'spike', pct: round(upPct),
        reason: `Price spiked +${round(upPct)}% (from ${round(min)} to ${round(price)}) within ${this.windowMs / 1000}s window`,
      };
    }
    if (downPct >= this.threshold) {
      return {
        triggered: true, direction: 'drop', pct: round(downPct),
        reason: `Price dropped -${round(downPct)}% (from ${round(max)} to ${round(price)}) within ${this.windowMs / 1000}s window`,
      };
    }
    return { triggered: false };
  }

  size() { return this.buf.length; }
}

class MovingAverageStrategy {
  constructor({ deviationPercent, sampleSize }) {
    this.deviation = deviationPercent;
    this.n = sampleSize;
    this.ring = new Array(this.n).fill(0);
    this.count = 0;
    this.head = 0;
    this.sum = 0;
  }

  update(price, _ts) {
    let result = { triggered: false };
    if (this.count >= this.n) {
      const avg = this.sum / this.n; // baseline = previous N samples
      const devPct = ((price - avg) / avg) * 100;
      if (Math.abs(devPct) >= this.deviation) {
        result = {
          triggered: true,
          direction: devPct > 0 ? 'above' : 'below',
          pct: round(devPct),
          reason: `Price ${round(price)} deviates ${round(devPct)}% from ${this.n}-sample avg ${round(avg)} (limit ±${this.deviation}%)`,
        };
      }
    }
    // push current price into the ring (evict oldest, keep running sum)
    if (this.count >= this.n) this.sum -= this.ring[this.head];
    this.ring[this.head] = price;
    this.sum += price;
    this.head = (this.head + 1) % this.n;
    if (this.count < this.n) this.count++;
    return result;
  }

  size() { return this.count; }
}

function round(x) { return Math.round(x * 100) / 100; }

function createStrategy(cfg) {
  if (cfg.strategy === 'spike') return new SpikeStrategy(cfg);
  if (cfg.strategy === 'movingAverage') return new MovingAverageStrategy(cfg);
  throw new Error(`unknown strategy ${cfg.strategy}`);
}

module.exports = { SpikeStrategy, MovingAverageStrategy, createStrategy };