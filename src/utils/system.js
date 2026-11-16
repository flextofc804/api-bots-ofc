'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const config = require('../config');

class SystemMetrics {
  constructor() {
    this._lastSample = os.cpus().map((c) => c.times);
    this._cpuUsage = 0;
    this._netRx = 0;
    this._netTx = 0;
    this._interval = null;
    this._sample();
    this._interval = setInterval(() => this._sample(), 2000);
    if (typeof this._interval.unref === 'function') this._interval.unref();
  }

  _sample() {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    cpus.forEach((cpu, i) => {
      const prev = this._lastSample[i] || cpu.times;
      const t = cpu.times;
      const dIdle = t.idle - prev.idle;
      const dTotal =
        t.user - prev.user + t.nice - prev.nice + t.sys - prev.sys + t.idle - prev.idle + t.irq - prev.irq;
      idle += dIdle;
      total += dTotal;
    });
    if (total > 0) {
      this._cpuUsage = Math.min(100, Math.max(0, Math.round((1 - idle / total) * 1000) / 10));
    }
    this._lastSample = cpus.map((c) => c.times);
  }

  cpu() {
    return this._cpuUsage;
  }

  ram() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      used_bytes: used,
      total_bytes: total,
      used_human: humanBytes(used),
      total_human: humanBytes(total),
      percent: Math.round((used / total) * 1000) / 10
    };
  }

  uptimeSeconds() {
    return Math.floor(process.uptime());
  }

  osUptimeSeconds() {
    return Math.floor(os.uptime());
  }

  loadAverage() {
    return os.loadavg().map((v) => Math.round(v * 100) / 100);
  }

  directorySize(dir) {
    let total = 0;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) total += this.directorySize(full);
        else total += fs.statSync(full).size;
      }
    } catch {
      return 0;
    }
    return total;
  }

  storageUsed() {
    const bytes = this.directorySize(config.dataDir) + this.directorySize(config.tmpDir);
    return { bytes, human: humanBytes(bytes) };
  }

  snapshot() {
    return {
      cpu_percent: this.cpu(),
      ram: this.ram(),
      load_average: this.loadAverage(),
      uptime_seconds: this.uptimeSeconds(),
      os_uptime_seconds: this.osUptimeSeconds(),
      storage: this.storageUsed(),
      platform: `${os.type()} ${os.release()}`,
      node_version: process.version,
      pid: process.pid
    };
  }
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${Math.round(value * 10) / 10} ${units[i]}`;
}

module.exports = { metrics: new SystemMetrics(), humanBytes };
