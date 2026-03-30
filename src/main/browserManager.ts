import { BrowserWindow, WebContentsView } from 'electron';
import { ElectronBlocker } from '@cliqz/adblocker-electron';
import fetch from 'cross-fetch';
import { StreamDetector, StreamInfo } from './streamDetector';

const TOOLBAR_HEIGHT = 52;
// 300px sidebar + 8px resize handle
export const DEFAULT_SIDEBAR_WIDTH = 308;

export class BrowserManager {
  private mainWindow: BrowserWindow;
  private view: WebContentsView;
  private sidebarWidth: number = DEFAULT_SIDEBAR_WIDTH;
  readonly detector: StreamDetector;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.detector = new StreamDetector();
    this.view = this.createView();
    this.initAdBlocker();
  }

  private async initAdBlocker(): Promise<void> {
    try {
      const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
      blocker.enableBlockingInSession(this.view.webContents.session);
      console.log('[AdBlocker] Enabled');
    } catch (err) {
      console.warn('[AdBlocker] Failed to load filter lists — ad blocking disabled:', err);
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
    this.detector.attach(view.webContents);

    view.webContents.on('did-navigate', (_event: Electron.Event, url: string) => {
      this.mainWindow.webContents.send('browser:navigated', url);
    });

    view.webContents.on('did-navigate-in-page', (_event: Electron.Event, url: string) => {
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
