import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY,
});

export interface AIAnalysisResult {
  is_relevant: boolean;
  reason: string | null;
  school: string | null;
  site: string | null;
  category: string | null;
  title: string | null;
  publish_date: string | null;
  deadline: string | null;
  summary: string | null;
  key_points: string[];
  url: string;
  canonicalUrl?: string; // Explicit field for original URL
  attachments: { name: string; url: string }[];
  confidence: number;
}

export async function extractInformation(
  text: string,
  url: string,
  sourceName: string,
  debug: boolean = false,
  initialAttachments: { name: string; url: string }[] = []
): Promise<AIAnalysisResult> {
  if (!process.env.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY is not configured');
  }

  const prompt = `
    你是一个专业的高校招生信息结构化提取助手。请根据输入的文章内容，严格按照 JSON Schema 提取信息。
    你必须只输出一个 JSON 对象本身，不得输出任何多余的解释、前后缀或非 JSON 文本。
    
    【判定规则】
    1. **相关性判定 (is_relevant)**：
       - 必须是“具体的招生公告/通知/新闻”。
       - 负面词过滤：如果标题或正文包含 "首页"、"站点地图"、"联系我们"、"学校概况"、"机构设置"、"历史沿革"、"搜索"、"版权"、"友情链接" 等，直接标记为 false。
       - 长度过滤：如果正文少于 50 字，标记为 false。
    2. **分类 (category)**：
       - 优先匹配：强基计划、招生章程、分数线、专项计划、保送生、艺术体育、录取名单、公示。
       - 其他归类为：日常通知、新闻动态。
    3. **提取要求**：
       - title: 必须是文章的**具体标题**（如“2025年艺术类招生简章”），严禁使用“招生动态”、“通知公告”等栏目名作为标题。如果标题包含站点名称（如“中央民族大学 - 2025招生章程”），请去掉站点名称，只保留核心标题。
       - school: 提取大学名称（如“中央民族大学”），不要包含“本科招生网”、“教务处”等后缀。如果文中未明确，可参考源名称 "${sourceName}" 进行推断，但要去掉非校名部分。
       - publish_date: 提取文章的**发布日期** (YYYY-MM-DD)。优先查找标题下方或正文开头的日期。严禁使用页脚的版权日期（如“Copyright 2025”通常不是发布日期）。如果找不到具体日期，设为 null。
       - summary: 简明扼要，80字以内。不要使用“本文介绍了...”这种套话，直接陈述核心内容（如“发布了2025年艺术类招生简章，报名时间为1月15日-20日”）。
       - key_points: 提取 0-3 个核心要点（如报名条件、时间节点、重要变化）。
       - deadline: 提取明确的截止日期（YYYY-MM-DD），如果没有则 null。
       - attachments: 提取文中提及的附件（名称和链接，链接需结合上下文，如果只有名称则只填名称）。注意：输入文本可能不包含完整链接，仅提取文本中可见的附件名即可，或者如果输入了 attachment 列表，请整合。
    
    【JSON Schema】
    {
      "is_relevant": boolean,
      "reason": "判断依据",
      "school": "学校名称",
      "site": "${sourceName}",
      "category": "分类",
      "title": "核心标题",
      "publish_date": "发布日期 (YYYY-MM-DD)",
      "deadline": "截止日期 (YYYY-MM-DD) 或 null",
      "summary": "摘要 (<=80字)",
      "key_points": ["要点1", "要点2"],
      "url": "${url}",
      "attachments": [{"name": "附件名", "url": "链接"}],
      "confidence": 0.0-1.0
    }

    【输入内容】
    ${text.substring(0, 8000)}
  `;

  const maxAttempts = 2;
  let lastError: unknown = null;

  const filterAttachments = (attachments: { name: string; url: string }[]): {
    name: string;
    url: string;
  }[] => {
    const exts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'zip', 'rar'];
    const seen = new Set<string>();
    const result: { name: string; url: string }[] = [];
    const trustedUrls = new Set(initialAttachments.map(a => a.url));

    for (const att of attachments || []) {
      if (!att || !att.url) continue;
      const rawUrl = att.url;
      const urlNoFragment = rawUrl.split('#')[0].split('?')[0];
      const lower = urlNoFragment.toLowerCase();
      
      // Allow if extension matches OR if it's a trusted initial attachment
      const matched = exts.some(ext => lower.endsWith('.' + ext));
      const isTrusted = trustedUrls.has(rawUrl) || trustedUrls.has(urlNoFragment);
      
      if (!matched && !isTrusted) continue;

      const key = `${att.name || ''}||${urlNoFragment}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        name: att.name || urlNoFragment.split('/').pop() || 'Attachment',
        url: urlNoFragment, // Note: We might want to keep query params for dynamic downloads
      });
    }

    // Ensure all trusted initial attachments are included if not already
    // (In case AI didn't return them in its list)
    for (const initAtt of initialAttachments) {
         const rawUrl = initAtt.url;
         const urlNoFragment = rawUrl.split('#')[0].split('?')[0];
         const key = `${initAtt.name || ''}||${urlNoFragment}`;
         
         if (!seen.has(key)) {
             seen.add(key);
             result.push(initAtt);
         }
    }

    return result;
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: 'You are a strict JSON extractor. Output ONLY valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0].message.content;
      if (!content) throw new Error('No content generated');

      if (debug && attempt === 1) {
        console.log('DeepSeek raw JSON response:', content);
      }

      const result = JSON.parse(content) as AIAnalysisResult;

      // Merge initial attachments (from Crawler)
      if (initialAttachments && initialAttachments.length > 0) {
        result.attachments = [...(result.attachments || []), ...initialAttachments];
      }

      result.url = url;
      result.attachments = filterAttachments(result.attachments || []);

      return result;
    } catch (e) {
      lastError = e;
      console.error(`AI Extraction Error (attempt ${attempt}):`, e);
      if (attempt === maxAttempts) {
        break;
      }
    }
  }

  console.error('AI Extraction failed after retries, marking for manual review:', lastError);
  return {
    is_relevant: false,
    reason: 'AI Parsing Failed - Requires Manual Review',
    school: null,
    site: sourceName,
    category: null,
    title: null,
    publish_date: null,
    deadline: null,
    summary: null,
    key_points: [],
    url: url,
    attachments: [],
    confidence: 0
  };
}
