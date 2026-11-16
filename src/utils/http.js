'use strict';

const config = require('../config');

class HttpError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = config.requestTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...options,
      signal: controller.signal,
      headers: {
        'user-agent': config.userAgent,
        'accept-language': 'en-US,en;q=0.9',
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, options = {}, timeoutMs) {
  const res = await fetchWithTimeout(url, options, timeoutMs);
  if (!res.ok) {
    throw new HttpError(502, `Upstream responded with HTTP ${res.status} for ${safeUrl(url)}`);
  }
  return res.text();
}

async function fetchJson(url, options = {}, timeoutMs) {
  const text = await fetchText(url, options, timeoutMs);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, `Upstream returned invalid JSON for ${safeUrl(url)}`);
  }
}

async function probeFileSize(url, timeoutMs = config.headProbeTimeoutMs) {
  try {
    const res = await fetchWithTimeout(url, { method: 'HEAD' }, timeoutMs);
    const length = res.headers.get('content-length');
    if (res.ok && length) return Number(length) || null;
  } catch {
    return null;
  }
  return null;
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return '[invalid url]';
  }
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${Math.round(value * 10) / 10} ${units[i]}`;
}

module.exports = { HttpError, fetchWithTimeout, fetchText, fetchJson, probeFileSize, safeUrl, humanBytes };
