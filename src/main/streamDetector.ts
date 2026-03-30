import { WebContents } from 'electron';

export interface StreamInfo {
  url: string;
  type: StreamType;
  source: 'network' | 'page-source';
  timestamp: number;
  pageUrl: string;
}

export type StreamType = 'hls' | 'dash' | 'mp4' | 'webm' | 'unknown-video';

const URL_PATTERNS: Array<{ pattern: RegExp; type: StreamType }> = [
  { pattern: /\.m3u8(\?|#|$)/i, type: 'hls' },
  { pattern: /\.mpd(\?|#|$)/i, type: 'dash' },
  { pattern: /\.mp4(\?|#|$)/i, type: 'mp4' },
  { pattern: /\.webm(\?|#|$)/i, type: 'webm' },
];

// Patterns to scan page source/JS for embedded video URLs
const SOURCE_SCAN_PATTERNS: RegExp[] = [
  /["'`](https?:\/\/[^"'`\s]{8,}\.m3u8[^"'`\s]*)/gi,
  /["'`](https?:\/\/[^"'`\s]{8,}\.mpd[^"'`\s]*)/gi,
  /["'`](https?:\/\/[^"'`\s]{8,}\.mp4[^"'`\s]*)/gi,
  /["'`](https?:\/\/[^"'`\s]{8,}\.webm[^"'`\s]*)/gi,
  /src=["'`](https?:\/\/[^"'`\s]+\.(mp4|webm|m3u8|mpd)[^"'`\s]*)/gi,
  /file:\s*["'`](https?:\/\/[^"'`\s]+)/gi,
  /"hls(?:Url|Src|Source|Path)":\s*"(https?:\/\/[^"]+)"/gi,
  /"(?:dash|mpd)(?:Url|Src|Source|Path)":\s*"(https?:\/\/[^"]+)"/gi,
];

export class StreamDetector {
  private streams: Map<string, StreamInfo> = new Map();
  private monitoringCallback: ((stream: StreamInfo) => void) | null = null;
  private isMonitoring = false;

  attach(webContents: WebContents): void {
    const ses = webContents.session;

    ses.webRequest.onBeforeSendHeaders(
      { urls: ['*://*/*'] },
      (details, callback) => {
        this.checkUrl(details.url, 'network', webContents.getURL());
        callback({ cancel: false });
      }
    );
  }

  private typeFromUrl(url: string): StreamType | null {
    for (const { pattern, type } of URL_PATTERNS) {
      if (pattern.test(url)) return type;
    }
    return null;
  }

  private checkUrl(url: string, source: 'network' | 'page-source', pageUrl: string): void {
    const type = this.typeFromUrl(url);
    if (type) {
      this.addStream({ url, type, source, timestamp: Date.now(), pageUrl });
    }
  }

  private addStream(stream: StreamInfo): void {
    if (this.streams.has(stream.url)) return;
    this.streams.set(stream.url, stream);
    if (this.isMonitoring && this.monitoringCallback) {
      this.monitoringCallback(stream);
    }
  }

  async scanPageSource(webContents: WebContents): Promise<void> {
    try {
      const pageUrl = webContents.getURL();

      const html: string = await webContents.executeJavaScript(
        'document.documentElement.outerHTML'
      );

      // Resources already loaded by the browser
      const resourceUrls: string[] = await webContents.executeJavaScript(`
        performance.getEntriesByType('resource')
          .map(r => r.name)
          .filter(u => /\\.m3u8|\\.mpd|\\.mp4|\\.webm/i.test(u))
      `);

      // <video> and <source> element src attributes
      const videoSrcs: string[] = await webContents.executeJavaScript(`
        [...document.querySelectorAll('video, source, audio')]
          .flatMap(el => [el.src, el.currentSrc, el.getAttribute('src')])
          .filter(Boolean)
      `);

      // Regex scan over raw HTML/JS
      for (const pattern of SOURCE_SCAN_PATTERNS) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(html)) !== null) {
          const url = match[1];
          if (url) this.checkUrl(url, 'page-source', pageUrl);
        }
      }

      for (const url of [...resourceUrls, ...videoSrcs]) {
        if (url) this.checkUrl(url, 'page-source', pageUrl);
      }
    } catch (err) {
      console.error('[StreamDetector] scanPageSource error:', err);
    }
  }

  getStreams(): StreamInfo[] {
    return Array.from(this.streams.values());
  }

  clearStreams(): void {
    this.streams.clear();
  }

  startMonitoring(callback: (stream: StreamInfo) => void): void {
    this.isMonitoring = true;
    this.monitoringCallback = callback;
  }

  stopMonitoring(): void {
    this.isMonitoring = false;
    this.monitoringCallback = null;
  }
}
