import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as crypto from 'crypto';

export type DownloadStatus = 'downloading' | 'complete' | 'error' | 'cancelled';

export interface DownloadTask {
  id: string;
  url: string;
  filename: string;
  outputPath: string;
  status: DownloadStatus;
  /** 0–100, or -1 when duration is unknown (live / indeterminate) */
  progress: number;
  speed: string;
  size: string;
  error?: string;
}

export class Downloader {
  private tasks: Map<string, DownloadTask> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private onUpdate: (task: DownloadTask) => void;

  constructor(onUpdate: (task: DownloadTask) => void) {
    this.onUpdate = onUpdate;
  }

  start(opts: {
    url: string;
    filename: string;
    downloadPath: string;
    ffmpegPath: string;
  }): string {
    const id = crypto.randomUUID();
    const outputPath = path.join(opts.downloadPath, opts.filename);

    const task: DownloadTask = {
      id,
      url: opts.url,
      filename: opts.filename,
      outputPath,
      status: 'downloading',
      progress: -1,
      speed: '',
      size: '',
    };

    this.tasks.set(id, task);
    this.onUpdate({ ...task });
    this.spawnFfmpeg(id, opts.url, outputPath, opts.ffmpegPath);
    return id;
  }

  private spawnFfmpeg(id: string, url: string, output: string, ffmpegPath: string): void {
    const bin = ffmpegPath || 'ffmpeg';
    const args = [
      '-i', url,
      '-c', 'copy',
      '-progress', '-',  // structured key=value progress on stdout
      '-nostats',
      '-y',
      output,
    ];

    let proc: ChildProcess;
    try {
      proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      const task = this.tasks.get(id)!;
      task.status = 'error';
      task.error = 'Failed to spawn ffmpeg. Check the path in Settings.';
      this.onUpdate({ ...task });
      return;
    }

    this.processes.set(id, proc);

    let totalSecs = 0;

    // Parse total duration from ffmpeg's informational stderr output
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const m = text.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (m) {
        totalSecs =
          parseInt(m[1]) * 3600 +
          parseInt(m[2]) * 60 +
          parseFloat(m[3]);
      }
    });

    // Parse structured progress from stdout
    let buf = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      const kv: Record<string, string> = {};
      for (const line of lines) {
        const eq = line.indexOf('=');
        if (eq !== -1) kv[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }

      const task = this.tasks.get(id);
      if (!task || task.status !== 'downloading') return;

      if (kv['out_time_us']) {
        const elapsedSecs = parseInt(kv['out_time_us']) / 1_000_000;
        task.progress =
          totalSecs > 0 ? Math.min(99, Math.round((elapsedSecs / totalSecs) * 100)) : -1;
      }

      if (kv['bitrate'] && kv['bitrate'] !== 'N/A') {
        task.speed = kv['bitrate'];
      }

      if (kv['total_size']) {
        const bytes = parseInt(kv['total_size']);
        task.size =
          bytes >= 1_048_576
            ? `${(bytes / 1_048_576).toFixed(1)} MB`
            : `${(bytes / 1024).toFixed(0)} KB`;
      }

      this.onUpdate({ ...task });
    });

    proc.on('close', (code) => {
      this.processes.delete(id);
      const task = this.tasks.get(id);
      if (!task || task.status === 'cancelled') return;

      if (code === 0) {
        task.status = 'complete';
        task.progress = 100;
      } else {
        task.status = 'error';
        task.error = `ffmpeg exited with code ${code}`;
      }
      this.onUpdate({ ...task });
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      this.processes.delete(id);
      const task = this.tasks.get(id);
      if (!task) return;
      task.status = 'error';
      task.error =
        err.code === 'ENOENT'
          ? 'ffmpeg not found. Set the path in Settings.'
          : err.message;
      this.onUpdate({ ...task });
    });
  }

  cancel(id: string): void {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'downloading') return;
    task.status = 'cancelled';
    this.processes.get(id)?.kill('SIGTERM');
    this.onUpdate({ ...task });
  }

  getTasks(): DownloadTask[] {
    return Array.from(this.tasks.values());
  }
}

/** Derive a safe default filename from a stream URL, always outputs .mp4 */
export function deriveFilename(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const base = path.basename(pathname).split('?')[0];
    const stem = base.replace(/\.[^.]+$/, '').replace(/[^\w\-.()\s]/g, '_') || 'video';
    return `${stem}.mp4`;
  } catch {
    return `video-${Date.now()}.mp4`;
  }
}
