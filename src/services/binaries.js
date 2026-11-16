'use strict';

const { spawn } = require('child_process');
const config = require('../config');

let binaryCache = null;

function tryRun(command, args, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    try {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.on('error', () => done(null));
      child.on('close', (code) => done(code === 0 ? stdout.trim() : null));
      setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
          done(null);
        }
      }, timeoutMs);
    } catch {
      done(null);
    }
  });
}

async function findYtDlp() {
  if (binaryCache && binaryCache.ytdlp !== undefined) return binaryCache.ytdlp;
  const candidates = [
    config.ytdlpPath,
    process.env.YTDLP_PATH,
    'yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp'
  ].filter(Boolean);
  for (const candidate of candidates) {
    const version = await tryRun(candidate, ['--version']);
    if (version) {
      binaryCache = { ...(binaryCache || {}), ytdlp: candidate, ytdlpVersion: version };
      return candidate;
    }
  }
  binaryCache = { ...(binaryCache || {}), ytdlp: null };
  return null;
}

async function findFfmpeg() {
  if (binaryCache && binaryCache.ffmpeg !== undefined) return binaryCache.ffmpeg;
  const candidates = [config.ffmpegPath, process.env.FFMPEG_PATH, 'ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].filter(
    Boolean
  );
  for (const candidate of candidates) {
    const version = await tryRun(candidate, ['-version']);
    if (version && version.startsWith('ffmpeg')) {
      binaryCache = { ...(binaryCache || {}), ffmpeg: candidate };
      return candidate;
    }
  }
  binaryCache = { ...(binaryCache || {}), ffmpeg: null };
  return null;
}

function invalidateBinaryCache() {
  binaryCache = null;
}

async function ytdlpDumpJson(url, timeoutMs = 25000) {
  const binary = await findYtDlp();
  if (!binary) return null;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    try {
      const child = spawn(binary, ['--dump-single-json', '--no-warnings', '--no-playlist', url], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', () => finish(null));
      child.on('close', (code) => {
        if (code !== 0 || !stdout) {
          finish(null);
          return;
        }
        try {
          finish(JSON.parse(stdout));
        } catch {
          finish(null);
        }
      });
      setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
          finish(null);
        }
      }, timeoutMs);
    } catch {
      finish(null);
    }
  });
}

function pickFromYtDlpInfo(info, format) {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const usable = formats.filter((f) => f.url && !f.protocol?.startsWith('m3u8'));

  if (format === 'audio') {
    const audioOnly = usable
      .filter((f) => (f.acodec && f.acodec !== 'none') && (!f.vcodec || f.vcodec === 'none'))
      .sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));
    const best = audioOnly[0] || usable.sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0];
    return best ? { url: best.url, ext: best.ext || 'm4a', size: best.filesize || best.filesize_approx || null } : null;
  }

  const muxed = usable
    .filter((f) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none')
    .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0));
  const best = muxed[0] || usable.sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0))[0];
  return best ? { url: best.url, ext: best.ext || 'mp4', size: best.filesize || best.filesize_approx || null } : null;
}

async function ytdlpExtract(url, format) {
  const info = await ytdlpDumpJson(url);
  if (!info) return null;

  const picked = pickFromYtDlpInfo(info, format);
  if (!picked) return null;

  return {
    engine: 'yt-dlp',
    title: info.title || info.id || 'Untitled',
    duration: Number(info.duration) || 0,
    thumbnail: info.thumbnail || (Array.isArray(info.thumbnails) ? info.thumbnails[info.thumbnails.length - 1]?.url : '') || '',
    uploader: info.uploader || info.channel || '',
    media_url: picked.url,
    ext: picked.ext,
    size_bytes: picked.size,
    qualities: Array.from(
      new Set(
        (info.formats || [])
          .filter((f) => f.height)
          .map((f) => `${f.height}p`)
      )
    ).sort((a, b) => parseInt(b, 10) - parseInt(a, 10))
  };
}

module.exports = { findYtDlp, findFfmpeg, invalidateBinaryCache, ytdlpExtract, ytdlpDumpJson };
