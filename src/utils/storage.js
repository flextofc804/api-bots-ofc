'use strict';

const fs = require('fs');
const path = require('path');

const config = require('../config');

class JsonStore {
  constructor(fileName, defaultValue) {
    this.filePath = path.join(config.dataDir, fileName);
    this.defaultValue = defaultValue;
    this._saveTimer = null;
    this._ensureDir();
  }

  _ensureDir() {
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  read() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`[storage] failed to read ${this.filePath}: ${err.message}`);
      }
      return JSON.parse(JSON.stringify(this.defaultValue));
    }
  }

  write(data) {
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      const tmpPath = `${this.filePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.filePath);
      return true;
    } catch (err) {
      console.error(`[storage] failed to write ${this.filePath}: ${err.message}`);
      return false;
    }
  }

  scheduleWrite(data, delayMs = 400) {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.write(data);
    }, delayMs);
    if (typeof this._saveTimer.unref === 'function') this._saveTimer.unref();
  }

  flush(data) {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    return this.write(data);
  }

  sizeBytes() {
    try {
      return fs.statSync(this.filePath).size;
    } catch {
      return 0;
    }
  }
}

module.exports = JsonStore;
