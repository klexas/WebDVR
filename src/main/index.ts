import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { BrowserManager } from './browserManager';
import { setupIpcHandlers } from './ipcHandlers';
import { SettingsManager } from './settings';

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f0f1a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Register IPC handlers and browser view before loading the page
  // so they are available the moment the renderer becomes interactive.
  const settings = new SettingsManager();
  const browser = new BrowserManager(mainWindow);
  setupIpcHandlers(mainWindow, browser, settings);
  mainWindow.on('resize', () => browser.updateBounds());

  mainWindow.loadFile(path.join(__dirname, '../../src/renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    // IPC handlers are scoped to the window; they clean up automatically
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
