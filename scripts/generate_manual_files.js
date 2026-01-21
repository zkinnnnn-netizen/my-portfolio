
const fs = require('fs');
const path = require('path');

const rawData = [
  ["北京大学", "https://www.gotopku.cn/tzgg/index.htm"],
  ["北京航空航天大学", "https://zs.buaa.edu.cn/tzgg.htm"],
  ["北京理工大学", "https://admission.bit.edu.cn/f/newsCenter/articles/0278fac54ee5438f8d16717a277d38eb"],
  ["北京师范大学-通知公告", "https://admission.bnu.edu.cn/sdkx/index.html"],
  ["北京师范大学-简章章程", "https://admission.bnu.edu.cn/zsxx/index.html"],
  ["重庆大学", "https://zhaosheng.cqu.edu.cn/pub/desktopend/listnews?type=2&condition=Bulletin"],
  ["大连理工大学", "https://zs.dlut.edu.cn/zsNews"],
  ["电子科技大学", "https://zs.uestc.edu.cn/category/7.html"],
  ["东北大学", "http://zs.neu.edu.cn/zsdt1/list.htm"],
  ["东南大学", "https://zsb.seu.edu.cn/_s85/zxdt_23610/listm.psp"],
  ["复旦大学-招生动态", "https://ao.fudan.edu.cn/36331/list.htm"],
  ["复旦大学-招生政策", "https://ao.fudan.edu.cn/36330/list.htm"],
  ["国防科技大学", "https://www.nudt.edu.cn/bkzs/tzgg/index.htm"],
  ["哈尔滨工业大学", "https://zsb.hit.edu.cn/article/category/23d7292fbda0cda71ab7b92374b67c9c"],
  ["湖南大学", "https://admi.hnu.edu.cn/zsxxw/zxdt.htm"],
  ["华南理工大学", "https://admission.scut.edu.cn/30767/list.htm"],
  ["华中科技大学-招生政策", "https://zsb.hust.edu.cn/bkzn/zszc.htm"],
  ["华中科技大学-通知公告", "https://zsb.hust.edu.cn/bkzn/tzgg.htm"],
  ["吉林大学", "https://zsb.jlu.edu.cn/list/2.html"],
  ["兰州大学", "https://zsb.lzu.edu.cn/zhaoshengdongtai/tongzhigonggao/index.html"],
  ["南京大学", "https://bkzs.nju.edu.cn/static/front/nju/basic/html_cms/frontList.html?id=c8673b83bc704353aff9f917cc1e16b2"],
  ["南开大学", "https://zsb.nankai.edu.cn/index/zhaosheng.html"],
  ["清华大学", "https://www.join-tsinghua.edu.cn/zygg.htm"],
  ["厦门大学", "https://zs.xmu.edu.cn/bks.htm"],
  ["山东大学", "https://www.bkzs.sdu.edu.cn/zszc.htm"],
  ["上海交通大学", "https://admissions.sjtu.edu.cn/importantColumnList?title=%E9%87%8D%E8%A6%81%E8%B5%84%E8%AE%AF&id=3810134"],
  ["四川大学", "https://zs.scu.edu.cn/list.jsp?urltype=tree.TreeTempUrl&wbtreeid=1091"],
  ["天津大学", "https://zs.tju.edu.cn/ym21/bkzn/tzgg.htm"],
  ["同济大学", "https://bkzs.tongji.edu.cn/dynamic/notice"],
  ["武汉大学-招生动态", "https://aoff.whu.edu.cn/zsxx1/tzgg.htm"],
  ["武汉大学-招生政策", "https://aoff.whu.edu.cn/zsxx1/zsz.htm"],
  ["西安交通大学", "https://zs.xjtu.edu.cn/zsxx1/zskx.htm"],
  ["西北工业大学", "https://zsb.nwpu.edu.cn/f/newsCenter/articles/d89a663f8c804f6eb3576940f3b25be7"],
  ["西北农林科技大学-招生指南", "https://zhshw.nwsuaf.edu.cn/zszn/zsdt/index.htm"],
  ["西北农林科技大学-招生政策", "https://zhshw.nwsuaf.edu.cn/zszn/zszc/index.htm"],
  ["浙江大学", "https://zdzsc.zju.edu.cn/zxgg/list.htm"],
  ["中国海洋大学-招生快讯", "https://bkzs.ouc.edu.cn/7210/list.htm"],
  ["中国海洋大学-信息公开", "https://bkzs.ouc.edu.cn/xxgk_17825/list.htm"],
  ["中国科学技术大学", "https://zsb.ustc.edu.cn/tzgg/list.htm"],
  ["中国农业大学", "https://jwzs.cau.edu.cn/col/col4528/index.html"],
  ["中国人民大学", "https://rdzs.ruc.edu.cn/cms/item/?cat=72&parent=1"],
  ["中南大学-招生简章", "https://zhaosheng.csu.edu.cn/zsjz/zsjz.htm"],
  ["中南大学-招生资讯", "https://zhaosheng.csu.edu.cn/zszx/zszx.htm"],
  ["中山大学-最新公告", "https://admission.sysu.edu.cn/f/newsCenter/articles/525eb0693a6f4d3a879957b64d214e9c"],
  ["中山大学-政策解读", "https://admission.sysu.edu.cn/f/newsCenter/articles/2932f0e1d1f24d5fa2bfcd5d40aeb9ac"],
  ["中央民族大学", "https://zb.muc.edu.cn/content/zs/9a649c21-f0cf-11ee-a4af-00163e36a0b0.htm"]
];

function processData() {
  const sources = [];
  const seenUrls = new Set();

  for (const [name, url] of rawData) {
    let cleanUrl = url.trim();
    if (!cleanUrl.startsWith('http')) continue;
    
    // Ensure HTTPS only if no protocol specified (user said "补全 https", but we should respect http if given)
    // Actually user said "补全 https", maybe they meant "add https if missing".
    // If it starts with http://, let's keep it if we suspect it doesn't support https, or just keep it as is.
    // But for "补全", I will assume if it has no protocol, add https://.
    // If it has http://, I will leave it alone to be safe.
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    if (seenUrls.has(cleanUrl)) continue;
    seenUrls.add(cleanUrl);

    let finalName = name.trim();
    let categoryTag = "通知公告";

    if (finalName.includes("-")) {
      const parts = finalName.split("-");
      categoryTag = parts[1]; // e.g. "招生动态"
    } else {
      finalName = `${finalName}-通知公告`;
    }

    // Detail pattern inference (simple)
    // If url ends with /, pattern is url + .*
    // If url ends with .htm or .html, remove filename and add .*
    let detailPattern = "";
    try {
      const u = new URL(cleanUrl);
      const path = u.pathname;
      const lastSlash = path.lastIndexOf('/');
      if (lastSlash !== -1) {
        const dir = path.substring(0, lastSlash + 1);
        // Escape special chars for regex
        const origin = u.origin;
        const escapedBase = (origin + dir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        detailPattern = escapedBase + ".*";
      } else {
         detailPattern = cleanUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ".*";
      }
    } catch (e) {
      detailPattern = cleanUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ".*";
    }

    sources.push({
      name: finalName,
      type: "HTML",
      url: cleanUrl,
      regionTag: "CN",
      categoryTag: categoryTag,
      priority: 3,
      isActive: false,
      fetchIntervalMinutes: 60,
      crawlConfig: {
        listUrls: [cleanUrl],
        detailPattern: detailPattern,
        selectors: {}
      }
    });
  }
  return sources;
}

const sources = processData();

// Write JSON
fs.writeFileSync(path.join(__dirname, '../manual_sources.json'), JSON.stringify(sources, null, 2));

// Write CSV
const csvHeader = "name,type,url,regionTag,categoryTag,priority,isActive,fetchIntervalMinutes,crawlConfig\n";
const csvRows = sources.map(s => {
  // Escape quotes in crawlConfig JSON
  const config = JSON.stringify(s.crawlConfig).replace(/"/g, '""');
  return `"${s.name}","${s.type}","${s.url}","${s.regionTag}","${s.categoryTag}",${s.priority},${s.isActive},${s.fetchIntervalMinutes},"${config}"`;
});
fs.writeFileSync(path.join(__dirname, '../manual_sources.csv'), csvHeader + csvRows.join('\n'));

console.log(`Generated ${sources.length} sources.`);
