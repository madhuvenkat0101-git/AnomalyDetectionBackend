'use strict';

// Standalone scale/throughput harness — NO network. It drives the real
// DetectionEngine with synthetic ticks to measure how the detection pipeline
// holds up under many concurrent symbol streams. This is explicitly a benchmark
// of OUR pipeline, not of the TealVue feed.
//
// Usage: node scripts/loadtest.js [numSymbols] [ticksPerSymbol]
//   e.g. node scripts/loadtest.js 1000 200

const { DetectionEngine } = require('../src/detection/DetectionEngine');

const numSymbols = Number(process.argv[2]) || 1000;
const ticksPerSymbol = Number(process.argv[3]) || 200;

// Build an in-memory config store stub with N symbols (alternating strategies).
const symbols = {};
for (let i = 0; i < numSymbols; i++) {
  const s = `SYM${String(i).padStart(4, '0')}`;
  symbols[s] = i % 2 === 0
    ? { strategy: 'spike', thresholdPercent: 3, windowSec: 30 }
    : { strategy: 'movingAverage', deviationPercent: 5, sampleSize: 10 };
}
const cfg = {
  symbols,
  burst: { liveCadenceGapMs: 0, minWarmupSamples: 5, maxBurstMs: 0 }, // force "live" immediately
  alerts: { cooldownSec: 30 },
};
const stubStore = { get: () => cfg, on: () => {} };

const engine = new DetectionEngine(stubStore);
let alertCount = 0;
engine.on('alert', () => alertCount++);

const symList = Object.keys(symbols);
const totalTicks = numSymbols * ticksPerSymbol;
let base = 100;

const memBefore = process.memoryUsage().heapUsed;
const start = process.hrtime.bigint();

let simTs = Date.now();
for (let t = 0; t < ticksPerSymbol; t++) {
  simTs += 1000; // advance simulated time 1s per round
  for (const symbol of symList) {
    // occasional engineered spike so the pipeline actually fires alerts
    const shock = t % 50 === 0 ? 1.05 : 1 + (Math.sin(t + symbol.length) / 500);
    engine.process({ symbol, price: base * shock, ts: simTs });
  }
}

const end = process.hrtime.bigint();
const memAfter = process.memoryUsage().heapUsed;
const ms = Number(end - start) / 1e6;

console.log('--- Load test ---');
console.log('symbols:           ', numSymbols);
console.log('ticks/symbol:      ', ticksPerSymbol);
console.log('total ticks:       ', totalTicks.toLocaleString());
console.log('elapsed:           ', ms.toFixed(1), 'ms');
console.log('throughput:        ', Math.round(totalTicks / (ms / 1000)).toLocaleString(), 'ticks/sec');
console.log('alerts emitted:    ', alertCount.toLocaleString());
console.log('heap delta:        ', ((memAfter - memBefore) / 1024 / 1024).toFixed(1), 'MB');