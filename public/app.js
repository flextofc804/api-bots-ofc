'use strict';

const $ = (sel) => document.querySelector(sel);
const API = '/api/v1';

const el = {
  statusDot: $('#status-dot'),
  apiStatus: $('#api-status'),
  maintenanceBadge: $('#maintenance-badge'),
  uptime: $('#uptime'),
  total: $('#stat-total'),
  success: $('#stat-success'),
  active: $('#stat-active'),
  capacity: $('#stat-capacity'),
  storage: $('#stat-storage'),
  bandwidth: $('#stat-bandwidth'),
  cpu: $('#stat-cpu'),
  cpuBar: $('#cpu-bar'),
  cpuBar2: $('#cpu-bar2'),
  cpuLabel: $('#cpu-label'),
  ramBar: $('#ram-bar'),
  ramLabel: $('#ram-label'),
  ramDetail: $('#ram-detail'),
  loadDetail: $('#load-detail'),
  pTiktok: $('#p-tiktok'),
  pInstagram: $('#p-instagram'),
  pYoutube: $('#p-youtube'),
  engineYtdlp: $('#engine-ytdlp'),
  engineFfmpeg: $('#engine-ffmpeg'),
  engineCache: $('#engine-cache'),
  downloadsBody: $('#downloads-body'),
  dlCount: $('#dl-count'),
  logsBody: $('#logs-body'),
  search: $('#search'),
  filterPlatform: $('#filter-platform'),
  filterStatus: $('#filter-status'),
  logLevel: $('#log-level'),
  nodeVer: $('#node-ver'),
  toast: $('#toast'),
  testUrl: $('#test-url'),
  testFormat: $('#test-format'),
  testRun: $('#test-run'),
  testOutput: $('#test-output')
};

function fmtUptime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso || '—';
  }
}

function showToast(message, type = 'info') {
  const colors = {
    info: 'border-accent/40 text-accent',
    success: 'border-emerald-500/40 text-emerald-300',
    error: 'border-rose-500/40 text-rose-300',
    warn: 'border-amber-500/40 text-amber-300'
  };
  el.toast.className = `fixed bottom-5 right-5 z-50 max-w-xs rounded-xl border bg-panel px-4 py-3 text-xs shadow-2xl ${colors[type] || colors.info}`;
  el.toast.textContent = message;
  el.toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.toast.classList.add('hidden'), 3500);
}

async function api(path, options) {
  const res = await fetch(`${API}${path}`, options);
  const data = await res.json().catch(() => ({ success: false, error: 'Invalid JSON response' }));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function platformBadge(platform) {
  const map = {
    tiktok: ['bg-pink-500/10 text-pink-300 border-pink-500/30', 'Music2'],
    instagram: ['bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30', 'Instagram'],
    youtube: ['bg-red-500/10 text-red-300 border-red-500/30', 'Youtube']
  };
  const [cls] = map[platform] || ['bg-slate-500/10 text-slate-300 border-slate-500/30', 'Globe'];
  return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${cls}">${platform}</span>`;
}

function statusBadge(status) {
  const map = {
    success: ['bg-emerald-500/10 text-emerald-300 border-emerald-500/30', 'check-circle'],
    failed: ['bg-rose-500/10 text-rose-300 border-rose-500/30', 'x-circle'],
    processing: ['bg-amber-500/10 text-amber-300 border-amber-500/30', 'loader']
  };
  const [cls, icon] = map[status] || map.processing;
  return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${cls}">${status}</span>`;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value == null ? '' : value);
  return div.innerHTML;
}

async function refreshStats() {
  try {
    const data = await api('/admin/stats');
    const s = data;

    el.total.textContent = s.total_downloads.toLocaleString();
    el.success.textContent = `${s.downloads.success_rate}%`;
    el.active.textContent = s.active_jobs;
    el.capacity.textContent = s.workers.max_concurrent;
    el.storage.textContent = s.storage_used;
    el.bandwidth.textContent = s.bandwidth.human;
    el.uptime.textContent = fmtUptime(s.uptime);

    const cpu = s.system.cpu_percent || 0;
    el.cpu.textContent = `${cpu}%`;
    el.cpuBar.style.width = `${Math.min(cpu, 100)}%`;
    el.cpuBar2.style.width = `${Math.min(cpu, 100)}%`;
    el.cpuLabel.textContent = `${cpu}%`;

    const ram = s.system.ram;
    el.ramBar.style.width = `${ram.percent}%`;
    el.ramLabel.textContent = `${ram.percent}%`;
    el.ramDetail.textContent = `${ram.used_human} / ${ram.total_human}`;
    el.loadDetail.textContent = `load: ${s.system.load_average.join(' · ')}`;

    el.pTiktok.textContent = s.downloads.by_platform.tiktok || 0;
    el.pInstagram.textContent = s.downloads.by_platform.instagram || 0;
    el.pYoutube.textContent = s.downloads.by_platform.youtube || 0;

    el.engineYtdlp.textContent = s.engines.yt_dlp;
    el.engineYtdlp.className = s.engines.yt_dlp === 'available' ? 'text-emerald-400' : 'text-amber-400';
    el.engineFfmpeg.textContent = s.engines.ffmpeg;
    el.engineFfmpeg.className = s.engines.ffmpeg === 'available' ? 'text-emerald-400' : 'text-amber-400';
    el.engineCache.textContent = s.cache.entries;
    el.nodeVer.textContent = s.system.node_version;

    el.maintenanceBadge.classList.toggle('hidden', !s.maintenance);
    el.maintenanceBadge.classList.toggle('flex', Boolean(s.maintenance));
    el.statusDot.className = s.maintenance
      ? 'h-1.5 w-1.5 rounded-full bg-amber-400 pulse-dot'
      : 'h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot';
    el.apiStatus.textContent = s.maintenance ? 'MAINTENANCE' : 'ONLINE';
  } catch (err) {
    el.apiStatus.textContent = 'OFFLINE';
    el.statusDot.className = 'h-1.5 w-1.5 rounded-full bg-rose-500 pulse-dot';
  }
}

async function refreshDownloads() {
  try {
    const params = new URLSearchParams({
      limit: '50',
      platform: el.filterPlatform.value,
      status: el.filterStatus.value,
      search: el.search.value.trim()
    });
    const data = await api(`/admin/downloads?${params}`);
    el.dlCount.textContent = `${data.count} of ${data.total} records`;
    if (!data.downloads.length) {
      el.downloadsBody.innerHTML = `<tr><td colspan="8" class="px-5 py-8 text-center text-slate-600">No download activity yet — run an extraction above.</td></tr>`;
      return;
    }
    el.downloadsBody.innerHTML = data.downloads
      .map(
        (row) => `
      <tr class="hover:bg-edge/30 transition-colors">
        <td class="px-5 py-2.5 text-slate-500 font-mono whitespace-nowrap">${fmtTime(row.ts)}</td>
        <td class="px-3 py-2.5 max-w-[220px] truncate text-slate-200" title="${escapeHtml(row.url)}">${escapeHtml(row.title || row.url)}</td>
        <td class="px-3 py-2.5">${platformBadge(row.platform)}</td>
        <td class="px-3 py-2.5 text-slate-400 uppercase">${escapeHtml(row.format)}</td>
        <td class="px-3 py-2.5 text-slate-500 font-mono text-[10px]">${escapeHtml(row.engine || '—')}</td>
        <td class="px-3 py-2.5 text-slate-400 font-mono">${escapeHtml(row.file_size || '—')}</td>
        <td class="px-3 py-2.5">${statusBadge(row.status)}</td>
        <td class="px-5 py-2.5 text-right">
          ${
            row.status === 'success'
              ? `<a href="${API}/process" onclick="return false" title="Re-run not available" class="hidden"></a>
                 <button class="text-slate-500 hover:text-accent transition-colors" title="Copy source URL" onclick="navigator.clipboard.writeText('${escapeHtml(row.url)}'); showToast('URL copied','success')"><i data-lucide="copy" class="h-3.5 w-3.5 inline"></i></button>`
              : `<span class="text-slate-600" title="${escapeHtml(row.error || '')}">—</span>`
          }
        </td>
      </tr>`
      )
      .join('');
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    el.downloadsBody.innerHTML = `<tr><td colspan="8" class="px-5 py-6 text-center text-rose-400">Failed to load downloads: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function refreshLogs() {
  try {
    const params = new URLSearchParams({ limit: '80', level: el.logLevel.value });
    const data = await api(`/admin/logs?${params}`);
    if (!data.logs.length) {
      el.logsBody.innerHTML = `<p class="text-slate-600 text-center py-6">No log entries.</p>`;
      return;
    }
    const colors = { info: 'text-sky-300', warn: 'text-amber-300', error: 'text-rose-400', debug: 'text-slate-500' };
    el.logsBody.innerHTML = data.logs
      .map((log) => {
        const meta = log.meta && Object.keys(log.meta).length ? JSON.stringify(log.meta) : '';
        return `<p class="flex gap-2 leading-relaxed">
          <span class="text-slate-600 shrink-0">${fmtTime(log.ts)}</span>
          <span class="${colors[log.level] || 'text-slate-400'} shrink-0 w-12 uppercase">${log.level}</span>
          <span class="text-slate-300">${escapeHtml(log.message)}</span>
          ${meta ? `<span class="text-slate-600 truncate">${escapeHtml(meta)}</span>` : ''}
        </p>`;
      })
      .join('');
  } catch (err) {
    el.logsBody.innerHTML = `<p class="text-rose-400 text-center py-4">Failed to load logs: ${escapeHtml(err.message)}</p>`;
  }
}

document.querySelectorAll('.ctrl-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.style.opacity = '0.6';
    try {
      const data = await api('/admin/controls', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: btn.dataset.action })
      });
      showToast(data.message || 'Control executed', 'success');
      await Promise.all([refreshStats(), refreshLogs()]);
    } catch (err) {
      showToast(`Control failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  });
});

el.testRun.addEventListener('click', async () => {
  const url = el.testUrl.value.trim();
  if (!url) {
    showToast('Paste a TikTok / Instagram / YouTube URL first', 'warn');
    return;
  }
  el.testRun.disabled = true;
  el.testRun.innerHTML = 'Extracting…';
  el.testOutput.classList.remove('hidden');
  el.testOutput.textContent = 'Contacting extraction engines…';
  try {
    const data = await api('/process', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, platform: 'auto', format: el.testFormat.value })
    });
    el.testOutput.textContent = JSON.stringify(data, null, 2);
    showToast(`Extracted via ${data.engine}`, 'success');
    await Promise.all([refreshStats(), refreshDownloads(), refreshLogs()]);
  } catch (err) {
    el.testOutput.textContent = JSON.stringify({ success: false, error: err.message }, null, 2);
    showToast(`Extraction failed: ${err.message}`, 'error');
    await refreshLogs();
  } finally {
    el.testRun.disabled = false;
    el.testRun.innerHTML = '<i data-lucide="play" class="h-3.5 w-3.5"></i> Extract';
    if (window.lucide) lucide.createIcons();
  }
});

let searchTimer = null;
el.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(refreshDownloads, 300);
});
el.filterPlatform.addEventListener('change', refreshDownloads);
el.filterStatus.addEventListener('change', refreshDownloads);
el.logLevel.addEventListener('change', refreshLogs);

refreshStats();
refreshDownloads();
refreshLogs();
setInterval(refreshStats, 2000);
setInterval(refreshDownloads, 4000);
setInterval(refreshLogs, 5000);
