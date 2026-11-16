'use strict';

const express = require('express');
const config = require('../config');
const logger = require('../utils/logger');
const state = require('../utils/state');
const history = require('../utils/history');
const { metrics, humanBytes } = require('../utils/system');
const { findYtDlp, findFfmpeg, invalidateBinaryCache } = require('../services/binaries');
const { HttpError } = require('../utils/http');

const router = express.Router();

function authorize(req, res, next) {
  if (!config.adminToken) return next();
  const provided =
    req.headers['x-admin-token'] ||
    (req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, ''));
  if (provided !== config.adminToken) {
    return res.status(401).json({ success: false, error: 'Unauthorized: invalid admin token' });
  }
  return next();
}

router.use(authorize);

async function statsHandler(req, res, next) {
  try {
    const snap = metrics.snapshot();
    const jobs = state.jobs.snapshot();
    const [ytdlp, ffmpeg] = await Promise.all([findYtDlp(), findFfmpeg()]);
    const bandwidthBytes = state.bandwidth.bytes_served;

    res.json({
      success: true,
      total_downloads: history.total(),
      active_jobs: jobs.active,
      storage_used: snap.storage.human,
      storage_bytes: snap.storage.bytes,
      uptime: snap.uptime_seconds,
      system: {
        cpu_percent: snap.cpu_percent,
        ram: snap.ram,
        load_average: snap.load_average,
        platform: snap.platform,
        node_version: snap.node_version
      },
      workers: jobs,
      bandwidth: {
        bytes_served: bandwidthBytes,
        human: humanBytes(bandwidthBytes),
        requests: state.bandwidth.requests
      },
      downloads: {
        by_platform: history.countByPlatform(),
        success_rate: history.successRate(),
        errors_last_hour: logger.countSince(60 * 60 * 1000),
        total_errors: logger.errorCount()
      },
      engines: {
        yt_dlp: ytdlp ? 'available' : 'unavailable',
        ffmpeg: ffmpeg ? 'available' : 'unavailable',
        native_scrapers: ['tiktok', 'instagram', 'youtube']
      },
      cache: { entries: state.cache.size(), ttl_ms: config.cacheTtlMs },
      maintenance: state.maintenance
    });
  } catch (err) {
    next(err);
  }
}

function logsHandler(req, res, next) {
  try {
    const rows = logger.query({
      limit: req.query.limit,
      level: req.query.level || 'all',
      search: req.query.search || ''
    });
    res.json({
      success: true,
      count: rows.length,
      level_filter: req.query.level || 'all',
      logs: rows
    });
  } catch (err) {
    next(err);
  }
}

function downloadsHandler(req, res, next) {
  try {
    const rows = history.list({
      limit: req.query.limit,
      platform: req.query.platform || 'all',
      status: req.query.status || 'all',
      search: req.query.search || ''
    });
    res.json({
      success: true,
      count: rows.length,
      total: history.total(),
      downloads: rows
    });
  } catch (err) {
    next(err);
  }
}

async function controlsHandler(req, res, next) {
  try {
    const body = req.body || {};
    const action = String(body.action || '').toLowerCase();

    switch (action) {
      case 'clear_cache': {
        const cleared = state.cache.clear();
        invalidateBinaryCache();
        logger.info('Extraction cache cleared by administrator', { cleared_entries: cleared });
        return res.json({ success: true, action, message: `Cache cleared (${cleared} entries)` });
      }
      case 'maintenance_on':
      case 'maintenance_off':
      case 'toggle_maintenance': {
        state.maintenance =
          action === 'toggle_maintenance' ? !state.maintenance : action === 'maintenance_on';
        logger.warn(`Maintenance mode ${state.maintenance ? 'ENABLED' : 'DISABLED'} by administrator`);
        return res.json({
          success: true,
          action: 'toggle_maintenance',
          maintenance: state.maintenance,
          message: `Maintenance mode ${state.maintenance ? 'enabled' : 'disabled'}`
        });
      }
      case 'restart_workers': {
        const result = state.jobs.restart();
        logger.warn('Service workers restarted by administrator', result);
        return res.json({
          success: true,
          action,
          message: `Workers restarted, ${result.aborted} active job(s) aborted`,
          workers: state.jobs.snapshot()
        });
      }
      case 'purge_logs': {
        logger.purge();
        return res.json({ success: true, action, message: 'Log store purged' });
      }
      case 'clear_history': {
        const count = history.total();
        history.rows = [];
        history.store.flush(history.rows);
        logger.warn('Download history cleared by administrator', { removed: count });
        return res.json({ success: true, action, message: `Removed ${count} history records` });
      }
      default:
        throw new HttpError(
          400,
          'Unknown control action',
          { allowed: ['clear_cache', 'toggle_maintenance', 'restart_workers', 'purge_logs', 'clear_history'] }
        );
    }
  } catch (err) {
    next(err);
  }
}

function metricsHandler(req, res) {
  res.json({ success: true, metrics: metrics.snapshot() });
}

router.get('/stats', statsHandler);
router.get('/logs', logsHandler);
router.get('/downloads', downloadsHandler);
router.get('/metrics', metricsHandler);
router.post('/controls', controlsHandler);

router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    message: `No admin route matches ${req.method} ${req.originalUrl}`
  });
});

router.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.statusCode : 500;
  logger.error('Admin API error', { path: req.originalUrl, error: err.message });
  res.status(status).json({
    success: false,
    error: err.name === 'HttpError' ? err.message : 'Internal server error',
    ...(err.details ? { details: err.details } : {})
  });
});

module.exports = router;
