'use strict';

const SYMBOL_KEYS = ['SYMBOL', 'symbol', 'sym', 's', 'ticker', 'instrument', 'scrip'];
const PRICE_KEYS = ['LTP', 'ltp', 'price', 'last', 'lastPrice', 'p', 'close', 'c', 'value'];
const TS_KEYS = ['TS', 'ts', 'timestamp', 'time', 't', 'epoch', 'simTime', 'simTimestamp'];


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