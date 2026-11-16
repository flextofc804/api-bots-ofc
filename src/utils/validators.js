'use strict';

const { HttpError } = require('./http');

const PLATFORMS = ['tiktok', 'instagram', 'youtube'];

const PATTERNS = {
  tiktok: [
    /https?:\/\/(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\//i,
    /https?:\/\/tiktok\.com\//i
  ],
  instagram: [
    /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+/i,
    /https?:\/\/(?:www\.)?instagram\.com\//i,
    /https?:\/\/instagr\.am\//i
  ],
  youtube: [
    /https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/|v\/)/i,
    /https?:\/\/youtu\.be\/[A-Za-z0-9_-]+/i
  ]
};

function detectPlatform(url) {
  for (const platform of PLATFORMS) {
    for (const pattern of PATTERNS[platform]) {
      if (pattern.test(url)) return platform;
    }
  }
  return null;
}

function validateProcessPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object');
  }

  const { url } = body;
  if (typeof url !== 'string' || !url.trim()) {
    throw new HttpError(400, 'Field "url" is required and must be a non-empty string');
  }

  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new HttpError(400, 'Field "url" must be a valid absolute http(s) URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(400, 'Only http and https URLs are supported');
  }

  const platformInput = body.platform === undefined || body.platform === '' ? 'auto' : String(body.platform).toLowerCase();
  if (!['auto', ...PLATFORMS].includes(platformInput)) {
    throw new HttpError(400, `Field "platform" must be one of: auto, ${PLATFORMS.join(', ')}`);
  }

  const formatInput = body.format === undefined || body.format === '' ? 'video' : String(body.format).toLowerCase();
  if (!['video', 'audio'].includes(formatInput)) {
    throw new HttpError(400, 'Field "format" must be either "video" or "audio"');
  }

  let platform = platformInput;
  if (platform === 'auto') {
    platform = detectPlatform(parsed.href);
    if (!platform) {
      throw new HttpError(
        422,
        'Could not detect platform from URL. Supported: TikTok, Instagram, YouTube',
        { url: parsed.href }
      );
    }
  } else if (!detectPlatform(parsed.href)) {
    throw new HttpError(422, `URL does not match the declared platform "${platform}"`, {
      url: parsed.href,
      platform
    });
  }

  return { url: parsed.href, platform, format: formatInput };
}

function extractYoutubeId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.split('/').filter(Boolean)[0] || null;
    }
    if (parsed.pathname === '/watch') {
      return parsed.searchParams.get('v') || null;
    }
    const match = parsed.pathname.match(/\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function extractInstagramCode(url) {
  const match = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : null;
}

function extractTikTokId(url) {
  const match = url.match(/\/video\/(\d+)/);
  if (match) return match[1];
  const photo = url.match(/\/photo\/(\d+)/);
  return photo ? photo[1] : null;
}

module.exports = {
  PLATFORMS,
  detectPlatform,
  validateProcessPayload,
  extractYoutubeId,
  extractInstagramCode,
  extractTikTokId
};
