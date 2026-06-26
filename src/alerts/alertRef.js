'use strict';

const crypto = require('crypto');

// Hidden-brief requirement: every alert carries a correlation id prefixed `TV-`.
function newAlertRef() {
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 hex chars
  return `TV-${rand}`;
}

module.exports = { newAlertRef };