import Parser from 'rss-parser';
import prisma from './prisma';
import crypto from 'crypto';
import { extractInformation } from './ai';
import { Crawler } from './crawler';
import { pushToWeCom } from './push';
import * as cheerio from 'cheerio';
import { PUSH_LIMITS } from './pushConfig';

const parser = new Parser();
// const crawler = new Crawler();

function computeHash(title: string, pubDate: Date, content: string) {
  const hashContent = `${title}${pubDate}${content.substring(0, 500)}`;
  return crypto.createHash('md5').update(hashContent).digest('hex');
}

async function checkDuplicate(sourceId: string, url: string, hash: string) {
  const existing = await prisma.item.findUnique({
    where: {
      sourceId_canonicalUrl: {
        sourceId,
        canonicalUrl: url,
      },
    },
  });

  if (existing && existing.hash === hash) {
    return true;
  }
  return false;
}

type PushDecision = 'PUSH' | 'QUEUE_ONLY' | 'SKIP';

function getMaxPushAgeDays() {
  const raw = process.env.MAX_PUSH_AGE_DAYS;
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!raw || Number.isNaN(n) || n <= 0) return 30;
  return n;
}

function isTooOldToPush(publishedAt: Date) {
  const days = getMaxPushAgeDays();
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return publishedAt.getTime() < cutoff;
}

const ANTI_BOT_KEYWORDS = [
  '您的IP地址最近有可疑的攻击行为',
  '黑名单',
  '可疑攻击',
  '访问受限',
];

const ANTI_BOT_PREFIX = 'AntiBotBlocked:';
const ANTI_BOT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function detectAntiBot(html: string): string | null {
  for (const keyword of ANTI_BOT_KEYWORDS) {
    if (html.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

function parseAntiBotBlockedAt(message: string | null): Date | null {
  if (!message) return null;
  if (!message.includes(ANTI_BOT_PREFIX)) return null;
  const idx = message.lastIndexOf(' at ');
  if (idx === -1) return null;
  const ts = message.substring(idx + 4).trim();
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function isWithinAntiBotCooldown(message: string | null): boolean {
  const blockedAt = parseAntiBotBlockedAt(message);
  if (!blockedAt) return false;
  return Date.now() - blockedAt.getTime() < ANTI_BOT_COOLDOWN_MS;
}

interface IngestOptions {
  dryRun?: boolean;
  sourceName?: string;
}

interface IngestStats {
  fetched: number;
  upserted: number;
  dedupSkipped: number;
  pushed: number;
  skippedByLimit: number;
  auditsWritten: number;
  errors: number;
  skippedTooOld: number;
  skippedByQuality: number;
}

function shouldSkipNonAnnouncement(sourceName: string, title: string, url: string): { skip: boolean; reason?: string } {
  if (sourceName !== '中央民族大学-通知公告') return { skip: false };
  const t = (title || '').trim();
  const u = (url || '').trim();

  // 1) 标题黑名单
  const badTitleKeywords = ['联系', '联系方式', '联系我们', '录取分数', '分数线', '学院', '招生计划', '历史数据', '查询系统', '登录'];
  if (badTitleKeywords.some(k => t.includes(k))) {
    return { skip: true, reason: 'NON_ANNOUNCEMENT_TITLE' };
  }

  // 2) URL 形态黑名单 (reserved)
  // const badUrlKeywords = ['/content/zs/ysl/', '/content/zs/'];
  return { skip: false };
}

async function getRecentPushCountForSource(
  sourceId: string,
  windowMinutes: number
) {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const client: any = prisma;
  const count = await client.auditLog.count({
    where: {
      item: {
        sourceId,
      },
      action: 'PUSH_WECOM',
      createdAt: {
        gte: since,
      },
    },
  });
  return count;
}

async function recordPushAudit(itemId: string | null, result: string, reason: string | null = null) {
  const client: any = prisma;
  await client.auditLog.create({
    data: {
      itemId,
      action: 'PUSH_WECOM',
      result,
      reason,
      originalData: '',
      reviewer: 'system',
      isImportant: false,
    },
  });
}

async function pushWithLimits(
  sourceId: string,
  itemId: string | null,
  aiResult: any,
  context: {
    taskNewCount: number;
    taskPushedSoFar: number;
  },
  stats?: IngestStats
): Promise<PushDecision> {
  const { perTaskMaxPush, perSourceWindowMinutes, perSourceWindowMaxPush, bigBatchThreshold } =
    PUSH_LIMITS;

  if (context.taskNewCount > bigBatchThreshold) {
    console.log(
      `Ingest for source ${sourceId}: 本次新增 ${context.taskNewCount} 条，触发大批量降级，仅入审核（疑似规则/站点结构变化）。`
    );
    if (itemId) {
      await recordPushAudit(itemId, 'DOWNGRADED_BIG_BATCH', null);
      if (stats) stats.auditsWritten++;
    }
    return 'QUEUE_ONLY';
  }

  if (context.taskPushedSoFar >= perTaskMaxPush) {
    console.log(
      `Ingest for source ${sourceId}: 本次任务推送已达上限 ${perTaskMaxPush} 条，其余仅入审核。`
    );
    if (itemId) {
      await recordPushAudit(itemId, 'SKIP_PER_TASK_LIMIT', null);
      if (stats) stats.auditsWritten++;
    }
    return 'QUEUE_ONLY';
  }

  const recentCount = await getRecentPushCountForSource(
    sourceId,
    perSourceWindowMinutes
  );
  if (recentCount >= perSourceWindowMaxPush) {
    console.log(
      `Ingest for source ${sourceId}: 最近 ${perSourceWindowMinutes} 分钟已推送 ${recentCount} 条，超过阈值 ${perSourceWindowMaxPush}，本条仅入审核。`
    );
    if (itemId) {
      await recordPushAudit(itemId, 'SKIP_PER_SOURCE_WINDOW', null);
      if (stats) stats.auditsWritten++;
    }
    return 'QUEUE_ONLY';
  }

  try {
    const success = await pushToWeCom(aiResult);
    if (success) {
      if (itemId) {
        await recordPushAudit(itemId, 'PUSHED', null);
        if (stats) stats.auditsWritten++;
      }
      return 'PUSH';
    } else {
       console.warn(`[Ingest] Push failed for ${itemId}, will NOT update pushedAt.`);
       if (itemId) {
         await recordPushAudit(itemId, 'ERROR', 'WECOM_API_FAIL');
         if (stats) stats.auditsWritten++;
       }
       return 'SKIP';
    }
  } catch (e: any) {
    console.error('WeCom push error with limits:', e);
    if (itemId) {
      await recordPushAudit(itemId, 'ERROR', e?.message || 'PUSH_FAILED');
      if (stats) stats.auditsWritten++;
    }
    return 'SKIP';
  }
}

export async function ingestAll(options: IngestOptions = {}) {
  const where: any = { isActive: true };
  if (options.sourceName) {
    where.name = options.sourceName;
  }
  const sources = await prisma.source.findMany({ where });
  const results: any[] = [];
  const globalStats: IngestStats = {
    fetched: 0,
    upserted: 0,
    dedupSkipped: 0,
    pushed: 0,
    skippedByLimit: 0,
    auditsWritten: 0,
    errors: 0,
    skippedTooOld: 0,
    skippedByQuality: 0,
  };

  console.log(`Starting ingest with options: ${JSON.stringify(options)}`);

  for (const source of sources) {
    const statsForSource: IngestStats = {
      fetched: 0,
      upserted: 0,
      dedupSkipped: 0,
      pushed: 0,
      skippedByLimit: 0,
      auditsWritten: 0,
      errors: 0,
      skippedTooOld: 0,
      skippedByQuality: 0,
    };

    if (isWithinAntiBotCooldown(source.lastError as any)) {
      console.log(`Source ${source.name} is under AntiBot cooldown, skipping fetch.`);
      statsForSource.errors++;
      await prisma.source.update({
        where: { id: source.id },
        data: {
          lastRunStats: JSON.stringify(statsForSource) as any,
        } as any,
      });
      globalStats.fetched += statsForSource.fetched;
      globalStats.upserted += statsForSource.upserted;
      globalStats.dedupSkipped += statsForSource.dedupSkipped;
      globalStats.pushed += statsForSource.pushed;
      globalStats.skippedByLimit += statsForSource.skippedByLimit;
      globalStats.auditsWritten += statsForSource.auditsWritten;
      globalStats.errors += statsForSource.errors;
      globalStats.skippedTooOld += statsForSource.skippedTooOld;
      globalStats.skippedByQuality += statsForSource.skippedByQuality;
      continue;
    }

    try {
      if (source.type === 'RSS') {
        await processRSS(source, results, statsForSource, options);
      } else {
        await processHTML(source, results, statsForSource, options);
      }

      // Only update lastFetchedAt if not dryRun
      if (!options.dryRun) {
        await prisma.source.update({
            where: { id: source.id },
            data: { 
              lastFetchedAt: new Date(),
              lastError: null as any,
              lastRunStats: JSON.stringify(statsForSource) as any,
            } as any,
        });
      } else {
        await prisma.source.update({
          where: { id: source.id },
          data: {
            lastRunStats: JSON.stringify(statsForSource) as any,
          } as any,
        });
      }
    } catch (e) {
      console.error(`Failed to ingest source ${source.name}:`, e);
      statsForSource.errors++;
      await prisma.source.update({
        where: { id: source.id },
        data: {
          lastError: (e instanceof Error ? e.message : String(e)) as any,
          lastRunStats: JSON.stringify(statsForSource) as any,
        } as any,
      });
    }

    globalStats.fetched += statsForSource.fetched;
    globalStats.upserted += statsForSource.upserted;
    globalStats.dedupSkipped += statsForSource.dedupSkipped;
    globalStats.pushed += statsForSource.pushed;
    globalStats.skippedByLimit += statsForSource.skippedByLimit;
    globalStats.auditsWritten += statsForSource.auditsWritten;
    globalStats.errors += statsForSource.errors;
    globalStats.skippedTooOld += statsForSource.skippedTooOld;
  }

  console.log(
    `Ingest Summary: fetched ${globalStats.fetched} / upserted ${globalStats.upserted} / ` +
    `dedupSkipped ${globalStats.dedupSkipped} / auditsWritten ${globalStats.auditsWritten} / ` +
    `pushed ${globalStats.pushed} / skippedByLimit ${globalStats.skippedByLimit} / skippedTooOld ${globalStats.skippedTooOld}`
  );
  return { results, stats: globalStats };
}

async function processRSS(source: any, results: any[], stats: IngestStats, options: IngestOptions) {
    try {
      const feed = await parser.parseURL(source.url);
      const items = feed.items.slice(0, 20);
      let taskNewCount = 0;
      let taskPushedSoFar = 0;

      for (const item of items) {
         if (!item.link) continue;
         stats.fetched++;
         
         // 2. Content
         const content = item.content || item['content:encoded'] || item.summary || item.title || '';
         const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();

         // Pre-check for duplicate to avoid expensive AI call
         const preHashTitle = item.title || 'No Title';
         const hash = computeHash(preHashTitle, pubDate, content);
         if (await checkDuplicate(source.id, item.link, hash)) {
             stats.dedupSkipped++;
             console.log(`[Ingest][RSS] Skipped duplicate for ${item.link}`);
             continue;
         }

         const aiResult = await extractInformation(content, item.link, source.name);

         const finalTitle = item.title || aiResult.title || 'No Title';

         const saved = await upsertItem(
           source,
           item.link,
           finalTitle,
           content,
           pubDate,
           aiResult,
           aiResult.is_relevant ? 'PENDING' : 'SKIPPED',
           aiResult.is_relevant ? null : 'AI_NOT_RELEVANT'
         );

         if (!saved) {
            stats.dedupSkipped++;
            console.log(`[Ingest][RSS] Skipped duplicate for ${item.link}`);
            continue; 
         }

         if (isTooOldToPush(saved.publishedAt || pubDate)) {
           stats.skippedTooOld++;
           await prisma.item.update({
             where: { id: saved.id },
             data: {
               status: 'SKIPPED',
               skipReason: 'TOO_OLD_TO_PUSH',
             },
           });
           continue;
         }

         taskNewCount += 1;
         results.push(saved);
         stats.upserted++;
         const itemId = saved.id;

         if (saved.pushedAt) {
           console.log(`[Ingest][RSS] Skip push for already pushed item ${itemId}`);
           await recordPushAudit(itemId, 'SKIP_ALREADY_PUSHED', 'ALREADY_PUSHED');
           stats.skippedByLimit++;
           continue;
         }

             // Push Logic
             if (options.dryRun) {
                stats.skippedByLimit++;
                continue;
             }

            // Global Safety Valve
            const globalLimit = process.env.MAX_PUSH_PER_RUN ? parseInt(process.env.MAX_PUSH_PER_RUN) : 10;
            if (stats.pushed >= globalLimit) {
                 console.warn(`[Ingest] Global push limit (${globalLimit}) reached. Skipping push for ${itemId}`);
                 stats.skippedByLimit++;
                 continue;
             }

            // Pass canonicalUrl explicitly
            if (saved.canonicalUrl) {
                aiResult.canonicalUrl = saved.canonicalUrl;
            }

            // Pass canonicalUrl explicitly
            if (saved.canonicalUrl) {
                aiResult.canonicalUrl = saved.canonicalUrl;
            }

            // Pass canonicalUrl explicitly
            if (saved.canonicalUrl) {
                aiResult.canonicalUrl = saved.canonicalUrl;
            }

            // Pass canonicalUrl explicitly
            if (saved.canonicalUrl) {
                aiResult.canonicalUrl = saved.canonicalUrl;
            }

            // Pass canonicalUrl explicitly
            if (saved.canonicalUrl) {
                aiResult.canonicalUrl = saved.canonicalUrl;
            }

            // Pass canonicalUrl explicitly
            if (saved.canonicalUrl) {
                aiResult.canonicalUrl = saved.canonicalUrl;
            }

            // Pass canonicalUrl explicitly
            if (saved.canonicalUrl) {
                aiResult.canonicalUrl = saved.canonicalUrl;
            }

            const decision = await pushWithLimits(
              source.id,
              itemId,
              aiResult,
              {
                taskNewCount,
                taskPushedSoFar,
              },
              stats
            );
             
             if (decision === 'PUSH') {
               taskPushedSoFar += 1;
               stats.pushed++;
               // Mark as pushed
               await prisma.item.update({
                   where: { id: itemId },
                   data: { pushedAt: new Date() } as any,
               });
             } else {
                if (decision === 'QUEUE_ONLY') {
                  stats.skippedByLimit++;
                }
             }
      }
    } catch (e) {
        console.error(`RSS Error ${source.url}:`, e);
        stats.errors++;
    }
}

async function processHTML(source: any, results: any[], stats: IngestStats, options: IngestOptions) {
    let config: any = {};
    try {
        config = JSON.parse(source.crawlConfig || '{}');
    } catch (e) {
        config = {};
    }

    if (source.name === '清华大学-通知公告') {
        if (!config.detailPattern || config.detailPattern === 'https://www\\.join-tsinghua\\.edu\\.cn/.*') {
            config.detailPattern = 'https://www\\.join-tsinghua\\.edu\\.cn/info/.*\\.htm';
        }
    }

    // Patch for TJU to exclude navigation links and finding real items
    if (source.name === '天津大学-通知公告') {
        // Original: https://zs\\.tju\\.edu\\.cn/ym21/bkzn/.*
        // New: Match /info/ (real items) OR list page itself, exclude ztzs/gspydd
        config.detailPattern = 'https://zs\\.tju\\.edu\\.cn/(info/.*|ym21/bkzn/tzgg\\.htm)';
    }

    const crawler = new Crawler(config);

    const listUrls = config.listUrls && config.listUrls.length > 0 ? config.listUrls : [source.url];
    
    for (const listUrl of listUrls) {
        let listRes = await crawler.fetch(listUrl, source.etag, source.lastModified);

        if ((listRes.status === 403 || listRes.status === 412) && config.headers) {
            console.log(`[Ingest][HTML] ${source.name} list ${listUrl} returned ${listRes.status}, retrying with headers.`);
            listRes = await crawler.fetch(listUrl, source.etag, source.lastModified, config.headers);
        }
        
        if (listRes.status === 304) {
            console.log(`Source ${source.name} (List) not modified.`);
            continue;
        }

        if (listRes.status !== 200 || !listRes.content) {
            stats.errors++;
            console.error(`List fetch failed for ${source.name}: ${listUrl} (status=${listRes.status})`);
            if (listRes.content) {
                const keyword = detectAntiBot(listRes.content);
                if (keyword) {
                    const ts = new Date().toISOString();
                    throw new Error(`AntiBotBlocked: keyword=${keyword} url=${listUrl} at ${ts}`);
                }
            }
            continue;
        }

        if (listRes.content) {
            const keyword = detectAntiBot(listRes.content);
            if (keyword) {
                const ts = new Date().toISOString();
                throw new Error(`AntiBotBlocked: keyword=${keyword} url=${listUrl} at ${ts}`);
            }
        }

        if (listUrl === source.url && !options.dryRun) {
            await prisma.source.update({
                where: { id: source.id },
                data: {}
            });
        }

        const items = crawler.parseList(listRes.content, listUrl, config);
        let taskNewCount = 0;
        let taskPushedSoFar = 0;

        for (const item of items) {
            const link = item.url;
            stats.fetched++;

            // Quality Check
            const qualityCheck = shouldSkipNonAnnouncement(source.name, item.title || '', link);
            if (qualityCheck.skip) {
                console.log(`[QualitySkip] source=${source.name} reason=${qualityCheck.reason} title=${item.title} url=${link}`);
                stats.skippedByQuality++;
                
                // Still upsert as SKIPPED to record it
                const pubDate = item.date || new Date();
                const digest = {
                    title: item.title || '',
                    body_text: '',
                    publish_date: pubDate.toISOString().split('T')[0],
                    is_relevant: false,
                    confidence: 0,
                    url: link,
                    source_name: source.name,
                    tags: [],
                    attachments: [],
                };
                
                await upsertItem(
                    source,
                    link,
                    item.title || '',
                    '',
                    pubDate,
                    digest,
                    'SKIPPED',
                    qualityCheck.reason
                );
                continue;
            }

            if (listUrls.some((u: string) => u === link || u.replace(/\/$/, '') === link.replace(/\/$/, ''))) {
                const pubDate = item.date || new Date();
                const title = item.title || '列表页';
                const digest = {
                    title,
                    body_text: '',
                    publish_date: pubDate.toISOString().split('T')[0],
                    is_relevant: false,
                    confidence: 0,
                    url: link,
                    source_name: source.name,
                    tags: [],
                    attachments: [],
                };

                // Force update even if hash matches, to correct status
                const hashContent = `${title}${pubDate}${''}`;
                const hash = crypto.createHash('md5').update(hashContent).digest('hex');

                const existing = await prisma.item.findUnique({
                    where: { sourceId_canonicalUrl: { sourceId: source.id, canonicalUrl: link } }
                });

                if (existing) {
                     await prisma.item.update({
                        where: { id: existing.id },
                        data: {
                            title,
                            publishedAt: pubDate,
                            rawText: '',
                            hash,
                            status: 'SKIPPED',
                            skipReason: 'LIST_PAGE_NOT_DETAIL',
                            digest: JSON.stringify(digest)
                        }
                    });
                } else {
                     await upsertItem(
                        source,
                        link,
                        title,
                        '',
                        pubDate,
                        digest,
                        'SKIPPED',
                        'LIST_PAGE_NOT_DETAIL'
                      );
                }

                stats.dedupSkipped++;
                console.log(`[Ingest][HTML] Skipped list page as detail for ${link} (updated status)`);
                continue;
            }

            let detailRes = await crawler.fetch(link);

            if ((detailRes.status === 403 || detailRes.status === 412) && config.headers) {
                console.log(`[Ingest][HTML] ${source.name} detail ${link} returned ${detailRes.status}, retrying with headers.`);
                detailRes = await crawler.fetch(link, undefined, undefined, config.headers);
            }

            if (detailRes.content) {
                const keyword = detectAntiBot(detailRes.content);
                if (keyword) {
                    const ts = new Date().toISOString();
                    throw new Error(`AntiBotBlocked: keyword=${keyword} url=${link} at ${ts}`);
                }
            }

            if (detailRes.status !== 200 || !detailRes.content) {
                stats.errors++;
                console.error(`Detail fetch failed for ${source.name}: ${link} (status=${detailRes.status})`);
                continue;
            }

            const parsed = crawler.parseDetail(detailRes.content, link, config.selectors);

            // Hard protection for bad正文 (Navigation/List pages masquerading as details)
            // Only apply if content is short, otherwise we might skip real articles mentioning these words.
            const navigationWords = ['招生章程', '名单公示', '录取查询', '历年录取分数线'];
            const body = parsed.content;
            
            // If body is long (> 1000 chars), assume it's valid content even if it contains keywords.
            // If body is short (< 1000 chars), check for navigation keywords.
            const isShort = body.length < 1000;
            const hasNavWords = navigationWords.some(w => body.includes(w));
            
            if ((isShort && hasNavWords) || (body.length < 200 && body.includes('导航'))) {
                console.log(`Skipping ${link}: Content looks like navigation (short + keywords).`);
                 await upsertItem(
                  source,
                  link,
                  parsed.title || item.title || 'No Title',
                  body,
                  parsed.date || item.date || new Date(),
                  {
                    title: parsed.title || item.title || 'No Title',
                    body_text: body,
                    publish_date: (parsed.date || item.date || new Date()).toISOString().split('T')[0],
                    is_relevant: false,
                    confidence: 0,
                    url: link, // Force digest.url to canonicalUrl
                    source_name: source.name,
                    tags: [],
                    attachments: [],
                  },
                  'SKIPPED',
                  'DETAIL_PARSE_FAILED'
                );
                stats.dedupSkipped++; 
                continue;
            }

            if (parsed.content.length < 50) {
                console.log(`Skipping ${link}: Content too short.`);
                continue;
            }

            // Pre-check for duplicate to avoid expensive AI call
            const preTitle = parsed.title || item.title || 'No Title';
            const preDate = parsed.date || item.date || new Date();
            const hash = computeHash(preTitle, preDate, parsed.content);
            
            if (await checkDuplicate(source.id, link, hash)) {
                stats.dedupSkipped++;
                console.log(`[Ingest][HTML] Skipped duplicate for ${link}`);
                continue;
            }

            const aiResult = await extractInformation(parsed.content, link, source.name);

            // Force digest.url to canonicalUrl to prevent AI from Hallucinating (e.g. login page)
            // Fix for TJU: Force original_url = source_url (Scheme A)
            if (source.name === '天津大学-通知公告') {
                console.log(`[TJU Fix] Forcing original_url to source_url for ${link}`);
                console.log(`[TJU Debug] source_url=${source.url}, extracted_title=${parsed.title || item.title}, extracted_original_url=${link}`);
                aiResult.url = source.url;
            } else if (source.name === '浙江大学-最新公告') {
                // Fix for ZJU: Force original_url = source_url (Scheme A)
                console.log(`[ZJU Fix] Forcing original_url to source_url for ${link}`);
                console.log(`[ZJU Debug] source_url=${source.url}, extracted_original_url=${link}, picked_anchor_text=${item.title || 'N/A'}`);
                
                aiResult.url = source.url;

                // Double Insurance: Revert pagination links if they somehow sneak in
                if (link.match(/\/zxgg\/list\d+\.(psp|htm)/)) {
                     console.log(`[ZJU Fix] Detected pagination link ${link}, reverting to ${source.url}`);
                     aiResult.url = source.url;
                }
            } else {
                aiResult.url = link;
            }

            if (!aiResult.publish_date) {
                if (item.date) {
                    aiResult.publish_date = item.date.toISOString().split('T')[0];
                } else if (parsed.date) {
                    aiResult.publish_date = parsed.date.toISOString().split('T')[0];
                }
            }
            if (!aiResult.title) {
                if (item.title) {
                    aiResult.title = item.title;
                } else if (parsed.title) {
                    aiResult.title = parsed.title;
                }
            }

            const finalTitle = aiResult.title || parsed.title || item.title || 'No Title';
            const finalDate = parsed.date || item.date || new Date();

            const saved = await upsertItem(
              source,
              link,
              finalTitle,
              parsed.content,
              finalDate,
              aiResult,
              aiResult.is_relevant ? 'PENDING' : 'SKIPPED',
              aiResult.is_relevant ? null : 'AI_NOT_RELEVANT'
            );

            if (!saved) {
              stats.dedupSkipped++;
              console.log(`[Ingest][HTML] Skipped duplicate for ${link}`);
              continue;
            }

            if (isTooOldToPush(saved.publishedAt || finalDate)) {
              stats.skippedTooOld++;
              await prisma.item.update({
                where: { id: saved.id },
                data: {
                  status: 'SKIPPED',
                  skipReason: 'TOO_OLD_TO_PUSH',
                },
              });
              continue;
            }

            taskNewCount += 1;
            results.push(saved);
            stats.upserted++;
            const itemId = saved.id;

            if (saved.pushedAt) {
              console.log(`[Ingest][HTML] Skip push for already pushed item ${itemId}`);
              await recordPushAudit(itemId, 'SKIP_ALREADY_PUSHED', 'ALREADY_PUSHED');
              stats.skippedByLimit++;
              continue;
            }

            // Push Logic
            if (options.dryRun) {
               stats.skippedByLimit++;
               continue;
            }

            // Global Safety Valve
            const globalLimit = process.env.MAX_PUSH_PER_RUN ? parseInt(process.env.MAX_PUSH_PER_RUN) : 10;
            if (stats.pushed >= globalLimit) {
                console.warn(`[Ingest] Global push limit (${globalLimit}) reached. Skipping push for ${itemId}`);
                stats.skippedByLimit++;
                continue;
            }

            const decision = await pushWithLimits(
              source.id,
              itemId,
              aiResult,
              {
                taskNewCount,
                taskPushedSoFar,
              },
              stats
            );
            if (decision === 'PUSH') {
              taskPushedSoFar += 1;
              stats.pushed++;
              // Mark as pushed
              await prisma.item.update({
                  where: { id: itemId },
                  data: { pushedAt: new Date() } as any,
              });
            } else if (decision === 'QUEUE_ONLY') {
              stats.skippedByLimit++;
            }
        }
    }
}

function parseListDate(text: string): Date | null {
    const m = text.match(/(\d{4})[.\-\/](\d{2})[.\-\/](\d{2})/);
    if (!m) return null;
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
    return new Date(year, month - 1, day);
}

async function upsertItem(
    source: any, 
    url: string, 
    title: string, 
    content: string, 
    pubDate: Date, 
    aiResult: any,
    status: string = 'PENDING',
    skipReason: string | null = null
) {
  // Hash generation
  const hashContent = `${title}${pubDate}${content.substring(0, 500)}`;
  const hash = crypto.createHash('md5').update(hashContent).digest('hex');

  const existing = await prisma.item.findUnique({
    where: {
      sourceId_canonicalUrl: {
        sourceId: source.id,
        canonicalUrl: url,
      },
    },
  });

  if (existing && existing.hash === hash) {
    return null;
  }

  const data = {
    title,
    url,
    canonicalUrl: url,
    publishedAt: pubDate,
    rawText: content,
    sourceId: source.id,
    hash,
    status,
    digest: JSON.stringify(aiResult),
    skipReason: skipReason ?? null,
  };

  if (existing) {
    return prisma.item.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.item.create({ data });
}
