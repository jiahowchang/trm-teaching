#!/usr/bin/env node
/**
 * sz-rotate.js — 擬真圖書館 SIMZINE 選文換期工具
 *
 * 每月更新時，把「本期」8 篇移進「往期」（SZ_ARCHIVE 最前面），再把新的 8 篇放進本期。
 * 目的是讓每月排程任務只需要產出「新的 8 篇 JSON」，其餘搬移由這支固定腳本處理，
 * 不必每次讓模型重打整個資料區塊（舊做法的失敗點）。
 *
 * 用法：
 *   node tools/sz-rotate.js <new-picks.json> [--month "2026 年 9 月"] [--dry-run]
 *
 * <new-picks.json> 可以是：
 *   (a) 8 篇的陣列：            [ {tag,title_zh,...}, ... ]
 *   (b) 含月份的物件：          { "month": "2026 年 9 月", "items": [ ... ] }
 *
 * 只改動 index.html 中 SZ-PICKS-START / SZ-PICKS-END 之間的內容，標記本身保留。
 * 任何驗證失敗都會直接結束且不寫檔（寧可不更新，也不要把壞資料推上正式站）。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const START = '<!-- SZ-PICKS-START';
const END = '<!-- SZ-PICKS-END -->';
const REQUIRED = ['tag', 'title_zh', 'title_en', 'url', 'digest_zh', 'sections', 'thm'];

function die(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

// ── 參數 ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const monthIdx = argv.indexOf('--month');
const monthArg = monthIdx >= 0 ? argv[monthIdx + 1] : null;
const picksPath = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--month');
if (!picksPath) die('請指定新選文的 JSON 檔：node tools/sz-rotate.js <new-picks.json> [--month "2026 年 9 月"]');

// ── 讀新選文 ──────────────────────────────────────────────────────────
let raw;
try {
  raw = JSON.parse(fs.readFileSync(path.resolve(picksPath), 'utf8'));
} catch (e) {
  die('讀不到或解析不了 ' + picksPath + '：' + e.message);
}
const newItems = Array.isArray(raw) ? raw : raw.items;
const newMonth = monthArg || (Array.isArray(raw) ? null : raw.month);
if (!Array.isArray(newItems)) die('JSON 內找不到選文陣列（需為陣列，或物件內含 items 陣列）');
if (!newMonth) die('沒有月份：請用 --month "2026 年 9 月" 或在 JSON 內提供 month 欄位');
if (newItems.length !== 8) die('本期選文必須恰好 8 篇，目前 ' + newItems.length + ' 篇');

newItems.forEach((p, i) => {
  const miss = REQUIRED.filter(k => !p[k] || (Array.isArray(p[k]) && !p[k].length));
  if (miss.length) die(`第 ${i + 1} 篇（${p.title_en || p.title_zh || '無標題'}）缺欄位：${miss.join(', ')}`);
  if (!Array.isArray(p.thm) || p.thm.length !== 5) die(`第 ${i + 1} 篇的 thm 必須恰好 5 點，目前 ${(p.thm || []).length} 點`);
  if (!Array.isArray(p.sections) || p.sections.length < 2) die(`第 ${i + 1} 篇的 sections 至少 2 段`);
  p.sections.forEach((s, j) => {
    if (!s.h || !s.b) die(`第 ${i + 1} 篇第 ${j + 1} 段缺 h 或 b`);
  });
  if (!/^https:\/\/simzine\.news\//.test(p.url)) die(`第 ${i + 1} 篇的 url 不是 simzine.news 網址：${p.url}`);
  if (typeof p.date !== 'string') p.date = '';
});

const dupUrl = newItems.map(p => p.url).filter((u, i, a) => a.indexOf(u) !== i);
if (dupUrl.length) die('本期選文有重複網址：' + dupUrl.join(', '));

// 「編按：」段＝網站作者的延伸觀點，必須是最後一段且只能有一段（彈窗會用虛線框與原文摘要區隔）
newItems.forEach((p, i) => {
  const noteAt = p.sections.map((s, j) => (/^編按/.test(s.h) ? j : -1)).filter(j => j >= 0);
  if (noteAt.length > 1) die(`第 ${i + 1} 篇有 ${noteAt.length} 段「編按」，最多只能一段`);
  if (noteAt.length === 1 && noteAt[0] !== p.sections.length - 1) die(`第 ${i + 1} 篇的「編按」段必須放在最後`);
});

// 長度只警告不擋稿：寧可版面稍擠，也不要因為幾個字沒換到期
const warn = [];
newItems.forEach((p, i) => {
  const n = i + 1;
  if (p.digest_zh.length < 70 || p.digest_zh.length > 130) warn.push(`第 ${n} 篇 digest_zh 長度 ${p.digest_zh.length}（建議 70~130）`);
  p.thm.forEach((t, j) => { if (t.length > 40) warn.push(`第 ${n} 篇 thm 第 ${j + 1} 點長度 ${t.length}（建議 ≤40）`); });
  p.sections.forEach((s, j) => {
    if (s.h.length > 18) warn.push(`第 ${n} 篇第 ${j + 1} 段標題長度 ${s.h.length}（建議 ≤18）`);
    if (s.b.length < 100 || s.b.length > 220) warn.push(`第 ${n} 篇第 ${j + 1} 段內文長度 ${s.b.length}（建議 100~220）`);
  });
});
if (warn.length) console.warn('⚠ 長度建議（不影響寫入）：\n  ' + warn.join('\n  '));

// ── 讀現況 ────────────────────────────────────────────────────────────
const html = fs.readFileSync(HTML, 'utf8');
const s = html.indexOf(START);
const e = html.indexOf(END);
if (s < 0 || e < 0 || e < s) die('index.html 找不到 SZ-PICKS-START / SZ-PICKS-END 標記');

const block = html.slice(s, e);
const grab = (name) => {
  const m = block.match(new RegExp('window\\.' + name + '\\s*=\\s*([\\s\\S]*?);\\s*\\n'));
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (err) { die(`解析現有的 ${name} 失敗：${err.message}`); }
};
const curItems = grab('SZ_ITEMS') || [];
const curMonth = grab('SZ_MONTH');
const curArchive = grab('SZ_ARCHIVE') || [];

if (curMonth === newMonth) die(`本期已經是「${newMonth}」了，若要重跑請先確認是否真的要覆蓋`);

// 新選文不得與現有本期或往期重複
const seen = new Set();
[curItems, ...curArchive.map(ed => ed.items || [])].forEach(arr => (arr || []).forEach(p => seen.add(p.url)));
const repeats = newItems.filter(p => seen.has(p.url));
if (repeats.length) die('以下選文已收錄過（本期或往期），請重新挑選：\n  ' + repeats.map(p => p.url).join('\n  '));

// ── 換期 ──────────────────────────────────────────────────────────────
const archive = curItems.length && curMonth
  ? [{ month: curMonth, items: curItems }, ...curArchive]
  : curArchive;

const J = (v) => JSON.stringify(v);
const rebuilt =
  '<!-- SZ-PICKS-START (每月10號自動更新區塊，勿手動移除此標記；換期請用 node tools/sz-rotate.js) -->\n' +
  '  <script>\n' +
  '  window.SZ_MONTH = ' + J(newMonth) + ';\n' +
  '  window.SZ_ITEMS = ' + J(newItems) + ';\n' +
  '  window.SZ_ARCHIVE = ' + J(archive) + ';\n' +
  '  </script>\n  ';

const out = html.slice(0, s) + rebuilt + html.slice(e);

console.log('本期：' + curMonth + ' → ' + newMonth);
console.log('往期：' + curArchive.length + ' 期 → ' + archive.length + ' 期（' + archive.map(a => a.month).join('、') + '）');
console.log('新選文：');
newItems.forEach((p, i) => console.log(`  ${i + 1}. [${p.tag}] ${p.title_zh}`));
const total = newItems.length + archive.reduce((n, a) => n + (a.items || []).length, 0);
console.log('館藏合計 ' + total + ' 篇');

if (dryRun) {
  console.log('（--dry-run：未寫入檔案）');
  process.exit(0);
}
fs.writeFileSync(HTML, out, 'utf8');
console.log('✓ 已更新 index.html');
