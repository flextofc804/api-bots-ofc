'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');

module.exports = {
  root: ROOT,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  tmpDir: process.env.TMP_DIR || path.join(ROOT, 'tmp'),
  publicDir: path.join(ROOT, 'public'),

  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 20000),
  headProbeTimeoutMs: Number(process.env.HEAD_PROBE_TIMEOUT_MS || 6000),

  cacheTtlMs: Number(process.env.CACHE_TTL_MS || 10 * 60 * 1000),
  cacheMaxEntries: Number(process.env.CACHE_MAX_ENTRIES || 300),

  maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS || 4),
  logRetention: Number(process.env.LOG_RETENTION || 500),
  downloadHistoryLimit: Number(process.env.DOWNLOAD_HISTORY_LIMIT || 1000),

  adminToken: process.env.ADMIN_TOKEN || '',

  ytdlpPath: process.env.YTDLP_PATH || '',
  ffmpegPath: process.env.FFMPEG_PATH || '',

  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/124.0.0.0 Safari/537.36',

  allowedMediaHosts: [
    'tiktokcdn.com',
    'tiktokcdn-us.com',
    'tiktokcdn-eu.com',
    'tiktokv.com',
    'byteoversea.com',
    'tiktok.com',
    'cdninstagram.com',
    'fbcdn.net',
    'instagram.com',
    'googlevideo.com',
    'ytimg.com',
    'youtube.com'
  ]
};
