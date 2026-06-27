'use strict';

function line(level, msg, meta) {
  const rec = { t: new Date().toISOString(), level, msg };
  if (meta) rec.meta = meta;
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(rec) + '\n');
}

module.exports = {
  info: (msg, meta) => line('info', msg, meta),
  warn: (msg, meta) => line('warn', msg, meta),
  error: (msg, meta) => line('error', msg, meta),
  debug: (msg, meta) => {
    if (process.env.DEBUG) line('debug', msg, meta);
  },
};