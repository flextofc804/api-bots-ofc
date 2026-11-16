'use strict';

const { fetchJson, HttpError } = require('../utils/http');
const { extractYoutubeId } = require('../utils/validators');

const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

const CLIENTS = {
  android: {
    clientName: 'ANDROID',
    clientVersion: '19.09.37',
    androidSdkVersion: 30,
    hl: 'en',
    gl: 'US',
    userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip'
  },
  web: {
    clientName: 'WEB',
    clientVersion: '2.20240401.00.00',
    hl: 'en',
    gl: 'US'
  },
  ios: {
    clientName: 'IOS',
    clientVersion: '19.09.3',
    deviceModel: 'iPhone14,3',
    hl: 'en',
    gl: 'US',
    userAgent: 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 17_4 like Mac OS X)'
  }
};

async function playerRequest(videoId, clientKey) {
  const client = CLIENTS[clientKey];
  const body = {
    context: { client },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true
  };
  return fetchJson(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': client.userAgent || undefined,
      'x-youtube-client-name': clientKey === 'android' ? '3' : clientKey === 'ios' ? '5' : '1',
      'x-youtube-client-version': client.clientVersion
    },
    body: JSON.stringify(body)
  });
}

function parseDurationIso(iso) {
  if (!iso) return 0;
  const match = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function collectFormats(streamingData) {
  const muxed = [];
  const adaptive = [];
  const push = (list, target) => {
    for (const f of list || []) {
      if (!f.url && !f.signatureCipher && !f.s) target.push(f);
    }
  };
  push(streamingData.formats, muxed);
  push(streamingData.adaptiveFormats, adaptive);
  return { muxed, adaptive };
}

function bestMuxed(muxed) {
  const sorted = muxed
    .filter((f) => f.mimeType && f.mimeType.startsWith('video/mp4'))
    .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
  return sorted[0] || muxed.sort((a, b) => (b.height || 0) - (a.height || 0))[0] || null;
}

function bestAudio(adaptive) {
  const audio = adaptive
    .filter((f) => f.mimeType && f.mimeType.startsWith('audio/mp4'))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  return audio[0] || adaptive.filter((f) => f.mimeType && f.mimeType.startsWith('audio/'))[0] || null;
}

function buildQualities(muxed, adaptive) {
  const heights = new Set();
  for (const f of [...muxed, ...adaptive]) {
    if (f.height) heights.add(`${f.height}p`);
  }
  return Array.from(heights).sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
}

async function extract(url, format) {
  const videoId = extractYoutubeId(url);
  if (!videoId) {
    throw new HttpError(422, 'Could not resolve a YouTube video id from the URL');
  }

  let payload = null;
  let usedClient = null;
  let lastError = null;

  for (const clientKey of ['android', 'ios', 'web']) {
    try {
      const data = await playerRequest(videoId, clientKey);
      if (data && data.playabilityStatus && data.playabilityStatus.status === 'OK' && data.streamingData) {
        payload = data;
        usedClient = clientKey;
        break;
      }
      if (data && data.playabilityStatus) {
        lastError = new HttpError(422, `YouTube player status: ${data.playabilityStatus.status}`, {
          reason: data.playabilityStatus.reason || ''
        });
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (!payload) {
    if (lastError) throw lastError;
    throw new HttpError(502, 'YouTube player API returned no usable streaming data');
  }

  const details = payload.videoDetails || {};
  const { muxed, adaptive } = collectFormats(payload.streamingData);

  const title = details.title || 'YouTube video';
  const duration = Number(details.lengthSeconds) || parseDurationIso(payload.microformat?.playerMicroformatRenderer?.lengthPx || '');
  const thumbnail =
    (details.thumbnail && details.thumbnail.thumbnails && details.thumbnail.thumbnails.length
      ? details.thumbnail.thumbnails[details.thumbnail.thumbnails.length - 1].url
      : '') || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  const qualities = buildQualities(muxed, adaptive);

  if (format === 'audio') {
    const audio = bestAudio(adaptive) || bestMuxed(muxed);
    if (!audio || !(audio.url || audio.baseUrl)) {
      throw new HttpError(502, 'No audio stream available for this video');
    }
    return {
      engine: `native-youtube-${usedClient}`,
      id: videoId,
      title,
      duration,
      thumbnail,
      uploader: details.author || '',
      media_url: audio.url || audio.baseUrl,
      itag: audio.itag,
      size_bytes: Number(audio.contentLength) || null,
      qualities,
      ext: 'm4a',
      kind: 'audio',
      mp3_capable: true
    };
  }

  const video = bestMuxed(muxed);
  if (!video || !(video.url || video.baseUrl)) {
    const anyVideo = adaptive.find((f) => f.mimeType && f.mimeType.startsWith('video/'));
    if (!anyVideo || !(anyVideo.url || anyVideo.baseUrl)) {
      throw new HttpError(502, 'No video stream available for this video');
    }
    return {
      engine: `native-youtube-${usedClient}`,
      id: videoId,
      title,
      duration,
      thumbnail,
      uploader: details.author || '',
      media_url: anyVideo.url || anyVideo.baseUrl,
      itag: anyVideo.itag,
      size_bytes: Number(anyVideo.contentLength) || null,
      qualities,
      ext: 'mp4',
      kind: 'video',
      video_only: true
    };
  }

  return {
    engine: `native-youtube-${usedClient}`,
    id: videoId,
    title,
    duration,
    thumbnail,
    uploader: details.author || '',
    media_url: video.url || video.baseUrl,
    itag: video.itag,
    size_bytes: Number(video.contentLength) || null,
    qualities,
    ext: 'mp4',
    kind: 'video'
  };
}

module.exports = { extract, parseDurationIso };
