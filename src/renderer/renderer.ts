// Types mirrored from main process (no import — renderer compiles as plain script)
interface StreamInfo {
  url: string;
  type: 'hls' | 'dash' | 'mp4' | 'webm' | 'unknown-video';
  source: 'network' | 'page-source';
  timestamp: number;
  pageUrl: string;
}

interface AppSettings {
  downloadPath: string;
  ffmpegPath: string;
  ytDlpPath: string;
  defaultQuality: 'best' | '1080p' | '720p' | '480p' | '360p' | 'audio';
  filenameTemplate: string;
  maxConcurrentDownloads: number;
}

type DownloadStatus = 'downloading' | 'complete' | 'error' | 'cancelled';

interface DownloadTask {
  id: string;
  url: string;
  filename: string;
  outputPath: string;
  status: DownloadStatus;
  progress: number;
  speed: string;
  size: string;
  error?: string;
}

interface VidDlAPI {
  navigate: (url: string) => Promise<void>;
  back: () => Promise<void>;
  forward: () => Promise<void>;
  reload: () => Promise<void>;
  findStreams: () => Promise<StreamInfo[]>;
  getStreams: () => Promise<StreamInfo[]>;
  clearStreams: () => Promise<void>;
  startMonitor: () => Promise<void>;
  stopMonitor: () => Promise<void>;
  setSidebarWidth: (w: number) => Promise<void>;
  fetchStreamSize: (url: string) => Promise<string | null>;
  startDownload: (opts: { url: string; filename?: string }) => Promise<string>;
  cancelDownload: (id: string) => Promise<void>;
  getAllDownloads: () => Promise<DownloadTask[]>;
  deriveFilename: (url: string) => Promise<string>;
  getSettings: () => Promise<AppSettings>;
  setSettings: (u: Partial<AppSettings>) => Promise<AppSettings>;
  browseFolder: () => Promise<string | null>;
  browseFile: (title: string) => Promise<string | null>;
  detectTool: (tool: 'ffmpeg' | 'yt-dlp') => Promise<string | null>;
  onNavigated: (cb: (url: string) => void) => void;
  onTitleUpdated: (cb: (title: string) => void) => void;
  onLoading: (cb: (v: boolean) => void) => void;
  onNewStream: (cb: (s: StreamInfo) => void) => void;
  onDownloadUpdate: (cb: (t: DownloadTask) => void) => void;
}

declare const vidDl: VidDlAPI;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const el = {
  sidebar: document.getElementById('sidebar') as HTMLElement,
  urlInput: document.getElementById('url-input') as HTMLInputElement,
  btnGo: document.getElementById('btn-go') as HTMLButtonElement,
  btnBack: document.getElementById('btn-back') as HTMLButtonElement,
  btnForward: document.getElementById('btn-forward') as HTMLButtonElement,
  btnReload: document.getElementById('btn-reload') as HTMLButtonElement,
  spinner: document.getElementById('loading-spinner') as HTMLDivElement,
  btnFindStreams: document.getElementById('btn-find-streams') as HTMLButtonElement,
  monitorToggle: document.getElementById('monitor-toggle') as HTMLInputElement,
  streamList: document.getElementById('stream-list') as HTMLDivElement,
  streamCount: document.getElementById('stream-count') as HTMLSpanElement,
  btnClear: document.getElementById('btn-clear') as HTMLButtonElement,
  settingsToggle: document.getElementById('settings-toggle') as HTMLButtonElement,
  settingsContent: document.getElementById('settings-content') as HTMLDivElement,
  settingsChevron: document.getElementById('settings-chevron') as HTMLSpanElement,
  // Settings fields
  dlPath: document.getElementById('setting-dl-path') as HTMLInputElement,
  btnBrowseDlPath: document.getElementById('btn-browse-dl-path') as HTMLButtonElement,
  quality: document.getElementById('setting-quality') as HTMLSelectElement,
  filename: document.getElementById('setting-filename') as HTMLInputElement,
  concurrent: document.getElementById('setting-concurrent') as HTMLInputElement,
  ffmpegPath: document.getElementById('setting-ffmpeg') as HTMLInputElement,
  btnBrowseFfmpeg: document.getElementById('btn-browse-ffmpeg') as HTMLButtonElement,
  btnDetectFfmpeg: document.getElementById('btn-detect-ffmpeg') as HTMLButtonElement,
  ffmpegStatus: document.getElementById('ffmpeg-status') as HTMLParagraphElement,
  ytdlpPath: document.getElementById('setting-ytdlp') as HTMLInputElement,
  btnBrowseYtdlp: document.getElementById('btn-browse-ytdlp') as HTMLButtonElement,
  btnDetectYtdlp: document.getElementById('btn-detect-ytdlp') as HTMLButtonElement,
  ytdlpStatus: document.getElementById('ytdlp-status') as HTMLParagraphElement,
  btnSaveSettings: document.getElementById('btn-save-settings') as HTMLButtonElement,
  settingsSaveStatus: document.getElementById('settings-save-status') as HTMLParagraphElement,
  // Downloads
  downloadList: document.getElementById('download-list') as HTMLDivElement,
  downloadCount: document.getElementById('download-count') as HTMLSpanElement,
  resizeHandle: document.getElementById('resize-handle') as HTMLDivElement,
  // Context menu
  contextMenu: document.getElementById('context-menu') as HTMLDivElement,
  ctxDownload: document.getElementById('ctx-download') as HTMLButtonElement,
  ctxDownloadAs: document.getElementById('ctx-download-as') as HTMLButtonElement,
  ctxCopyUrl: document.getElementById('ctx-copy-url') as HTMLButtonElement,
  // Modal
  modalOverlay: document.getElementById('modal-overlay') as HTMLDivElement,
  modalTypeBadge: document.getElementById('modal-type-badge') as HTMLSpanElement,
  modalStreamUrl: document.getElementById('modal-stream-url') as HTMLSpanElement,
  modalFilename: document.getElementById('modal-filename') as HTMLInputElement,
  modalExt: document.getElementById('modal-ext') as HTMLSpanElement,
  modalCancel: document.getElementById('modal-cancel') as HTMLButtonElement,
  modalConfirm: document.getElementById('modal-confirm') as HTMLButtonElement,
};

// ── State ─────────────────────────────────────────────────────────────────────
const seenUrls = new Set<string>();
let streamCount = 0;
let settingsOpen = false;

// ── Helpers ───────────────────────────────────────────────────────────────────
function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return Math.abs(h).toString(36);
}

function sourceLabel(source: StreamInfo['source']): string {
  return source === 'network' ? 'network' : 'source';
}

function updateCountBadge(): void {
  el.streamCount.textContent = String(streamCount);
  el.streamCount.classList.toggle('has-items', streamCount > 0);
}

// ── Stream list rendering ─────────────────────────────────────────────────────
function addStreamItem(stream: StreamInfo): void {
  if (seenUrls.has(stream.url)) return;
  seenUrls.add(stream.url);
  streamCount++;
  updateCountBadge();

  // Remove empty-state placeholder
  el.streamList.querySelector('.empty-state')?.remove();

  const itemId = `stream-${simpleHash(stream.url)}`;
  if (document.getElementById(itemId)) return;

  const item = document.createElement('div');
  item.className = 'stream-item';
  item.id = itemId;
  item.title = 'Click to copy URL';

  const header = document.createElement('div');
  header.className = 'stream-item-header';

  const typeBadge = document.createElement('span');
  typeBadge.className = `type-badge ${stream.type}`;
  typeBadge.textContent = stream.type.toUpperCase();

  const srcBadge = document.createElement('span');
  srcBadge.className = 'source-badge';
  srcBadge.textContent = sourceLabel(stream.source);

  header.append(typeBadge, srcBadge);

  const urlEl = document.createElement('div');
  urlEl.className = 'stream-url';
  urlEl.textContent = stream.url;

  const sizeEl = document.createElement('div');
  sizeEl.className = 'stream-size';

  item.append(header, urlEl, sizeEl);

  // Fetch file size for direct video types (not live manifests)
  if (stream.type === 'mp4' || stream.type === 'webm') {
    vidDl.fetchStreamSize(stream.url).then((size) => {
      if (size) sizeEl.textContent = size;
    });
  }

  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, stream);
  });

  el.streamList.appendChild(item);
}

function addStreams(streams: StreamInfo[]): void {
  streams.forEach(addStreamItem);
}

// ── Navigation ────────────────────────────────────────────────────────────────
function navigate(): void {
  const url = el.urlInput.value.trim();
  if (url) vidDl.navigate(url);
}

el.btnGo.addEventListener('click', navigate);
el.urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(); });
el.btnBack.addEventListener('click', () => vidDl.back());
el.btnForward.addEventListener('click', () => vidDl.forward());
el.btnReload.addEventListener('click', () => vidDl.reload());

vidDl.onNavigated((url) => { el.urlInput.value = url; });
vidDl.onTitleUpdated((title) => { document.title = title ? `${title} — VidDL` : 'VidDL'; });
vidDl.onLoading((loading) => {
  el.spinner.classList.toggle('hidden', !loading);
  el.btnReload.innerHTML = loading ? '&#x2715;' : '&#8635;';
});

// ── Find streams ──────────────────────────────────────────────────────────────
el.btnFindStreams.addEventListener('click', async () => {
  el.btnFindStreams.disabled = true;
  el.btnFindStreams.innerHTML = '&#8635;&nbsp; Scanning&hellip;';

  try {
    const streams = await vidDl.findStreams();
    addStreams(streams);
  } finally {
    el.btnFindStreams.disabled = false;
    el.btnFindStreams.innerHTML = '&#9654;&nbsp; Find Video Streams';
  }
});

// ── Monitor toggle ────────────────────────────────────────────────────────────
el.monitorToggle.addEventListener('change', async () => {
  if (el.monitorToggle.checked) {
    await vidDl.startMonitor();
  } else {
    await vidDl.stopMonitor();
  }
});

vidDl.onNewStream((stream) => addStreamItem(stream));

// ── Clear ─────────────────────────────────────────────────────────────────────
el.btnClear.addEventListener('click', async () => {
  await vidDl.clearStreams();
  seenUrls.clear();
  streamCount = 0;
  updateCountBadge();
  el.streamList.innerHTML = '<p class="empty-state">No streams detected yet.</p>';
});

// ── Settings accordion ────────────────────────────────────────────────────────
el.settingsToggle.addEventListener('click', () => {
  settingsOpen = !settingsOpen;
  el.settingsContent.classList.toggle('open', settingsOpen);
  el.settingsChevron.classList.toggle('open', settingsOpen);
  el.settingsToggle.setAttribute('aria-expanded', String(settingsOpen));
});

// ── Settings panel ────────────────────────────────────────────────────────────
function applySettings(s: AppSettings): void {
  el.dlPath.value = s.downloadPath || '';
  el.quality.value = s.defaultQuality;
  el.filename.value = s.filenameTemplate;
  el.concurrent.value = String(s.maxConcurrentDownloads);
  el.ffmpegPath.value = s.ffmpegPath || '';
  el.ytdlpPath.value = s.ytDlpPath || '';
}

function setToolStatus(
  el: HTMLParagraphElement,
  state: 'ok' | 'error' | 'neutral',
  msg: string,
): void {
  el.className = `tool-status ${state}`;
  el.textContent = msg;
}

// Load settings on startup
vidDl.getSettings().then(applySettings);

// Download path browse
el.btnBrowseDlPath.addEventListener('click', async () => {
  const chosen = await vidDl.browseFolder();
  if (chosen) el.dlPath.value = chosen;
});

// ffmpeg browse + detect
el.btnBrowseFfmpeg.addEventListener('click', async () => {
  const chosen = await vidDl.browseFile('Select ffmpeg executable');
  if (chosen) {
    el.ffmpegPath.value = chosen;
    setToolStatus(el.ffmpegStatus, 'neutral', '');
  }
});

el.btnDetectFfmpeg.addEventListener('click', async () => {
  el.btnDetectFfmpeg.textContent = 'Detecting…';
  el.btnDetectFfmpeg.disabled = true;
  const found = await vidDl.detectTool('ffmpeg');
  el.btnDetectFfmpeg.textContent = 'Auto-detect';
  el.btnDetectFfmpeg.disabled = false;
  if (found) {
    el.ffmpegPath.value = found;
    setToolStatus(el.ffmpegStatus, 'ok', `Found: ${found}`);
  } else {
    setToolStatus(el.ffmpegStatus, 'error', 'Not found in PATH');
  }
});

// yt-dlp browse + detect
el.btnBrowseYtdlp.addEventListener('click', async () => {
  const chosen = await vidDl.browseFile('Select yt-dlp executable');
  if (chosen) {
    el.ytdlpPath.value = chosen;
    setToolStatus(el.ytdlpStatus, 'neutral', '');
  }
});

el.btnDetectYtdlp.addEventListener('click', async () => {
  el.btnDetectYtdlp.textContent = 'Detecting…';
  el.btnDetectYtdlp.disabled = true;
  const found = await vidDl.detectTool('yt-dlp');
  el.btnDetectYtdlp.textContent = 'Auto-detect';
  el.btnDetectYtdlp.disabled = false;
  if (found) {
    el.ytdlpPath.value = found;
    setToolStatus(el.ytdlpStatus, 'ok', `Found: ${found}`);
  } else {
    setToolStatus(el.ytdlpStatus, 'error', 'Not found in PATH');
  }
});

// ── Context menu ─────────────────────────────────────────────────────────────
let ctxStream: StreamInfo | null = null;

function showContextMenu(x: number, y: number, stream: StreamInfo): void {
  ctxStream = stream;
  const menu = el.contextMenu;
  menu.classList.remove('hidden');

  const SIDEBAR_WIDTH = 300;
  const mw = 180, mh = 120;

  // Never let the menu bleed past the sidebar into the WebContentsView native layer
  const left = Math.min(x, SIDEBAR_WIDTH - mw - 4);
  const top = y + mh > window.innerHeight ? y - mh : y;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function hideContextMenu(): void {
  el.contextMenu.classList.add('hidden');
  ctxStream = null;
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { hideContextMenu(); hideModal(); } });

el.ctxDownload.addEventListener('click', async () => {
  if (!ctxStream) return;
  await vidDl.startDownload({ url: ctxStream.url });
  hideContextMenu();
});

el.ctxDownloadAs.addEventListener('click', async () => {
  if (!ctxStream) return;
  const stream = ctxStream;
  hideContextMenu();
  await openDownloadAsModal(stream);
});

el.ctxCopyUrl.addEventListener('click', async () => {
  if (!ctxStream) return;
  await navigator.clipboard.writeText(ctxStream.url);
  hideContextMenu();
});

// ── Download As modal ─────────────────────────────────────────────────────────
async function openDownloadAsModal(stream: StreamInfo): Promise<void> {
  const suggested = await vidDl.deriveFilename(stream.url);
  const dotIdx = suggested.lastIndexOf('.');
  const stem = dotIdx > 0 ? suggested.slice(0, dotIdx) : suggested;
  const ext = dotIdx > 0 ? suggested.slice(dotIdx) : '';

  el.modalTypeBadge.className = `type-badge ${stream.type}`;
  el.modalTypeBadge.textContent = stream.type.toUpperCase();
  el.modalStreamUrl.textContent = stream.url;
  el.modalStreamUrl.title = stream.url;
  el.modalFilename.value = stem;
  el.modalExt.textContent = ext;
  el.modalConfirm.dataset['url'] = stream.url;
  el.modalConfirm.dataset['ext'] = ext;
  el.modalOverlay.classList.remove('hidden');
  setTimeout(() => {
    el.modalFilename.focus();
    el.modalFilename.select();
  }, 50);
}

function hideModal(): void {
  el.modalOverlay.classList.add('hidden');
  delete el.modalConfirm.dataset['url'];
  delete el.modalConfirm.dataset['ext'];
}

el.modalCancel.addEventListener('click', hideModal);
el.modalOverlay.addEventListener('click', (e) => {
  if (e.target === el.modalOverlay) hideModal();
});

el.modalFilename.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.modalConfirm.click();
});

el.modalConfirm.addEventListener('click', async () => {
  const url = el.modalConfirm.dataset['url'];
  const ext = el.modalConfirm.dataset['ext'] ?? '';
  const stem = el.modalFilename.value.trim();
  if (!url || !stem) return;
  const filename = stem + ext;

  el.modalConfirm.disabled = true;
  try {
    await vidDl.startDownload({ url, filename });
    hideModal();
  } finally {
    el.modalConfirm.disabled = false;
  }
});

// ── Downloads panel ───────────────────────────────────────────────────────────
let totalDownloads = 0;

function upsertDownloadItem(task: DownloadTask): void {
  const existingEl = document.getElementById(`dl-${task.id}`);

  if (!existingEl) {
    // New task — bump count and remove empty state
    el.downloadList.querySelector('.empty-state')?.remove();
    totalDownloads++;
    el.downloadCount.textContent = String(totalDownloads);
    el.downloadCount.classList.add('has-items');
  }

  const item = existingEl ?? document.createElement('div');
  item.id = `dl-${task.id}`;
  item.className = `download-item ${task.status}`;

  const isIndeterminate = task.progress < 0;
  const progressPct = isIndeterminate ? 0 : task.progress;

  item.innerHTML = `
    <div class="download-item-header">
      <span class="download-filename" title="${task.outputPath}">${task.filename}</span>
      <span class="download-status-badge ${task.status}">${task.status}</span>
      ${task.status === 'downloading'
      ? `<button class="download-cancel-btn" data-id="${task.id}" title="Cancel">&#x2715;</button>`
      : ''}
    </div>
    ${task.status === 'downloading' ? `
      <div class="progress-bar-track">
        <div class="progress-bar-fill ${isIndeterminate ? 'indeterminate' : ''}"
             style="width:${isIndeterminate ? '' : progressPct + '%'}"></div>
      </div>
      <div class="download-meta">
        <span>${isIndeterminate ? 'Downloading…' : `${progressPct}%`}</span>
        <span>${[task.size, task.speed].filter(Boolean).join(' · ')}</span>
      </div>
    ` : ''}
    ${task.status === 'complete' ? `
      <div class="download-meta"><span>${task.size || 'Complete'}</span></div>
    ` : ''}
    ${task.status === 'error' ? `
      <p class="download-error-msg">${task.error ?? 'Unknown error'}</p>
    ` : ''}
  `;

  if (!existingEl) {
    el.downloadList.prepend(item);
  }

  // Wire cancel button
  item.querySelector('.download-cancel-btn')?.addEventListener('click', async (e) => {
    const id = (e.currentTarget as HTMLButtonElement).dataset['id']!;
    await vidDl.cancelDownload(id);
  });
}

vidDl.onDownloadUpdate((task) => upsertDownloadItem(task));

// ── Sidebar resize ────────────────────────────────────────────────────────────
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 600;
const SIDEBAR_STORAGE_KEY = 'sidebarWidth';
const HANDLE_PX = 8;

// Track as a plain number — never read width back from the DOM to avoid
// fractional-pixel drift between drags.
let sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN,
  parseInt(localStorage.getItem(SIDEBAR_STORAGE_KEY) ?? '') || 300
));

function applySidebarWidth(px: number, persist = false): void {
  sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(px)));
  document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
  // WebContentsView must start after sidebar + handle so the handle stays
  // in the HTML renderer layer and receives pointer events.
  vidDl.setSidebarWidth(sidebarWidth + HANDLE_PX);
  if (persist) localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarWidth));
}

// Sync to main on load so WebContentsView is never on top of the handle.
applySidebarWidth(sidebarWidth);

el.resizeHandle.addEventListener('pointerdown', (startEvent) => {
  startEvent.preventDefault();
  el.resizeHandle.setPointerCapture(startEvent.pointerId);
  el.resizeHandle.classList.add('dragging');

  const startClientX = startEvent.clientX;
  const startWidth = sidebarWidth; // use the tracked variable, not the DOM

  let rafId = 0;

  function onMove(e: PointerEvent): void {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      applySidebarWidth(startWidth + e.clientX - startClientX);
    });
  }

  function onUp(e: PointerEvent): void {
    cancelAnimationFrame(rafId);
    el.resizeHandle.classList.remove('dragging');
    el.resizeHandle.releasePointerCapture(e.pointerId);
    el.resizeHandle.removeEventListener('pointermove', onMove);
    el.resizeHandle.removeEventListener('pointerup', onUp);
    applySidebarWidth(startWidth + e.clientX - startClientX, true);
  }

  el.resizeHandle.addEventListener('pointermove', onMove);
  el.resizeHandle.addEventListener('pointerup', onUp);
});

// Save
el.btnSaveSettings.addEventListener('click', async () => {
  el.btnSaveSettings.disabled = true;
  try {
    await vidDl.setSettings({
      downloadPath: el.dlPath.value.trim(),
      defaultQuality: el.quality.value as AppSettings['defaultQuality'],
      filenameTemplate: el.filename.value.trim() || '{title}.{ext}',
      maxConcurrentDownloads: Math.min(5, Math.max(1, Number(el.concurrent.value) || 2)),
      ffmpegPath: el.ffmpegPath.value.trim(),
      ytDlpPath: el.ytdlpPath.value.trim(),
    });
    setToolStatus(el.settingsSaveStatus, 'ok', 'Saved.');
    setTimeout(() => { el.settingsSaveStatus.textContent = ''; }, 2000);
  } catch {
    setToolStatus(el.settingsSaveStatus, 'error', 'Failed to save.');
  } finally {
    el.btnSaveSettings.disabled = false;
  }
});
