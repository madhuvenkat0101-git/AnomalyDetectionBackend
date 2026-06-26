'use strict';

// api_docs.md documents the "ticker" event payload explicitly, e.g.:
//   { "SYMBOL": "RELIANCE", "LTP": 2465.75, "TS": "2026-05-04 11:30:15+05:30", ... }
// Field names are UPPERCASE. JS object key lookup is case-sensitive, so
// obj['symbol'] on a payload shaped like obj.SYMBOL returns undefined - that
// silently dropped every real tick (the original bug). We match the
// documented uppercase names first, and keep a few lowercase fallbacks in
// case the feed ever changes casing, but we look keys up case-insensitively
// so this can't silently regress the same way again.
const SYMBOL_KEYS = ['SYMBOL', 'symbol', 'sym', 's', 'ticker', 'instrument', 'scrip'];
const PRICE_KEYS = ['LTP', 'ltp', 'price', 'last', 'lastPrice', 'p', 'close', 'c', 'value'];
const TS_KEYS = ['TS', 'ts', 'timestamp', 'time', 't', 'epoch', 'simTime', 'simTimestamp'];

// Case-insensitive lookup: build a lowercase-keyed index of the payload once,
// then match candidate keys against it lowercased. This protects us even if
// the feed's casing ever shifts again - we no longer depend on getting the
// exact case right.
function pick(obj, keys) {
  const lowerMap = {};
  for (const k of Object.keys(obj)) lowerMap[k.toLowerCase()] = obj[k];

  for (const k of keys) {
    const v = lowerMap[k.toLowerCase()];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

// Coerce a variety of timestamp encodings to epoch milliseconds.
function toEpochMs(raw) {
  if (raw === undefined) return null;
  if (typeof raw === 'number') {
    return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw); // 10-digit=sec, 13-digit=ms
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

// Returns { symbol, price, ts, raw } or null if the payload is not a usable tick.
// `ts` is the SIMULATED time of the tick (epoch ms); detection windows use this,
// not wall-clock.
function normalizeTick(payload) {
  let obj = payload;
  if (Array.isArray(payload)) obj = payload[0];
  if (!obj || typeof obj !== 'object') return null;

  const symbol = pick(obj, SYMBOL_KEYS);
  const priceRaw = pick(obj, PRICE_KEYS);
  const tsRaw = pick(obj, TS_KEYS);

  const price = typeof priceRaw === 'string' ? parseFloat(priceRaw) : priceRaw;
  if (!symbol || typeof price !== 'number' || !Number.isFinite(price)) return null;

  return {
    symbol: String(symbol).toUpperCase(),
    price,
    ts: toEpochMs(tsRaw),
    raw: obj,
  };
}

module.exports = { normalizeTick };