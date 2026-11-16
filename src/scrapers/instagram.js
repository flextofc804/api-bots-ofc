'use strict';

const { fetchText, HttpError, safeUrl } = require('../utils/http');
const { extractInstagramCode } = require('../utils/validators');

const APP_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
  'Mobile/15E148 Instagram 322.0.0.22.105 (iPhone13,2; iOS 17_4; en_US; en)';

function unescapeJsonUrl(value) {
  return value
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/\\{/g, '{')
    .replace(/\\}/g, '}')
    .replace(/\\"/g, '"');
}

function normalizeGraphMedia(node) {
  const isVideo = node.is_video || node.video_url || (node.media_type === 2 && node.video_versions);
  let mediaUrl = node.video_url || '';
  let thumbnail = node.thumbnail_src || node.display_url || '';
  let size = null;

  if (!mediaUrl && Array.isArray(node.video_versions) && node.video_versions.length) {
    mediaUrl = node.video_versions[0].url;
    size = node.video_versions[0].width ? null : size;
  }
  if (!mediaUrl && Array.isArray(node.carousel_media) && node.carousel_media.length) {
    const first = normalizeGraphMedia(node.carousel_media[0]);
    mediaUrl = first.media_url;
    thumbnail = thumbnail || first.thumbnail;
  }
  if (!thumbnail && Array.isArray(node.display_resources) && node.display_resources.length) {
    thumbnail = node.display_resources[node.display_resources.length - 1].src;
  }

  return {
    engine: 'native-instagram',
    id: node.id || '',
    title:
      (node.edge_media_to_caption &&
        node.edge_media_to_caption.edges &&
        node.edge_media_to_caption.edges[0] &&
        node.edge_media_to_caption.edges[0].node &&
        node.edge_media_to_caption.edges[0].node.text) ||
      node.caption ||
      'Instagram media',
    duration: Number(node.video_duration) || 0,
    thumbnail,
    uploader: (node.owner && (node.owner.username || '')) || '',
    media_url: mediaUrl,
    is_video: Boolean(isVideo),
    size_bytes: size,
    qualities: ['540p', '720p', '1080p']
  };
}

function findVideoNode(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (node.video_url || (node.is_video && node.video_duration)) return node;
  if (Array.isArray(node.video_versions) && node.video_versions.length) return node;
  for (const key of Object.keys(node)) {
    const found = findVideoNode(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function findImageNode(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (node.display_url || node.display_src) return node;
  for (const key of Object.keys(node)) {
    const found = findImageNode(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

async function scrapeApiEndpoint(code) {
  const endpoint = `https://www.instagram.com/p/${encodeURIComponent(code)}/?__a=1&__d=dis`;
  const data = await fetchText(endpoint, {
    headers: {
      'user-agent': APP_UA,
      accept: 'application/json',
      referer: 'https://www.instagram.com/'
    }
  });
  let json;
  try {
    json = JSON.parse(data);
  } catch {
    throw new HttpError(502, 'Instagram API endpoint returned non-JSON response');
  }
  const node = findVideoNode(json) || findImageNode(json);
  if (!node) throw new HttpError(502, 'Instagram API response contained no media node');
  return normalizeGraphMedia(node);
}

async function scrapeEmbedPage(code) {
  const html = await fetchText(`https://www.instagram.com/p/${encodeURIComponent(code)}/embed/captioned/`, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      referer: 'https://www.instagram.com/'
    }
  });

  const videoMatch =
    html.match(/"video_url":"([^"]+)"/) ||
    html.match(/property="og:video"[^>]+content="([^"]+)"/) ||
    html.match(/<video[^>]+src="([^"]+)"/);
  const imageMatch =
    html.match(/"display_url":"([^"]+)"/) || html.match(/property="og:image"[^>]+content="([^"]+)"/);

  if (!videoMatch && !imageMatch) {
    throw new HttpError(502, `Instagram embed page exposed no media for ${safeUrl(code)}`);
  }

  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  const durationMatch = html.match(/"video_duration":\s*([\d.]+)/);

  return {
    engine: 'native-instagram-embed',
    id: code,
    title: titleMatch ? titleMatch[1].replace(/\s*•\s*Instagram.*$/i, '').trim() || 'Instagram media' : 'Instagram media',
    duration: durationMatch ? Math.round(Number(durationMatch[1])) : 0,
    thumbnail: imageMatch ? unescapeJsonUrl(imageMatch[1]) : '',
    uploader: '',
    media_url: videoMatch ? unescapeJsonUrl(videoMatch[1]) : unescapeJsonUrl(imageMatch[1]),
    is_video: Boolean(videoMatch),
    size_bytes: null,
    qualities: ['540p', '720p', '1080p']
  };
}

async function extract(url, format) {
  const code = extractInstagramCode(url);
  if (!code) {
    throw new HttpError(422, 'Could not resolve an Instagram post/reel shortcode from the URL');
  }

  let media;
  try {
    media = await scrapeApiEndpoint(code);
  } catch (apiErr) {
    try {
      media = await scrapeEmbedPage(code);
    } catch {
      throw apiErr;
    }
  }

  if (format === 'audio' && !media.is_video) {
    throw new HttpError(422, 'Requested audio extraction but this Instagram post contains no video track');
  }

  return {
    ...media,
    media_url: media.media_url,
    ext: media.is_video ? 'mp4' : 'jpg',
    kind: media.is_video ? (format === 'audio' ? 'audio' : 'video') : 'image'
  };
}

module.exports = { extract };
