'use strict';

const express = require('express');
const crypto = require('crypto');
const { spawn } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');
const state = require('../utils/state');
const history = require('../utils/history');
const { HttpError, fetchWithTimeout, safeUrl } = require('../utils/http');
const { validateProcessPayload } = require('../utils/validators');
const { runExtraction } = require('../scrapers');
const { findFfmpeg, findYtDlp } = require('../services/binaries');

const router = express.Router();

function isMediaHostAllowed(hostname) {
  const host = String(hostname).toLowerCase();
  return config.allowedMediaHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function encodeTarget(url) {
  return Buffer.from(url, 'utf8').toString('base64url');
}

function decodeTarget(token) {
  try {
    return Buffer.from(String(token), 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

async function processHandler(req, res, next) {
  const jobId = crypto.randomUUID();

  try {
    const payload = validateProcessPayload(req.body);

    if (state.jobs.activeCount() >= config.maxConcurrentJobs) {
      throw new HttpError(429, 'Server is at maximum extraction capacity, retry shortly', {
        active_jobs: state.jobs.activeCount(),
        max_concurrent: config.maxConcurrentJobs
      });
    }

    state.jobs.start(jobId, new AbortController());
    history.add({
      id: jobId,
      ts: new Date().toISOString(),
      url: payload.url,
      platform: payload.platform,
      format: payload.format,
      status: 'processing',
      title: '',
      engine: '',
      file_size: '0 B',
      bytes_served: 0
    });

    try {
      const result = await runExtraction(payload);

      const downloadUrl =
        `/api/v1/download?u=${encodeTarget(result.media_url)}` +
        `&name=${encodeURIComponent(`${result.title.slice(0, 80)}.${result.ext}`)}` +
        (payload.format === 'audio' && result.mp3_capable && result.ext !== 'mp3' ? '&convert=mp3' : '');

      const response = {
        success: true,
        job_id: jobId,
        platform: result.platform,
        format: result.format,
        engine: result.engine,
        title: result.title,
        duration: result.duration,
        thumbnail: result.thumbnail,
        uploader: result.uploader,
        download_url: downloadUrl,
        file_size: result.size_human,
        size_bytes: result.size_bytes,
        ext: result.ext,
        qualities: result.qualities,
        cached: Boolean(result.cached),
        extracted_at: result.extracted_at
      };

      history.update(jobId, {
        status: 'success',
        title: result.title,
        engine: result.engine,
        file_size: result.size_human,
        size_bytes: result.size_bytes || 0
      });
      state.jobs.finish(jobId, true);
      return res.status(200).json(response);
    } catch (err) {
      state.jobs.finish(jobId, false);
      history.update(jobId, {
        status: 'failed',
        title: 'Extraction failed',
        error: err.message
      });
      throw err;
    }
  } catch (err) {
    if (!(err instanceof HttpError)) {
      logger.error('Unexpected error in /process', { error: err.message, stack: err.stack });
    }
    next(err);
  }
}

async function downloadHandler(req, res, next) {
  try {
    const target = decodeTarget(req.query.u || '');
    if (!target) throw new HttpError(400, 'Missing or invalid "u" download token');

    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      throw new HttpError(400, 'Download token does not encode a valid URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new HttpError(400, 'Unsupported media protocol');
    }
    if (!isMediaHostAllowed(parsed.hostname)) {
      throw new HttpError(403, 'Media host is not on the allowlist', { host: parsed.hostname });
    }

    const convert = String(req.query.convert || '').toLowerCase() === 'mp3';
    const rawName = String(req.query.name || 'media.mp4').slice(0, 120);
    const safeName = rawName.replace(/[^A-Za-z0-9._ ()-]/g, '_');
    const fileName = convert ? safeName.replace(/\.[a-z0-9]+$/i, '') + '.mp3' : safeName;

    const range = req.headers.range;
    const upstream = await fetchWithTimeout(target, {
      headers: {
        referer: parsed.origin,
        ...(range ? { range } : {})
      }
    });

    if (!upstream.ok && upstream.status !== 206) {
      throw new HttpError(502, `Upstream media host responded with HTTP ${upstream.status}`);
    }

    const headers = {
      'content-type': convert ? 'audio/mpeg' : upstream.headers.get('content-type') || 'application/octet-stream',
      'content-disposition': `attachment; filename="${fileName}"`,
      'accept-ranges': 'bytes',
      'cache-control': 'no-store'
    };
    const contentLength = upstream.headers.get('content-length');
    if (contentLength && !convert) headers['content-length'] = contentLength;
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) headers['content-range'] = contentRange;

    res.status(upstream.status === 206 ? 206 : 200);
    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

    let bytes = 0;
    upstream.body.on('data', (chunk) => {
      bytes += chunk.length;
      state.bandwidth.bytes_served += chunk.length;
    });
    upstream.body.on('end', () => {
      state.bandwidth.requests += 1;
      logger.info('Media stream completed', { host: parsed.hostname, bytes });
    });

    if (convert) {
      const ffmpeg = await findFfmpeg();
      if (!ffmpeg) {
        logger.warn('MP3 conversion requested but ffmpeg is not installed; streaming original audio');
        upstream.body.pipe(res);
        return;
      }
      const child = spawn(ffmpeg, [
        '-hide_banner',
        '-loglevel', 'error',
        '-i', 'pipe:0',
        '-vn',
        '-acodec', 'libmp3lame',
        '-b:a', '192k',
        '-f', 'mp3',
        'pipe:1'
      ]);
      upstream.body.pipe(child.stdin);
      child.stdout.pipe(res);
      child.stderr.on('data', (d) => logger.warn('ffmpeg stderr', { message: d.toString().slice(0, 300) }));
      child.on('error', (err) => {
        logger.error('ffmpeg spawn failed', { error: err.message });
        if (!res.headersSent) next(new HttpError(500, 'Local MP3 conversion failed'));
        else res.end();
      });
      child.on('close', (code) => {
        if (code !== 0 && !res.writableEnded) res.end();
      });
      req.on('close', () => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* noop */
        }
      });
      return;
    }

    upstream.body.pipe(res);
    upstream.body.on('error', () => {
      if (!res.headersSent) next(new HttpError(502, 'Upstream media stream failed'));
      else res.end();
    });
  } catch (err) {
    next(err);
  }
}

async function healthHandler(req, res) {
  const [ytdlp, ffmpeg] = await Promise.all([findYtDlp(), findFfmpeg()]);
  res.json({
    success: true,
    status: state.maintenance ? 'maintenance' : 'ok',
    uptime_seconds: Math.floor((Date.now() - state.startedAt) / 1000),
    engines: {
      yt_dlp: ytdlp ? 'available' : 'not installed (native scrapers active)',
      ffmpeg: ffmpeg ? 'available' : 'not installed (passthrough audio)'
    },
    cache_entries: state.cache.size(),
    active_jobs: state.jobs.activeCount()
  });
}

router.post('/process', processHandler);
router.get('/download', downloadHandler);
router.get('/health', healthHandler);

router.use((err, req, res, next) => {
  const status = err instanceof HttpError ? err.statusCode : 500;
  if (status >= 500) {
    logger.error('API error', { path: req.originalUrl, error: err.message });
  }
  res.status(status).json({
    success: false,
    error: err.name === 'HttpError' ? err.message : 'Internal server error',
    ...(err.details ? { details: err.details } : {}),
    ...(status >= 500 ? { hint: 'Inspect GET /api/v1/admin/logs for the full error trace' } : {})
  });
});

module.exports = router;
