import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface AppSettings {
  downloadPath: string;
  ffmpegPath: string;
  ytDlpPath: string;
  defaultQuality: 'best' | '1080p' | '720p' | '480p' | '360p' | 'audio';
  filenameTemplate: string;
  maxConcurrentDownloads: number;
}

const DEFAULTS: AppSettings = {
  downloadPath: app.getPath('downloads'),
  ffmpegPath: '',
  ytDlpPath: '',
  defaultQuality: 'best',
  filenameTemplate: '{title}.{ext}',
  maxConcurrentDownloads: 2,
};

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

export class SettingsManager {
  private data: AppSettings;

  constructor() {
    this.data = this.load();
  }

  private load(): AppSettings {
    try {
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  private save(): void {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  get(): AppSettings {
    return { ...this.data };
  }

  set(updates: Partial<AppSettings>): AppSettings {
    this.data = { ...this.data, ...updates };
    this.save();
    return this.get();
  }

  /** Try to find a CLI tool in PATH. Returns the resolved path or null. */
  detectTool(name: 'ffmpeg' | 'yt-dlp'): string | null {
    const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
    try {
      const result = execSync(cmd, { encoding: 'utf-8', timeout: 3000 }).trim();
      const firstLine = result.split('\n')[0].trim();
      return firstLine || null;
    } catch {
      return null;
    }
  }
}
