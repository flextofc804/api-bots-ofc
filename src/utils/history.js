'use strict';

const config = require('../config');
const JsonStore = require('./storage');

class DownloadHistory {
  constructor() {
    this.store = new JsonStore('downloads.json', []);
    this.rows = this.store.read();
    if (!Array.isArray(this.rows)) this.rows = [];
  }

  add(record) {
    this.rows.push(record);
    if (this.rows.length > config.downloadHistoryLimit) {
      this.rows = this.rows.slice(-config.downloadHistoryLimit);
    }
    this.store.scheduleWrite(this.rows);
    return record;
  }

  update(id, patch) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    this.store.scheduleWrite(this.rows);
    return row;
  }

  list({ limit = 50, platform = 'all', status = 'all', search = '' } = {}) {
    let rows = this.rows.slice().reverse();
    if (platform !== 'all') rows = rows.filter((r) => r.platform === platform);
    if (status !== 'all') rows = rows.filter((r) => r.status === status);
    if (search) {
      const needle = String(search).toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.title || '').toLowerCase().includes(needle) ||
          (r.url || '').toLowerCase().includes(needle) ||
          (r.id || '').toLowerCase().includes(needle)
      );
    }
    return rows.slice(0, Math.min(Math.max(Number(limit) || 50, 1), config.downloadHistoryLimit));
  }

  total() {
    return this.rows.length;
  }

  countByPlatform() {
    const counts = { tiktok: 0, instagram: 0, youtube: 0, other: 0 };
    for (const r of this.rows) {
      counts[r.platform] = (counts[r.platform] || 0) + 1;
    }
    return counts;
  }

  bytesServed() {
    return this.rows.reduce((sum, r) => sum + (Number(r.bytes_served) || 0), 0);
  }

  successRate() {
    if (!this.rows.length) return 100;
    const ok = this.rows.filter((r) => r.status === 'success').length;
    return Math.round((ok / this.rows.length) * 1000) / 10;
  }
}

module.exports = new DownloadHistory();
