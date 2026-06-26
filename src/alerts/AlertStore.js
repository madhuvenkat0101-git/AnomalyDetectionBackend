'use strict';

// Bounded in-memory ring buffer of the most recent alerts.
// O(1) append, O(limit) read. Newest-first on read.
class AlertStore {
  constructor(maxStored = 200) {
    this.max = maxStored;
    this.buf = [];
  }

  add(alert) {
    this.buf.push(alert);
    if (this.buf.length > this.max) this.buf.shift();
  }

  // Most recent `limit` alerts, newest first. Brief asks for last 10 by default.
  recent(limit = 10) {
    const n = Math.min(limit, this.buf.length);
    return this.buf.slice(this.buf.length - n).reverse();
  }

  size() { return this.buf.length; }
}

module.exports = { AlertStore };