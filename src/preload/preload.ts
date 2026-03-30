import { contextBridge, ipcRenderer } from 'electron';
import type { StreamInfo } from '../main/streamDetector';
import type { AppSettings } from '../main/settings';

contextBridge.exposeInMainWorld('vidDl', {
  // Navigation
  navigate: (url: string) => ipcRenderer.invoke('browser:navigate', url),
  back:     ()            => ipcRenderer.invoke('browser:back'),
  forward:  ()            => ipcRenderer.invoke('browser:forward'),
  reload:   ()            => ipcRenderer.invoke('browser:reload'),

  // Stream detection
  findStreams:  () => ipcRenderer.invoke('streams:find'),
  getStreams:   () => ipcRenderer.invoke('streams:get'),
  clearStreams:  () => ipcRenderer.invoke('streams:clear'),

  // Monitoring
  startMonitor: () => ipcRenderer.invoke('monitor:start'),
  stopMonitor:  () => ipcRenderer.invoke('monitor:stop'),

  // Settings
  getSettings:      ():                              Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings:      (updates: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke('settings:set', updates),
  browseFolder:     ():                              Promise<string|null>  => ipcRenderer.invoke('settings:browse-folder'),
  browseFile:       (title: string):                 Promise<string|null>  => ipcRenderer.invoke('settings:browse-file', title),
  detectTool:       (tool: 'ffmpeg'|'yt-dlp'):       Promise<string|null>  => ipcRenderer.invoke('settings:detect-tool', tool),

  // Sidebar
  setSidebarWidth: (w: number) => ipcRenderer.invoke('sidebar:set-width', w),

  // Stream size
  fetchStreamSize: (url: string): Promise<string | null> => ipcRenderer.invoke('stream:fetch-size', url),

  // Downloads
  startDownload:       (opts: { url: string; filename?: string })  => ipcRenderer.invoke('download:start', opts),
  cancelDownload:      (id: string)                                => ipcRenderer.invoke('download:cancel', id),
  getAllDownloads:      ()                                          => ipcRenderer.invoke('download:get-all'),
  deriveFilename:      (url: string)                               => ipcRenderer.invoke('download:derive-filename', url),

  // Main → Renderer events
  onNavigated:    (cb: (url: string)       => void) => ipcRenderer.on('browser:navigated',    (_, v) => cb(v)),
  onTitleUpdated: (cb: (title: string)     => void) => ipcRenderer.on('browser:title-updated', (_, v) => cb(v)),
  onLoading:      (cb: (loading: boolean)  => void) => ipcRenderer.on('browser:loading',        (_, v) => cb(v)),
  onNewStream:      (cb: (stream: StreamInfo)  => void) => ipcRenderer.on('streams:new',       (_, v) => cb(v)),
  onDownloadUpdate: (cb: (task: unknown)       => void) => ipcRenderer.on('download:update',   (_, v) => cb(v)),
});
