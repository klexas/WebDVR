import { WebContents } from 'electron';

export interface StreamInfo {
  url: string;
  type: StreamType;
  source: 'network' | 'page-source';
  timestamp: number;
  pageUrl: string;
}

export type StreamType = 'hls' | 'dash' | 'mp4' | 'webm' | 'unknown-video';

// Matched against the full URL string
const URL_PATTERNS: Array<{ pattern: RegExp; type: StreamType }> = [
  // Standard extension-based
  { pattern: /\.m3u8(\?|#|$)/i,  type: 'hls' },
  { pattern: /\.mpd(\?|#|$)/i,   type: 'dash' },
  { pattern: /\.mp4(\?|#|$)/i,   type: 'mp4' },
  { pattern: /\.webm(\?|#|$)/i,  type: 'webm' },
  // YouTube DASH / HLS manifests (no file extension)
  { pattern: /googlevideo\.com\/api\/manifest\/dash\//i,        type: 'dash' },
  { pattern: /googlevideo\.com\/api\/manifest\/hls_variant\//i, type: 'hls' },
  { pattern: /googlevideo\.com\/api\/manifest\/hls_playlist\//i,type: 'hls' },
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
  // YouTube manifest URLs embedded in page JS
  /"(https?:\/\/manifest\.googlevideo\.com\/api\/manifest\/[^"]+)"/gi,
];

// ── YouTube videoplayback helpers ─────────────────────────────────────────────

/**
 * Returns a stable deduplication key for YouTube /videoplayback URLs so that
 * repeated segment requests for the same format collapse to a single entry.
 * Returns null for non-video mimes (audio-only streams).
 * Returns undefined for URLs that are not YouTube videoplayback URLs.
 */
function youtubeVideoplaybackInfo(
  url: string
): { key: string; type: StreamType } | null | undefined {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('googlevideo.com')) return undefined;
    if (u.pathname !== '/videoplayback') return undefined;

    const mime  = decodeURIComponent(u.searchParams.get('mime') ?? '');
    const itag  = u.searchParams.get('itag') ?? 'unknown';
    const id    = u.searchParams.get('id')   ?? u.searchParams.get('docid') ?? '';

    // Skip audio-only streams
    if (!mime.startsWith('video/')) return null;

    const type: StreamType = mime.includes('webm') ? 'webm' : 'mp4';
    return { key: `yt-vp:${id}:${itag}`, type };
  } catch {
    return undefined;
  }
}

export class StreamDetector {
  // Key → StreamInfo.  Key is the URL for most streams, a stable synthetic key
  // for YouTube videoplayback segments (to avoid flooding with per-segment entries).
  private streams: Map<string, StreamInfo> = new Map();
  private monitoringCallback: ((stream: StreamInfo) => void) | null = null;
  private isMonitoring = false;

  attach(webContents: WebContents): void {
    const ses = webContents.session;

    ses.webRequest.onBeforeSendHeaders(
      { urls: ['*://*/*'] },
      (details, callback) => {
        this.checkUrl(details.url, 'network', webContents.getURL());

        // Strip "Electron" from Client Hints headers so sites like YouTube
        // don't detect and block the embedded browser.
        const headers = details.requestHeaders;
        for (const key of Object.keys(headers)) {
          const lower = key.toLowerCase();
          if (lower === 'sec-ch-ua' || lower === 'sec-ch-ua-full-version-list') {
            headers[key] = headers[key]
              .split(',')
              .map((s) => s.trim())
              .filter((s) => !s.toLowerCase().includes('electron'))
              .join(', ');
          }
        }

        callback({ cancel: false, requestHeaders: headers });
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
    // YouTube videoplayback: deduplicate by itag, skip audio-only
    const ytInfo = youtubeVideoplaybackInfo(url);
    if (ytInfo !== undefined) {
      if (ytInfo !== null) {
        this.addStream({ url, type: ytInfo.type, source, timestamp: Date.now(), pageUrl }, ytInfo.key);
      }
      return;
    }

    const type = this.typeFromUrl(url);
    if (type) {
      this.addStream({ url, type, source, timestamp: Date.now(), pageUrl });
    }
  }

  private addStream(stream: StreamInfo, key?: string): void {
    const k = key ?? stream.url;
    if (this.streams.has(k)) return;
    this.streams.set(k, stream);
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

      // Resources already loaded by the browser — extend filter to include
      // YouTube manifest/videoplayback URLs
      const resourceUrls: string[] = await webContents.executeJavaScript(`
        performance.getEntriesByType('resource')
          .map(r => r.name)
          .filter(u => /\\.m3u8|\\.mpd|\\.mp4|\\.webm|googlevideo\\.com/i.test(u))
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
