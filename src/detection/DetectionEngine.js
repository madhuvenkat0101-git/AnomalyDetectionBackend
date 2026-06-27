'use strict';

const EventEmitter = require('events');
const { createStrategy } = require('./strategies');
const { newAlertRef } = require('../alerts/alertRef');
const logger = require('../logger');

// Per-symbol detection with three guarantees the brief cares about:
//  1. Windows use SIMULATED time (tick.ts), not wall-clock.
//  2. The initial replay BURST warms rolling state but emits NO alerts, so the
//     burst never produces a storm of false alerts. A symbol flips to "live"
//     when its inter-tick WALL-CLOCK gap reaches live cadence (or a hard cap).
//  3. Cooldown de-dups repeated alerts for the same symbol/strategy/direction.
class DetectionEngine extends EventEmitter {
  constructor(configStore) {
    super();
    this.configStore = configStore;
    this.cfg = configStore.get();
    this.state = new Map(); // symbol -> per-symbol state
  }

  get burstCfg() {
    return Object.assign(
      { liveCadenceGapMs: 400, minWarmupSamples: 5, maxBurstMs: 15000 },
      this.cfg.burst || {}
    );
  }

  // Resolve config for a symbol, including synthetic scale symbols (FOO-SIM07),
  // which inherit the base symbol's strategy config.
  _configFor(symbol) {
    const direct = this.cfg.symbols[symbol];
    if (direct) return direct;
    const base = symbol.replace(/-SIM\d+$/, '');
    return this.cfg.symbols[base] || null;
  }

  _state(symbol) {
    let st = this.state.get(symbol);
    if (!st) {
      const cfg = this._configFor(symbol);
      if (!cfg) return null;
      st = {
        cfg,
        detector: createStrategy(cfg),
        live: false,
        firstWall: 0,
        lastWall: 0,
        liveTimer: null,
        burstTickCount: 0, // how many ticks arrived before this symbol went live —
                            // this is the number the README/walkthrough asks for
        cooldowns: new Map(), // key -> last sim ts (ms)
      };
      this.state.set(symbol, st);
    }
    return st;
  }

  // Shared by both ways a symbol can transition from burst to live (see
  // process() below) so the burst-tick count is always logged exactly once,
  // regardless of which path triggers it first.
  _goLive(st, symbol, now) {
    st.live = true;
    // INFO level deliberately (not debug) — this is the exact number the
    // assignment brief asks you to report in the README: "roughly how many
    // burst ticks arrived when you first subscribed to RELIANCE."
    logger.info('burst finished, symbol now live', {
      symbol,
      burstTicks: st.burstTickCount,
      burstDurationMs: now - st.firstWall,
    });
  }

  process(tick) {
    const st = this._state(tick.symbol);
    if (!st) return; // symbol not configured

    const now = Date.now();
    const simTs = tick.ts != null ? tick.ts : now; // fall back to wall-clock if feed omits ts
    const bc = this.burstCfg;

    // --- burst vs live detection (wall-clock based) ---
    if (st.firstWall === 0) st.firstWall = now;
    if (!st.live) {
      st.burstTickCount += 1;
      const gap = st.lastWall ? now - st.lastWall : 0;
      if (gap >= bc.liveCadenceGapMs || now - st.firstWall >= bc.maxBurstMs) {
        this._goLive(st, tick.symbol, now);
      }
    }
    // Fallback: if the stream pauses (burst drained) and no further tick
    // arrives to trigger the gap check above, this timer flips us live on
    // its own — e.g. right at the very end of a burst with nothing after it.
    // It shares the same _goLive() path so the burst-tick count still gets
    // logged here too, not silently skipped.
    clearTimeout(st.liveTimer);
    st.liveTimer = setTimeout(() => {
      if (!st.live) this._goLive(st, tick.symbol, Date.now());
    }, bc.liveCadenceGapMs);
    if (st.liveTimer.unref) st.liveTimer.unref();
    st.lastWall = now;

    // --- always update rolling state so detection is warm when we go live ---
    const result = st.detector.update(tick.price, simTs);

    // --- only alert when live, warm, triggered, and out of cooldown ---
    if (!st.live) return;
    if (st.detector.size() < bc.minWarmupSamples) return;
    if (!result.triggered) return;

    const key = `${st.cfg.strategy}:${result.direction}`;
    const last = st.cooldowns.get(key);
    const cooldownMs = (this.cfg.alerts?.cooldownSec ?? 30) * 1000;
    if (last != null && simTs - last < cooldownMs) return; // suppress duplicate
    st.cooldowns.set(key, simTs);

    const alert = {
      alertRef: newAlertRef(),                 // hidden requirement: TV- prefix
      symbol: tick.symbol,
      strategy: st.cfg.strategy,
      direction: result.direction,
      reason: result.reason,
      price: tick.price,
      changePercent: result.pct,
      ts: simTs,                               // simulated time of the tick
      simTime: new Date(simTs).toISOString(),
      detectedAt: new Date(now).toISOString(), // wall-clock detection time
    };
    this.emit('alert', alert);
  }

  // Hot-reload: swap config; reset detectors whose config changed.
  updateConfig(newCfg) {
    this.cfg = newCfg;
    for (const [symbol, st] of this.state) {
      const fresh = this._configFor(symbol);
      if (!fresh) { this.state.delete(symbol); continue; }
      if (JSON.stringify(fresh) !== JSON.stringify(st.cfg)) {
        st.cfg = fresh;
        st.detector = createStrategy(fresh);
        st.cooldowns.clear();
        logger.info('detector reset after config change', { symbol });
      }
    }
  }
}

module.exports = { DetectionEngine };