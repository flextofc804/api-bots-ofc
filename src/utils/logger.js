'use strict';

const config = require('../config');
const JsonStore = require('./storage');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

class Logger {
  constructor() {
    this.store = new JsonStore('logs.json', []);
    this.entries = this.store.read();
    if (!Array.isArray(this.entries)) this.entries = [];
  }

  log(level, message, meta = {}) {
    const entry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      level,
      message: String(message),
      meta
    };
    this.entries.push(entry);
    if (this.entries.length > config.logRetention) {
      this.entries = this.entries.slice(-config.logRetention);
    }
    const line = `[${entry.ts}] [${level.toUpperCase()}] ${entry.message}`;
    if (level === 'error') console.error(line, Object.keys(meta).length ? meta : '');
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    this.store.scheduleWrite(this.entries);
    return entry;
  }

  debug(message, meta) {
    return this.log('debug', message, meta);
  }

  info(message, meta) {
    return this.log('info', message, meta);
  }

  warn(message, meta) {
    return this.log('warn', message, meta);
  }

  error(message, meta) {
    return this.log('error', message, meta);
  }

  query({ limit = 100, level = 'all', search = '' } = {}) {
    let rows = this.entries.slice().reverse();
    if (level !== 'all' && LEVELS[level] !== undefined) {
      rows = rows.filter((e) => LEVELS[e.level] >= LEVELS[level]);
    }
    if (search) {
      const needle = String(search).toLowerCase();
      rows = rows.filter(
        (e) =>
          e.message.toLowerCase().includes(needle) ||
          JSON.stringify(e.meta || {}).toLowerCase().includes(needle)
      );
    }
    return rows.slice(0, Math.min(Math.max(Number(limit) || 100, 1), config.logRetention));
  }

  countSince(sinceMs) {
    const cutoff = Date.now() - sinceMs;
    return this.entries.filter((e) => new Date(e.ts).getTime() >= cutoff).length;
  }

  errorCount() {
    return this.entries.filter((e) => e.level === 'error').length;
  }

  purge() {
    this.entries = [];
    this.store.flush(this.entries);
    this.info('Log store purged by administrator');
  }
}

module.exports = new Logger();
