import { BrowserWindow, dialog, ipcMain, net } from 'electron';
import { BrowserManager } from './browserManager';
import { SettingsManager } from './settings';
import { Downloader, deriveFilename } from './downloader';

export function setupIpcHandlers(
  mainWindow: BrowserWindow,
  browser: BrowserManager,
  settings: SettingsManager,
): void {
  const downloader = new Downloader((task) => {
    mainWindow.webContents.send('download:update', task);
  });

  // ── Browser ──────────────────────────────────────────────────────────────────
  ipcMain.handle('browser:navigate',    (_, url: string) => browser.navigate(url));
  ipcMain.handle('browser:back',        () => browser.goBack());
  ipcMain.handle('browser:forward',     () => browser.goForward());
  ipcMain.handle('browser:reload',      () => browser.reload());
  ipcMain.handle('browser:devtools',    () => browser.openDevTools());

  // ── Streams ──────────────────────────────────────────────────────────────────
  ipcMain.handle('streams:find', async () => {
    await browser.scanPageSource();
    return browser.detector.getStreams();
  });

  ipcMain.handle('streams:get',   () => browser.detector.getStreams());
  ipcMain.handle('streams:clear', () => browser.detector.clearStreams());

  ipcMain.handle('monitor:start', () => {
    browser.startMonitoring((stream) => {
      mainWindow.webContents.send('streams:new', stream);
    });
  });

  ipcMain.handle('monitor:stop', () => browser.stopMonitoring());

  // ── Downloads ─────────────────────────────────────────────────────────────────
  ipcMain.handle('download:start', (_, { url, filename }: { url: string; filename?: string }) => {
    const s = settings.get();
    return downloader.start({
      url,
      filename: filename ?? deriveFilename(url),
      downloadPath: s.downloadPath,
      ffmpegPath: s.ffmpegPath,
    });
  });

  ipcMain.handle('download:cancel', (_, id: string) => downloader.cancel(id));

  ipcMain.handle('download:get-all', () => downloader.getTasks());

  ipcMain.handle('download:derive-filename', (_, url: string) => deriveFilename(url));

  // ── Settings ──────────────────────────────────────────────────────────────────
  ipcMain.handle('settings:get', () => settings.get());

  ipcMain.handle('settings:set', (_, updates: Record<string, unknown>) =>
    settings.set(updates),
  );

  ipcMain.handle('settings:browse-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Download Folder',
      defaultPath: settings.get().downloadPath,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('settings:browse-file', async (_, title: string) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title,
      properties: ['openFile'],
      filters: [
        { name: 'Executables', extensions: process.platform === 'win32' ? ['exe'] : ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('settings:detect-tool', (_, tool: 'ffmpeg' | 'yt-dlp') =>
    settings.detectTool(tool),
  );

  // ── Sidebar ───────────────────────────────────────────────────────────────
  ipcMain.handle('sidebar:set-width', (_, width: number) => {
    // width = sidebarCSS + handlePx, so ceiling is 608 not 600
    browser.setSidebarWidth(Math.max(188, Math.min(608, width)));
  });

  // ── Stream size ───────────────────────────────────────────────────────────
  ipcMain.handle('stream:fetch-size', (_event, url: string): Promise<string | null> => {
    return new Promise((resolve) => {
      try {
        const req = net.request({ method: 'HEAD', url });
        req.on('response', (res) => {
          const len = res.headers['content-length'];
          const bytes = Array.isArray(len) ? parseInt(len[0]) : parseInt(len as string);
          if (!isNaN(bytes) && bytes > 0) {
            const mb = bytes / 1_048_576;
            resolve(mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`);
          } else {
            resolve(null);
          }
        });
        req.on('error', () => resolve(null));
        req.end();
      } catch {
        resolve(null);
      }
    });
  });
}
