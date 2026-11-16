'use strict';

const { fetchText, fetchJson, HttpError } = require('../utils/http');
const { extractTikTokId } = require('../utils/validators');

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
  'Version/17.4 Mobile/15E148 Safari/604.1';

function stripWatermark(url) {
  if (!url) return url;
  return url.replace('/playwm/', '/play/').replace('watermark=1', 'watermark=0');
}

function findItemStruct(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (node.itemStruct && typeof node.itemStruct === 'object') return node.itemStruct;
  if (node.itemInfo && node.itemInfo.itemStruct) return node.itemInfo.itemStruct;
  for (const key of Object.keys(node)) {
    const found = findItemStruct(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizeItem(item) {
  const video = item.video || {};
  const music = item.music || {};
  const author = item.author || {};
  const playUrl = video.playAddr || video.downloadAddr || video.playAPI || '';
  const downloadUrl = video.downloadAddr || stripWatermark(playUrl);
  return {
    engine: 'native-tiktok',
    id: item.id || '',
    title: (item.desc || music.title || 'TikTok video').slice(0, 300),
    duration: Number(video.duration) || 0,
    thumbnail: video.cover || video.dynamicCover || video.originCover || '',
    uploader: author.uniqueId || author.nickname || '',
    media_url: downloadUrl || playUrl,
    media_url_watermarked: playUrl,
    audio_url: music.playUrl || '',
    size_bytes: Number(video.size) || null,
    qualities: ['540p', '720p', '1080p']
  };
}

async function scrapeWebPage(url) {
  const html = await fetchText(url, {
    headers: {
      'user-agent': MOBILE_UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      referer: 'https://www.tiktok.com/'
    }
  });

  const universalMatch = html.match(
    /<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (universalMatch) {
    try {
      const data = JSON.parse(universalMatch[1]);
      const item = findItemStruct(data);
      if (item && (item.video || item.music)) return normalizeItem(item);
    } catch {
      /* fall through to SIGI_STATE */
    }
  }

  const sigiMatch = html.match(/<script[^>]+id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
  if (sigiMatch) {
    try {
      const data = JSON.parse(sigiMatch[1]);
      const modules = data.ItemModule || {};
      const first = Object.values(modules)[0];
      if (first) return normalizeItem(first);
    } catch {
      /* fall through */
    }
  }

  const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/);
  const ogImage = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]*)"/);
  if (ogTitle) {
    return {
      engine: 'native-tiktok-og',
      id: extractTikTokId(url) || '',
      title: ogTitle[1].replace(/&quot;/g, '"').slice(0, 300),
      duration: 0,
      thumbnail: ogImage ? ogImage[1] : '',
      uploader: '',
      media_url: '',
      size_bytes: null,
      needs_followup: true
    };
  }

  throw new HttpError(502, 'TikTok page did not contain extractable video metadata');
}

async function scrapeItemApi(itemId) {
  const endpoint =
    'https://www.tiktok.com/api/item/detail/?itemId=' +
    encodeURIComponent(itemId) +
    '&aid=1988&app_language=en&app_name=tiktok_web&browser_language=en-US' +
    '&browser_name=Mozilla&browser_platform=Win32&channel=tiktok_web&device_platform=web_pc';

  const data = await fetchJson(endpoint, {
    headers: { referer: 'https://www.tiktok.com/', 'user-agent': MOBILE_UA }
  });
  const item = data && data.itemInfo && data.itemInfo.itemStruct;
  if (!item) throw new HttpError(502, 'TikTok item API returned no media for this id');
  return normalizeItem(item);
}

async function resolveShortLink(url) {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'user-agent': MOBILE_UA }
    });
    if (res.url && res.url !== url) return res.url;
  } catch {
    return url;
  }
  return url;
}

async function extract(url, format) {
  let target = url;
  if (/\/\/(?:vm|vt)\.tiktok\.com\//i.test(target)) {
    target = await resolveShortLink(target);
  }

  let media = null;
  try {
    media = await scrapeWebPage(target);
  } catch (err) {
    const itemId = extractTikTokId(target);
    if (itemId) {
      media = await scrapeItemApi(itemId);
    } else {
      throw err;
    }
  }

  if (format === 'audio') {
    const audioUrl = media.audio_url || media.media_url;
    return {
      ...media,
      media_url: audioUrl,
      ext: media.audio_url ? 'mp3' : 'mp4',
      kind: 'audio'
    };
  }

  return { ...media, ext: 'mp4', kind: 'video' };
}

module.exports = { extract, stripWatermark };
