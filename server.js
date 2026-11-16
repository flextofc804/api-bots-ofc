'use strict';

const express = require('express');
const path = require('path');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const state = require('./src/utils/state');
const { findYtDlp, findFfmpeg } = require('./src/services/binaries');
const apiRoutes = require('./src/routes/api');
const adminRoutes = require('./src/routes/admin');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', true);

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

app.use((req, res, next) => {
  const isInternal =
    req.path.startsWith('/api/v1/admin') ||
    req.path === '/api/v1/health' ||
    !req.path.startsWith('/api/');
  if (state.maintenance && !isInternal) {
    return res.status(503).json({
      success: false,
      error: 'Service under maintenance',
      maintenance: true,
      retry_after_seconds: 30
    });
  }
  return next();
});

app.use(
  (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      if (req.path.startsWith('/api/')) {
        logger.debug('Request completed', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration_ms: Math.round(ms * 10) / 10
        });
      }
    });
    next();
  }
);

app.use(express.static(config.publicDir, { index: 'index.html', maxAge: '1h' }));

app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1', apiRoutes);

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, error: 'Not found', path: req.path });
  }
  return res.status(404).sendFile(path.join(config.publicDir, 'index.html'));
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Invalid JSON body', details: err.message });
  }
  logger.error('Unhandled server error', { error: err ? err.message : 'unknown', path: req.path });
  return res.status(500).json({ success: false, error: 'Internal server error' });
});

async function start() {
  const [ytdlp, ffmpeg] = await Promise.all([findYtDlp(), findFfmpeg()]);

  const server = app.listen(config.port, config.host, () => {
    logger.info('MediaHub API started', {
      port: config.port,
      host: config.host,
      node: process.version,
      yt_dlp: ytdlp || 'not found - native scrapers active',
      ffmpeg: ffmpeg || 'not found - audio passthrough mode',
      admin_token: config.adminToken ? 'enabled' : 'disabled'
    });
    console.log('');
    console.log('  ┌─────────────────────────────────────────────────┐');
    console.log('  │  MediaHub API & Admin Panel                     │');
    console.log(`  │  Dashboard : http://localhost:${config.port}/       │`);
    console.log(`  │  API       : http://localhost:${config.port}/api/v1 │`);
    console.log('  │  Engines   : yt-dlp + native scrapers           │');
    console.log('  └─────────────────────────────────────────────────┘');
    console.log('');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${config.port} is already in use. Set PORT to another value.`);
    } else {
      logger.error('Server error', { error: err.message });
    }
    process.exit(1);
  });

  const shutdown = (signal) => {
    logger.warn(`${signal} received, shutting down gracefully`);
    state.jobs.abortAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
