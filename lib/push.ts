import { AIAnalysisResult } from './ai';

function isNearDeadline(publishDate?: string | null, deadline?: string | null): boolean {
  if (!deadline) return false;
  const today = new Date();
  const d = new Date(deadline);
  if (Number.isNaN(d.getTime())) return false;
  const diffMs = d.getTime() - today.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 3;
}

function normalizeSummary(summary?: string | null): string | null {
  if (!summary) return null;
  let s = summary.trim();
  if (s.length > 80) {
    s = s.slice(0, 80);
  }
  return s;
}

function dedupeKeyPoints(summary: string | null, keyPoints?: string[] | null): string[] {
  if (!keyPoints || keyPoints.length === 0) return [];
  const result: string[] = [];
  const normalizedSummary = summary ? summary.replace(/\s+/g, '') : '';
  for (const raw of keyPoints) {
    if (!raw) continue;
    const point = raw.trim();
    if (!point) continue;
    if (normalizedSummary && normalizedSummary.includes(point.replace(/\s+/g, ''))) {
      continue;
    }
    result.push(point);
    if (result.length >= 3) break;
  }
  return result;
}

export function buildWeComMarkdown(data: AIAnalysisResult): string {
  const lines: string[] = [];

  // 1. Header: Clean School Name + Title
  // Try to use school name, fallback to site/source name.
  // If school name is part of site name (e.g. School="ABC", Site="ABC-News"), use School.
  let sourceLabel = data.school || data.site || '资讯';
  
  // Clean up source label (remove excessive suffixes if needed, though AI should handle it)
  if (sourceLabel.length > 10 && (data.site && data.site.includes(sourceLabel))) {
      // If inferred school is very long and contained in site, maybe just use site or truncated
  }

  // Determine category emoji
  let catEmoji = '📢';
  if (data.category?.includes('招生') || data.category?.includes('章程')) catEmoji = '🎓';
  if (data.category?.includes('名单') || data.category?.includes('公示')) catEmoji = '📋';
  if (data.category?.includes('分数')) catEmoji = '📊';

  const nearDeadline = isNearDeadline(data.publish_date || null, data.deadline || null);
  const deadlineAlert = nearDeadline ? '⏰ ' : '';

  // Format: 【School】Title
  lines.push(`${deadlineAlert}【${sourceLabel}】${data.title}`);

  // 2. Metadata Line: Date | Category
  const dateStr = data.publish_date || '日期未知';
  lines.push(`📅 ${dateStr}  🏷️ ${data.category || '通知'}`);

  // 3. Deadline (if exists)
  if (data.deadline) {
    lines.push(`⏳ 截止：${data.deadline}`);
  }

  // 4. Summary
  const normalizedSummary = normalizeSummary(data.summary);
  if (normalizedSummary) {
    lines.push(`\n${normalizedSummary}`); // Empty line before summary for spacing
  }

  // 5. Key Points (simplified)
  const cleanKeyPoints = dedupeKeyPoints(normalizedSummary, data.key_points || []);
  if (cleanKeyPoints.length > 0) {
    cleanKeyPoints.forEach(point => {
      lines.push(`- ${point}`);
    });
  }

  // 6. Attachments
  if (data.attachments && data.attachments.length > 0) {
    lines.push('\n📎 附件：');
    data.attachments.forEach(att => {
        const name = att.name.replace(/[\[\]]/g, ''); // escape brackets
        if (att.url && att.url.startsWith('http')) {
            lines.push(`- <a href="${att.url}">${name}</a>`);
        } else {
            lines.push(`- ${name}`);
        }
    });
  }

  // 7. Footer Link
  // Use canonicalUrl first, then fallback to url. 
  // Ensure it's a valid HTTP link.
  const link = (data.canonicalUrl || data.url || '').trim();
  if (link.startsWith('http')) {
      lines.push(`\n🔗 [查看原文](${link})`);
  } else {
      console.warn(`[WeCom] Invalid link for ${data.title}: ${link}`);
  }

  const markdown = lines.join('\n');
  
  // 8. Length Insurance (Max 4096 bytes for WeCom, we use 3500 for safety)
  const MAX_BYTES = 3500;
  const currentBytes = Buffer.byteLength(markdown, 'utf8');

  if (currentBytes > MAX_BYTES) {
      console.warn(`[WeCom] markdown truncated bytes=${currentBytes}->${MAX_BYTES} title=${data.title}`);
      
      // Strategy: Keep Header(1-2), Metadata(3), Footer(7) intact.
      // Truncate Summary(4), KeyPoints(5), Attachments(6) if needed.
      // But for simplicity and safety, we will just take a substring of the main body
      // and ensure the footer link is appended.

      // Calculate footer length
      const footer = `\n\n(内容过长已截断) \n🔗 [查看原文](${link})`;
      const footerBytes = Buffer.byteLength(footer, 'utf8');
      
      // Available bytes for content
      const availableBytes = MAX_BYTES - footerBytes;
      
      // Use buffer to safe slice utf8
      const buf = Buffer.from(markdown, 'utf8');
      
      // Take the first N bytes
      const slicedBuf = buf.subarray(0, availableBytes);
      const truncatedBody = slicedBuf.toString('utf8'); // Buffer.toString handles incomplete utf8 chars by dropping them if needed, or we can use string slice if we are careful. 
      // Actually Buffer.subarray might cut in middle of a multibyte char. 
      // toString('utf8') usually replaces invalid sequence with replacement char.
      // A safer way is to ignore the last few bytes if they are part of a multibyte sequence, 
      // but standard toString is usually "safe enough" for display (just shows ).
      
      return `${truncatedBody}${footer}`;
  }

  return markdown;
}

export const CANARY_ERRORS: { code: number; msg: string; advice: string }[] = [];

export async function pushToWeCom(data: AIAnalysisResult): Promise<boolean> {
  const isCanary = process.env.PUSH_MODE === 'canary';
  const webhook = isCanary 
    ? process.env.WECOM_WEBHOOK_CANARY 
    : process.env.WEWORK_WEBHOOK_URL;

  if (!webhook) {
     console.warn(`[WeCom] CANARY webhook missing, SKIP sending (mode=${process.env.PUSH_MODE || 'prod'}).`);
     return false;
  }

  if (isCanary) {
      console.log('[WeCom] canary send sleep=4200ms');
      await new Promise(resolve => setTimeout(resolve, 4200));
  }

  const content = buildWeComMarkdown(data);

  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { content }
      })
    });
    
    if (!res.ok) {
        const errText = await res.text();
        console.error(`[WeCom] Push Failed: ${res.status} ${errText}`);
        if (isCanary) {
            CANARY_ERRORS.push({ code: res.status, msg: errText, advice: 'HTTP Error' });
        }
        return false;
    } else {
        const body = await res.json();
        if (body.errcode !== 0) {
            let advice = 'Check WeCom documentation';
            if (body.errcode === 93000) advice = 'Invalid webhook URL / Robot removed from group';
            if (body.errcode === 45009) advice = 'API frequency out of limit (Max 20/min)';
            if (body.errcode === 40058) advice = 'Content exceeds max length (4096)';
            
            console.error(`\x1b[31m[WeCom] ERROR: errcode=${body.errcode} errmsg=${body.errmsg}\x1b[0m`);
            console.error(`\x1b[31m[WeCom] ADVICE: ${advice}\x1b[0m`);
            
            if (isCanary) {
                CANARY_ERRORS.push({ code: body.errcode, msg: body.errmsg, advice });
            }
            return false;
        } else {
            console.log(`[WeCom] Push Success for ${data.title} (errcode=0)`);
            return true;
        }
    }
  } catch (e: any) {
    console.error('[WeCom] Push Network Error:', e);
    if (isCanary) {
        CANARY_ERRORS.push({ code: -1, msg: e.message, advice: 'Network Error' });
    }
    return false;
  }
}
