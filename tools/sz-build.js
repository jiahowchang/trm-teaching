#!/usr/bin/env node
/**
 * sz-build.js — 由 data/simzine/ 組出「擬真圖書館」的 SIMZINE 期刊庫資料區塊
 *
 * 資料來源（repo 內，就是唯一真相）：
 *   data/simzine/issues.json          期別清單 [{issue:"n.23", issue_num:23, date:"2026-06"}, …]
 *   data/simzine/n23/p12.json         每篇一個檔，檔名 p<印刷頁碼>.json
 *
 * 產出：把 index.html 中 SZ-LIB-START / SZ-LIB-END 之間換成
 *   <script>window.SZ_ISSUES = [{issue,date,label,items:[…]}, …];</script>
 * 期別由新到舊；同一期內依印刷頁碼排序。
 *
 * 用法：
 *   node tools/sz-build.js [--dry-run]
 *
 * 新增一期：在 data/simzine/issues.json 加一筆，建 data/simzine/n24/，
 * 把每篇 JSON 放進去，再跑這支即可，不必手改 index.html。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const DATA = path.join(ROOT, 'data', 'simzine');
const START_RE = /<!-- SZ-(?:LIB|PICKS)-START[\s\S]*?-->/;
const END_RE = /<!-- SZ-(?:LIB|PICKS)-END -->/;
const REQUIRED = ['section', 'tag', 'title_zh', 'title_en', 'page', 'digest_zh', 'sections', 'thm'];

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

const dryRun = process.argv.includes('--dry-run');

// ── 讀期別清單 ────────────────────────────────────────────────────────
const issuesPath = path.join(DATA, 'issues.json');
if (!fs.existsSync(issuesPath)) die('找不到 ' + issuesPath);
let issues;
try { issues = JSON.parse(fs.readFileSync(issuesPath, 'utf8')); }
catch (e) { die('issues.json 解析失敗：' + e.message); }
if (!Array.isArray(issues) || !issues.length) die('issues.json 必須是非空陣列');

const label = (d) => {
  const m = /^(\d{4})-(\d{2})$/.exec(d || '');
  return m ? `${m[1]} 年 ${+m[2]} 月` : (d || '');
};

// ── 逐期收文章 ────────────────────────────────────────────────────────
const warn = [];
const out = issues
  .slice()
  .sort((a, b) => b.issue_num - a.issue_num)
  .map(meta => {
    const dir = path.join(DATA, meta.issue.replace('.', ''));
    if (!fs.existsSync(dir)) { warn.push(`${meta.issue}：找不到資料夾 ${dir}，此期略過`); return null; }
    const files = fs.readdirSync(dir).filter(f => /^p\d+\.json$/.test(f))
      .sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
    if (!files.length) { warn.push(`${meta.issue}：資料夾內沒有 p<頁碼>.json，此期略過`); return null; }

    const items = files.map(f => {
      const fp = path.join(dir, f);
      let e;
      try { e = JSON.parse(fs.readFileSync(fp, 'utf8')); }
      catch (err) { die(`${fp} 解析失敗：${err.message}`); }

      // 撰稿時常把整條 https://doi.org/... 填進來，這裡統一收斂成裸 DOI，前端才好組連結
      e.doi = String(e.doi || '').replace(/^\s*https?:\/\/(dx\.)?doi\.org\//i, '').trim();

      const miss = REQUIRED.filter(k => e[k] === undefined || e[k] === '' ||
        (Array.isArray(e[k]) && !e[k].length));
      if (miss.length) die(`${fp} 缺欄位：${miss.join(', ')}`);
      if (!Array.isArray(e.thm) || e.thm.length !== 5) die(`${fp} 的 thm 必須恰好 5 點，目前 ${(e.thm || []).length} 點`);
      if (e.sections.length < 2) die(`${fp} 的 sections 至少 2 段`);
      e.sections.forEach((s, j) => { if (!s.h || !s.b) die(`${fp} 第 ${j + 1} 段缺 h 或 b`); });

      // 「編按：」＝網站作者的延伸觀點，必須是最後一段且只能一段
      const noteAt = e.sections.map((s, j) => (/^編按/.test(s.h) ? j : -1)).filter(j => j >= 0);
      if (noteAt.length > 1) die(`${fp} 有 ${noteAt.length} 段「編按」，最多一段`);
      if (noteAt.length === 1 && noteAt[0] !== e.sections.length - 1) die(`${fp} 的「編按」段必須放在最後`);

      if (e.doi && !/^10\.\d{4,9}\//.test(e.doi)) warn.push(`${meta.issue} p.${e.page}：doi 格式可疑「${e.doi}」`);
      if (e.digest_zh.length < 70 || e.digest_zh.length > 130) warn.push(`${meta.issue} p.${e.page}：digest 長度 ${e.digest_zh.length}（建議 70~130）`);
      e.thm.forEach((t, j) => { if (t.length > 40) warn.push(`${meta.issue} p.${e.page}：thm 第 ${j + 1} 點 ${t.length} 字（建議 ≤40）`); });
      e.sections.forEach((s, j) => {
        if (s.h.length > 18) warn.push(`${meta.issue} p.${e.page}：第 ${j + 1} 段標題 ${s.h.length} 字（建議 ≤18）`);
        if (s.b.length < 100 || s.b.length > 220) warn.push(`${meta.issue} p.${e.page}：第 ${j + 1} 段內文 ${s.b.length} 字（建議 100~220）`);
      });

      return {
        tag: e.tag, section: e.section, title_zh: e.title_zh, title_en: e.title_en,
        authors: e.authors || '', page: e.page, doi: e.doi || '', url: e.url || '', lang: e.lang || 'en',
        digest_zh: e.digest_zh, sections: e.sections, thm: e.thm,
      };
    });

    return { issue: meta.issue, date: meta.date, label: label(meta.date), items };
  })
  .filter(Boolean);

if (!out.length) die('沒有任何一期有資料，不寫檔');

// ── 寫回 index.html ───────────────────────────────────────────────────
const html = fs.readFileSync(HTML, 'utf8');
const ms = START_RE.exec(html);
const me = END_RE.exec(html);
if (!ms || !me || me.index < ms.index) die('index.html 找不到 SZ-LIB-START / SZ-LIB-END（或舊的 SZ-PICKS）標記');

// 期刊庫資料寫成外部 JSON，點進分頁才載（首頁不必背這包）；檔名帶內容雜湊避免舊快取
const json = JSON.stringify(out);
const hash = require('crypto').createHash('sha1').update(json).digest('hex').slice(0, 8);
const JSON_PATH = path.join(ROOT, 'data', 'simzine.json');

const block =
  '<!-- SZ-LIB-START (由 node tools/sz-build.js 產生；資料在 data/simzine.json，勿手動編輯) -->\n' +
  '  <script>\n' +
  '  window.SZ_DATA_URL = "data/simzine.json?v=' + hash + '";\n' +
  '  </script>\n  ';

const total = out.reduce((n, ed) => n + ed.items.length, 0);
console.log(`期別 ${out.length} 期、文章 ${total} 篇`);
out.forEach(ed => console.log(`  ${ed.issue}  ${ed.label}  ${ed.items.length} 篇`));
if (warn.length) console.warn(`⚠ ${warn.length} 則提醒（不影響寫入）：\n  ` + warn.join('\n  '));

console.log(`資料檔 data/simzine.json ${(Buffer.byteLength(json, 'utf8') / 1024).toFixed(0)} KB（版本 ${hash}）`);

if (dryRun) { console.log('（--dry-run：未寫入檔案）'); process.exit(0); }
fs.writeFileSync(JSON_PATH, json, 'utf8');
fs.writeFileSync(HTML, html.slice(0, ms.index) + block + html.slice(me.index), 'utf8');
console.log('✓ 已更新 data/simzine.json 與 index.html');
