import * as cheerio from 'cheerio';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { URL } from 'url';
import { fetchHtmlWithCurl } from './curlFetch';

interface FetchResult {
  content: string | null;
  etag?: string | null;
  lastModified?: string | null;
  status: number;
}

interface CrawlConfig {
  listUrls?: string[];
  detailPattern?: string; // Regex string
  listSelectors?: {
    item?: string; // Selector for the list item container
    title?: string; // Selector inside item
    date?: string; // Selector inside item
    url?: string; // Selector inside item (usually 'a')
  };
  selectors?: {
    title?: string;
    date?: string;
    content?: string;
    attachments?: string; // Selector for attachment links
    detailTitle?: string;
    detailDate?: string;
    detailContent?: string;
  };
  headers?: Record<string, string>;
  transport?: 'undici' | 'curl';
  curlArgs?: string[];
}

export interface ListItem {
  url: string;
  title?: string;
  date?: Date;
}

export class Crawler {
  private userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  private static lastRequestMap = new Map<string, number>();

  constructor(private currentConfig?: CrawlConfig) {}

  private async rateLimit(url: string) {
    const domain = new URL(url).hostname;
    const lastTime = Crawler.lastRequestMap.get(domain) || 0;
    const now = Date.now();
    const minInterval = 1000 + Math.random() * 2000; // 1-3s

    if (now - lastTime < minInterval) {
      const waitTime = minInterval - (now - lastTime);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    Crawler.lastRequestMap.set(domain, Date.now());
  }

  async fetch(
    url: string,
    etag?: string | null,
    lastModified?: string | null,
    extraHeaders?: Record<string, string>
  ): Promise<FetchResult> {
    const headers: any = {
      'User-Agent': this.userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...(extraHeaders || {}),
    };

    if (etag) headers['If-None-Match'] = etag;
    if (lastModified) headers['If-Modified-Since'] = lastModified;

    // Check for curl transport
    if (this.currentConfig?.transport === 'curl') {
        const start = Date.now();
        try {
            await this.rateLimit(url);
            
            const { status, html } = await fetchHtmlWithCurl(
              url, 
              headers, 
              20000, 
              this.currentConfig?.curlArgs || []
            );
            console.log(`[Crawler] transport=curl url=${url} status=${status} ms=${Date.now() - start}`);
            
            if (status >= 400) {
                 console.error(`[Crawler] Curl fetch failed for ${url}: ${status}`);
                 return { content: null, status };
            }

            // Note: Curl doesn't easily give us response headers for ETag/Last-Modified unless we parse -D output.
            // For this minimal implementation, we skip ETag/LM updates when using curl.
            return {
                content: html,
                status,
                etag: null, 
                lastModified: null
            };
        } catch (e: any) {
            console.error(`[Crawler] CurlFetchFailed: ${e.message} url=${url} ms=${Date.now() - start}`);
            return { content: null, status: 0 };
        }
    }

    try {
      await this.rateLimit(url);

      const res = await fetch(url, { headers });
      
      if (res.status === 304) {
        return { content: null, status: 304 };
      }

      if (!res.ok) {
        console.error(`Fetch failed for ${url}: ${res.status}`);
        return { content: null, status: res.status };
      }

      const text = await res.text();
      return {
        content: text,
        etag: res.headers.get('ETag'),
        lastModified: res.headers.get('Last-Modified'),
        status: res.status
      };
    } catch (e) {
      console.error(`Network error for ${url}:`, e);
      return { content: null, status: 0 };
    }
  }

  private async checkUrlContentType(url: string): Promise<boolean> {
    try {
        await this.rateLimit(url);
        const res = await fetch(url, { 
            method: 'HEAD', 
            headers: { 'User-Agent': this.userAgent } 
        });
        
        if (!res.ok) return false;

        const type = res.headers.get('Content-Type') || '';
        const disposition = res.headers.get('Content-Disposition') || '';
        
        if (
            type.includes('application/pdf') ||
            type.includes('application/msword') ||
            type.includes('application/vnd.openxmlformats-officedocument') ||
            type.includes('application/vnd.ms-excel') ||
            type.includes('application/zip') ||
            type.includes('application/x-zip-compressed') ||
            type.includes('application/x-rar-compressed')
        ) {
            return true;
        }

        if (disposition.includes('attachment') || disposition.includes('filename=')) {
            return true;
        }

        return false;
    } catch (e) {
        return false;
    }
  }

  async enrichAttachments(html: string, baseUrl: string, existingAttachments: { name: string; url: string }[]): Promise<{ name: string; url: string }[]> {
      const $ = cheerio.load(html);
      const candidates: { name: string; url: string }[] = [];
      const existingUrls = new Set(existingAttachments.map(a => a.url));

      // Heuristic 1: Links with "下载" or "附件" in text
      $('a').each((_, el) => {
          const text = $(el).text().trim();
          const href = $(el).attr('href');
          if (!href || href.startsWith('javascript:') || href.startsWith('#') || href.startsWith('mailto:')) return;

          try {
             const absUrl = new URL(href, baseUrl).href;
             if (existingUrls.has(absUrl)) return;

             if (text.includes('下载') || text.includes('附件')) {
                 candidates.push({ name: text, url: absUrl });
                 existingUrls.add(absUrl); // Prevent dupes in candidates
             }
          } catch(e) {}
      });

      // Heuristic 2: Links inside a container that has "附件" text
      // Find elements containing "附件" text, then look for links nearby
      $('*').each((_, el) => {
          if ($(el).children().length === 0 && $(el).text().includes('附件')) {
              // Look at siblings or parent's siblings/children
              const parent = $(el).parent();
              parent.find('a').each((__, aEl) => {
                  const href = $(aEl).attr('href');
                  const text = $(aEl).text().trim();
                  if (!href || href.startsWith('javascript:') || href.startsWith('#') || href.startsWith('mailto:')) return;

                  try {
                    const absUrl = new URL(href, baseUrl).href;
                    if (!existingUrls.has(absUrl)) {
                        candidates.push({ name: text || 'Attachment', url: absUrl });
                        existingUrls.add(absUrl);
                    }
                  } catch(e) {}
              });
          }
      });

      // Filter candidates with HEAD request
      const confirmed: { name: string; url: string }[] = [];
      for (const cand of candidates) {
          // Skip if obviously not a file (e.g. ends with .htm, .html, .php without params might be risky but let HEAD decide if we are sure)
          // Actually, let's skip obvious pages to save requests
          if (cand.url.match(/\.(html|htm|jsp|asp|aspx)(\?.*)?$/i)) {
              // If it has query params, it MIGHT be a download (e.g. download.jsp?file=...)
              if (!cand.url.includes('?')) continue; 
          }

          const isFile = await this.checkUrlContentType(cand.url);
          if (isFile) {
              confirmed.push(cand);
          }
      }

      return [...existingAttachments, ...confirmed];
  }

  discoverLinks(html: string, baseUrl: string, pattern?: string): string[] {
    const $ = cheerio.load(html);
    const links: Set<string> = new Set();
    const regex = pattern ? new RegExp(pattern) : null;

    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      try {
        // Normalize URL
        const absoluteUrl = new URL(href, baseUrl).href;
        // Clean params (utm, etc)
        const urlObj = new URL(absoluteUrl);
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(p => urlObj.searchParams.delete(p));
        const cleanUrl = urlObj.href;

        if (regex) {
          if (regex.test(cleanUrl)) {
            links.add(cleanUrl);
          }
        } else {
            // If no pattern, heuristic: length > base + 10, no #
            if (cleanUrl.length > baseUrl.length + 5 && !cleanUrl.includes('#')) {
                links.add(cleanUrl);
            }
        }
      } catch (e) {
        // Invalid URL, ignore
      }
    });

    return Array.from(links);
  }

  parseList(html: string, baseUrl: string, config: CrawlConfig): ListItem[] {
    if (!config.listSelectors?.item) {
      const links = this.discoverLinks(html, baseUrl, config.detailPattern);
      return links.map(url => ({ url }));
    }

    const $ = cheerio.load(html);
    const items: ListItem[] = [];
    const regex = config.detailPattern ? new RegExp(config.detailPattern) : null;
    const selectors = config.listSelectors;

    $(selectors.item).each((_, el) => {
      const $item = $(el);
      let href: string | undefined;

      if (selectors.url) {
        const target = $item.find(selectors.url).first();
        href = target.attr('href') || target.attr('data-href') || target.attr('data-url');
        if (!href) {
          const onclick = target.attr('onclick') || '';
          const m = onclick.match(/['"](https?:\/\/[^'"]+)['"]/);
          if (m) href = m[1];
        }
      } else {
        const linkEl = $item.find('a').first() || $item.filter('a').first();
        href =
          linkEl.attr('href') || linkEl.attr('data-href') || linkEl.attr('data-url');
        if (!href) {
          const onclick = linkEl.attr('onclick') || '';
          const m = onclick.match(/['"](https?:\/\/[^'"]+)['"]/);
          if (m) href = m[1];
        }
      }

      if (!href) return;

      try {
        const absoluteUrl = new URL(href, baseUrl).href;
        const urlObj = new URL(absoluteUrl);
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(p =>
          urlObj.searchParams.delete(p),
        );
        const cleanUrl = urlObj.href;

        if (regex && !regex.test(cleanUrl)) {
          return;
        }

        const item: ListItem = { url: cleanUrl };

        if (selectors.title) {
          item.title = $item.find(selectors.title).text().trim();
        } else {
          item.title = $item.find('a').text().trim() || $item.filter('a').text().trim();
        }

        if (selectors.date) {
          const dateStr = $item.find(selectors.date).text().trim();
          if (dateStr) {
            const normalized = dateStr.replace(/\./g, '-');
            const d = new Date(normalized);
            if (!isNaN(d.getTime())) {
              item.date = d;
            }
          }
        } else {
          const text = $item.text();
          const match = text.match(/(\d{4}[-.]\d{2}[-.]\d{2})/);
          if (match) {
            const d = new Date(match[0].replace(/\./g, '-'));
            if (!isNaN(d.getTime())) item.date = d;
          }
        }

        items.push(item);
      } catch (e) {
      }
    });

    return items;
  }

  parseDetail(html: string, url: string, config?: CrawlConfig['selectors']) {
    const $ = cheerio.load(html);
    
    let title = '';
    let content = '';
    let date = null;
    let attachments: { name: string, url: string }[] = [];

    // 1. Try Config Selectors (Prioritize detail* then standard)
    const titleSelector = config?.detailTitle || config?.title;
    if (titleSelector) title = $(titleSelector).first().text().trim();

    const contentSelector = config?.detailContent || config?.content;
    if (contentSelector) {
        content = $(contentSelector).html() || ''; 
    }

    const dateSelector = config?.detailDate || config?.date;
    if (dateSelector) {
        const dateStr = $(dateSelector).text().trim();
        date = this.parseDate(dateStr);
    }

    if (config?.attachments) {
        $(config.attachments).each((_, el) => {
            const href = $(el).attr('href');
            const name = $(el).text().trim();
            if (href) {
                 attachments.push({ name: name || 'Attachment', url: new URL(href, url).href });
            }
        });
    }

    // 2. Fallback to Readability
    if (!title || !content || content.length < 50) {
        // Remove noise only for fallback
        $('nav, footer, header, aside, .nav, .footer, .header, .sidebar, script, style, .related, .comment').remove();
        const cleanHtml = $.html();

        const doc = new JSDOM(cleanHtml, { url });
        const reader = new Readability(doc.window.document);
        const article = reader.parse();
        
        if (article) {
            if (!title) title = article.title;
            if (!content) content = article.textContent; 
        }
    }

    // 3. Fallback Date extraction from text
    if (!date) {
        date = this.parseDate(html) || new Date(); // Default to now if not found? Or null?
    }

    // 4. Fallback Attachments (find .pdf, .doc, .docx, .xls, .xlsx, .zip, .rar)
    if (attachments.length === 0) {
        $('a[href$=".pdf"], a[href$=".doc"], a[href$=".docx"], a[href$=".xls"], a[href$=".xlsx"], a[href$=".zip"], a[href$=".rar"]').each((_, el) => {
             const href = $(el).attr('href');
             const name = $(el).text().trim();
             if (href) {
                 attachments.push({ name: name || 'Attachment', url: new URL(href, url).href });
             }
        });
    }

    if (config?.content || config?.detailContent) {
         content = cheerio.load(content).text();
    }
    
    // Normalize content
    content = content.replace(/\s+/g, ' ').trim();

    return {
        title,
        content,
        date,
        attachments
    };
  }

  private parseDate(text: string): Date | null {
    // Regex for YYYY-MM-DD
    const regex = /(\d{4})[-\u5e74./](\d{1,2})[-\u6708./](\d{1,2})/;
    const match = text.match(regex);
    if (match) {
        return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
    }
    return null;
  }
}
