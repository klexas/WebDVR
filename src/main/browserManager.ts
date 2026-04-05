import { BrowserWindow, WebContentsView } from 'electron';
import { ElectronBlocker } from '@cliqz/adblocker-electron';
import fetch from 'cross-fetch';
import { StreamDetector, StreamInfo } from './streamDetector';

const TOOLBAR_HEIGHT = 52;
// 300px sidebar + 8px resize handle
export const DEFAULT_SIDEBAR_WIDTH = 308;

// Hostnames where the adblocker breaks page rendering
const ADBLOCKER_BYPASS_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'music.youtube.com',
]);

function shouldBypassBlocker(url: string): boolean {
  try {
    return ADBLOCKER_BYPASS_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export class BrowserManager {
  private mainWindow: BrowserWindow;
  private view: WebContentsView;
  private sidebarWidth: number = DEFAULT_SIDEBAR_WIDTH;
  private blocker: ElectronBlocker | null = null;
  private blockerActive = false;
  readonly detector: StreamDetector;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.detector = new StreamDetector();
    this.view = this.createView();
    this.initAdBlocker();
  }

  private async initAdBlocker(): Promise<void> {
    try {
      this.blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
      this.blocker.enableBlockingInSession(this.view.webContents.session);
      this.blockerActive = true;
      console.log('[AdBlocker] Enabled');
    } catch (err) {
      console.warn('[AdBlocker] Failed to load filter lists — ad blocking disabled:', err);
    }
  }

  private applyBlockerForUrl(url: string): void {
    if (!this.blocker) return;
    const session = this.view.webContents.session;
    const bypass = shouldBypassBlocker(url);

    if (bypass && this.blockerActive) {
      this.blocker.disableBlockingInSession(session);
      this.blockerActive = false;
      console.log(`[AdBlocker] Disabled for ${new URL(url).hostname}`);
    } else if (!bypass && !this.blockerActive) {
      this.blocker.enableBlockingInSession(session);
      this.blockerActive = true;
      console.log('[AdBlocker] Re-enabled');
    }
  }

  private createView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        // Required for sites that mix http/https sub-resources
        webSecurity: false,
      },
    });

    this.mainWindow.contentView.addChildView(view);
    this.setBoundsOnView(view);

    // Override user agent: sites like YouTube block requests that include
    // "Electron/x.x.x" in the UA string and return a blank page.
    const chromeVersion = process.versions.chrome ?? '130.0.0.0';
    view.webContents.setUserAgent(
      `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
    );

    this.detector.attach(view.webContents);

    view.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error(`[Browser] Load failed (${code}): ${desc} — ${url}`);
    });

    // Mirror all console messages from the embedded page to the main process console
    view.webContents.on('console-message', (_e, level, message, line, source) => {
      const prefix = ['[WebView:log]', '[WebView:info]', '[WebView:warn]', '[WebView:error]'][level] ?? '[WebView]';
      console.log(`${prefix} ${message}  (${source}:${line})`);
    });

    view.webContents.on('did-navigate', (_event: Electron.Event, url: string) => {
      this.applyBlockerForUrl(url);
      this.mainWindow.webContents.send('browser:navigated', url);
    });

    view.webContents.on('did-navigate-in-page', (_event: Electron.Event, url: string) => {
      this.applyBlockerForUrl(url);
      this.mainWindow.webContents.send('browser:navigated', url);
    });

    view.webContents.on('page-title-updated', (_event: Electron.Event, title: string) => {
      this.mainWindow.webContents.send('browser:title-updated', title);
    });

    view.webContents.on('did-start-loading', () => {
      this.mainWindow.webContents.send('browser:loading', true);
    });

    view.webContents.on('did-stop-loading', () => {
      this.mainWindow.webContents.send('browser:loading', false);
    });

    return view;
  }

  private setBoundsOnView(view: WebContentsView): void {
    const { width, height } = this.mainWindow.getContentBounds();
    view.setBounds({
      x: this.sidebarWidth,
      y: TOOLBAR_HEIGHT,
      width: Math.max(0, width - this.sidebarWidth),
      height: Math.max(0, height - TOOLBAR_HEIGHT),
    });
  }

  updateBounds(): void {
    this.setBoundsOnView(this.view);
  }

  setSidebarWidth(width: number): void {
    this.sidebarWidth = width;
    this.updateBounds();
  }

  navigate(url: string): void {
    const normalized =
      url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;
    // Toggle blocker before loading so the first resource requests are unblocked if needed
    this.applyBlockerForUrl(normalized);
    this.view.webContents.loadURL(normalized);
  }

  goBack(): void {
    if (this.view.webContents.canGoBack()) this.view.webContents.goBack();
  }

  goForward(): void {
    if (this.view.webContents.canGoForward()) this.view.webContents.goForward();
  }

  reload(): void {
    this.view.webContents.reload();
  }

  openDevTools(): void {
    this.view.webContents.openDevTools({ mode: 'detach' });
  }

  getCurrentUrl(): string {
    return this.view.webContents.getURL();
  }

  async scanPageSource(): Promise<void> {
    await this.detector.scanPageSource(this.view.webContents);
  }

  startMonitoring(callback: (stream: StreamInfo) => void): void {
    this.detector.startMonitoring(callback);
  }

  stopMonitoring(): void {
    this.detector.stopMonitoring();
  }
}
