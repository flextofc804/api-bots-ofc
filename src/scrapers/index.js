'use strict';

const config = require('../config');
const logger = require('../utils/logger');
const state = require('../utils/state');
const { HttpError, probeFileSize, humanBytes } = require('../utils/http');
const { findYtDlp, findFfmpeg, ytdlpExtract } = require('../services/binaries');

const nativeScrapers = {
  tiktok: require('./tiktok'),
  instagram: require('./instagram'),
  youtube: require('./youtube')
};

function cacheKey(url, format) {
  return `${url}::${format}`;
}

async function probeSize(mediaUrl) {
  if (!mediaUrl) return null;
  return probeFileSize(mediaUrl);
}

async function runExtraction({ url, platform, format }, useCache = true) {
  const key = cacheKey(url, format);

  if (useCache) {
    const cached = state.cache.get(key);
    if (cached) {
      logger.debug('Cache hit for extraction', { url, platform, format });
      return { ...cached, cached: true };
    }
  }

  const engines = [];
  engines.push({
    name: 'yt-dlp',
    run: async () => {
      const binary = await findYtDlp();
      if (!binary) return null;
      return ytdlpExtract(url, format);
    }
  });
  engines.push({
    name: `native-${platform}`,
    run: () => nativeScrapers[platform].extract(url, format)
  });

  let lastError = null;
  for (const engine of engines) {
    try {
      const result = await engine.run();
      if (!result) continue;
      if (!result.media_url) {
        lastError = new HttpError(502, `${engine.name} could not resolve a media stream for this URL`);
        continue;
      }

      let sizeBytes = result.size_bytes || null;
      if (!sizeBytes) {
        sizeBytes = await probeSize(result.media_url);
      }

      const payload = {
        engine: result.engine || engine.name,
        platform,
        format,
        title: result.title || 'Untitled',
        duration: Number(result.duration) || 0,
        thumbnail: result.thumbnail || '',
        uploader: result.uploader || '',
        media_url: result.media_url,
        ext: result.ext || (format === 'audio' ? 'm4a' : 'mp4'),
        kind: result.kind || format,
        size_bytes: sizeBytes,
        size_human: humanBytes(sizeBytes || 0),
        qualities: result.qualities || [],
        mp3_capable: Boolean(result.mp3_capable) || (await findFfmpeg()) !== null,
        video_only: Boolean(result.video_only),
        extracted_at: new Date().toISOString()
      };

      if (useCache) state.cache.set(key, payload);
      logger.info('Extraction succeeded', { engine: payload.engine, platform, format, title: payload.title });
      return payload;
    } catch (err) {
      lastError = err;
      logger.warn(`${engine.name} extraction failed`, {
        url,
        error: err.message
      });
    }
  }

  if (lastError instanceof HttpError) throw lastError;
  throw new HttpError(502, 'All extraction engines failed for this URL', {
    reason: lastError ? lastError.message : 'unknown'
  });
}

module.exports = { runExtraction, cacheKey };
