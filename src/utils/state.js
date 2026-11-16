'use strict';

const config = require('../config');

class ExtractionCache {
  constructor() {
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (Date.now() - hit.ts > config.cacheTtlMs) {
      this.map.delete(key);
      return null;
    }
    hit.hits += 1;
    return hit.value;
  }

  set(key, value) {
    if (this.map.size >= config.cacheMaxEntries) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, { ts: Date.now(), hits: 0, value });
  }

  clear() {
    const size = this.map.size;
    this.map.clear();
    return size;
  }

  size() {
    return this.map.size;
  }
}

class JobManager {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.active = new Map();
    this.completed = 0;
    this.failed = 0;
    this.restarts = 0;
  }

  start(id, abortController) {
    this.active.set(id, { abortController, startedAt: Date.now() });
  }

  finish(id, ok) {
    this.active.delete(id);
    if (ok) this.completed += 1;
    else this.failed += 1;
  }

  isActive(id) {
    return this.active.has(id);
  }

  abortAll() {
    let aborted = 0;
    for (const [id, job] of this.active) {
      try {
        job.abortController.abort();
      } catch {
        job.abortController = null;
      }
      aborted += 1;
      this.active.delete(id);
      this.failed += 1;
    }
    return aborted;
  }

  restart() {
    const aborted = this.abortAll();
    this.restarts += 1;
    return { aborted, restarts: this.restarts };
  }

  activeCount() {
    return this.active.size;
  }

  snapshot() {
    return {
      max_concurrent: this.maxConcurrent,
      active: this.active.size,
      completed: this.completed,
      failed: this.failed,
      restarts: this.restarts
    };
  }
}

const state = {
  maintenance: false,
  startedAt: Date.now(),
  cache: new ExtractionCache(),
  jobs: new JobManager(config.maxConcurrent),
  bandwidth: { bytes_served: 0, requests: 0 }
};

module.exports = state;
