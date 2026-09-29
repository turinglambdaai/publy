// Build the Publy theme gallery (themes.publy.jrtx.site).
//
// Article themes are presented as LIVE rendered HTML (the actual WeChat-bound
// markup, inline-styled by juice) — zoomable, selectable, switchable per theme
// on the same sample article. Card themes are presented as real rendered PNG
// decks in a swipeable strip plus a full-screen paged lightbox.
//
// Usage: node scripts/build-gallery.mjs <publy-themes-repo-dir>
// The themes repo is written in place (previews/ + index.html); review and push.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const cli = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const themesRepo = path.resolve(process.argv[2] ?? path.join(repoRoot, "..", "publy-themes"));

const ART_THEMES = ["claude", "medium"];
const CARD_THEMES = ["naive", "claude"];

const articleSample = path.join(repoRoot, "packages", "cli", "samples", "article-sample.md");
const cardSample = path.join(repoRoot, "packages", "cli", "samples", "card-sample.md");

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
}

// --- render artifacts --------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "publy-gallery-"));
const previewsDir = path.join(themesRepo, "previews");
fs.mkdirSync(previewsDir, { recursive: true });

const articles = {}; // theme -> html string
for (const theme of ART_THEMES) {
  const out = path.join(tmp, `${theme}.html`);
  run("node", [cli, "render", articleSample, "--theme", theme, "-o", out]);
  articles[theme] = fs.readFileSync(out, "utf-8");
}

const decks = {}; // theme -> [{name, file(published relative), local(abs)}]
for (const theme of CARD_THEMES) {
  const deckDir = path.join(tmp, `cards-${theme}`);
  fs.rmSync(deckDir, { recursive: true, force: true });
  run("node", [cli, "card", cardSample, "--theme", theme, "--out", deckDir]);
  const pubDir = path.join(previewsDir, `cards-${theme}`);
  fs.rmSync(pubDir, { recursive: true, force: true });
  fs.cpSync(deckDir, pubDir, { recursive: true });
  decks[theme] = fs
    .readdirSync(deckDir)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => ({ file: `previews/cards-${theme}/${f}`, label: f.replace(/\.png$/, "") }));
  // cover copy for the registry README / external embeds
  fs.copyFileSync(path.join(deckDir, decks[theme][0].file.split("/").pop()), path.join(previewsDir, `card-${theme}.png`));
}

// article html also published as standalone files (openable directly)
for (const theme of ART_THEMES) {
  fs.writeFileSync(path.join(previewsDir, `${theme}.article.html`), articles[theme]);
}

// --- gallery page -------------------------------------------------------------

const esc = (s) => s.replace(/</g, "&lt;").replace(/&/g, "&amp;");

function articleTemplates() {
  return ART_THEMES.map(
    (t) => `<template id="art-${t}">${articles[t]}</template>`,
  ).join("\n");
}

function deckMarkup() {
  return CARD_THEMES.map((t) => {
    const imgs = decks[t]
      .map((c, i) => `<img src="${c.file}" alt="${t} ${i + 1}" loading="lazy" data-deck="${t}" data-idx="${i}">`)
      .join("\n      ");
    return `
    <div class="theme-block">
      <div class="theme-head"><h3>${t}</h3><button class="mini" onclick="openLightbox('${t}', 0)">全屏翻阅</button></div>
      <div class="deck" id="deck-${t}">
      ${imgs}
      </div>
    </div>`;
  }).join("\n");
}

const articleTabs = ART_THEMES.map(
  (t, i) => `<button class="tab${i === 0 ? " sel" : ""}" onclick="showArticle('${t}', this)">${t}</button>`,
).join("\n      ");

const page = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Publy Theme Gallery</title>
<meta name="description" content="Publy 主题画廊：文章主题以真实渲染 HTML 呈现（同篇对比、可缩放），小绿书卡片以真实发布图滑动预览。">
<style>
  :root { --bg:#111; --card:#1c1c1c; --text:#eee; --muted:#999; --accent:#07C160; --border:#2a2a2a; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 48px 24px 80px; }
  .container { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 26px; margin-bottom: 8px; }
  .lead { color: var(--muted); margin-bottom: 40px; line-height: 1.7; font-size: 14px; }
  .lead code { color: var(--accent); }
  section { margin-bottom: 64px; }
  h2 { font-size: 14px; letter-spacing: 3px; text-transform: uppercase; color: var(--muted); margin-bottom: 18px; }
  .tabs { display: flex; gap: 8px; margin-bottom: 14px; }
  .tab { padding: 8px 22px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 999px; cursor: pointer; font-size: 14px; }
  .tab.sel { border-color: var(--accent); color: var(--accent); background: rgba(7,193,96,.08); }
  .width-toggle { margin-left: auto; display: flex; gap: 6px; }
  .width-toggle button { padding: 8px 14px; font-size: 12px; }
  .width-toggle .sel { border-color: var(--accent); color: var(--accent); }
  .frame-wrap { background: #060606; border: 1px solid var(--border); border-radius: 16px; padding: 18px; display: flex; justify-content: center; overflow: hidden; }
  #article-frame { width: 100%; max-width: 700px; transition: max-width .25s; border-radius: 6px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,.5); }
  #article-frame.mobile { max-width: 414px; }
  .hint { color: var(--muted); font-size: 12px; margin-top: 10px; line-height: 1.8; }
  .theme-block { margin-bottom: 40px; }
  .theme-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .theme-head h3 { font-size: 16px; }
  .mini { padding: 6px 14px; font-size: 12px; background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 999px; cursor: pointer; }
  .mini:hover { border-color: var(--accent); color: var(--accent); }
  .deck { display: flex; gap: 14px; overflow-x: auto; scroll-snap-type: x mandatory; padding: 4px 2px 14px; }
  .deck img { height: 430px; border-radius: 14px; scroll-snap-align: start; cursor: zoom-in; box-shadow: 0 6px 24px rgba(0,0,0,.45); }
  .lightbox { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.92); z-index: 50; align-items: center; justify-content: center; }
  .lightbox.open { display: flex; }
  .lightbox img { max-height: 92vh; max-width: 88vw; border-radius: 10px; }
  .lb-btn { position: fixed; top: 50%; transform: translateY(-50%); font-size: 42px; color: #fff; background: none; border: 0; cursor: pointer; padding: 20px; user-select: none; }
  .lb-prev { left: 12px; } .lb-next { right: 12px; }
  .lb-close { position: fixed; top: 18px; right: 24px; font-size: 30px; color: #fff; background: none; border: 0; cursor: pointer; }
  footer { margin-top: 40px; text-align: center; color: var(--muted); font-size: 13px; }
  footer a { color: var(--accent); text-decoration: none; }
</style>
</head>
<body>
<div class="container">
  <h1>Publy Theme Gallery</h1>
  <p class="lead">文章主题的预览就是<strong>最终发布的真实 HTML</strong>——同一篇样例文章，切主题即时对比，滚轮缩放、文字可选中。小绿书卡片是确定性引擎的真实出图，按真实翻阅方式滑动。本地试用：<code>publy theme preview &lt;name&gt;</code></p>

  <section>
    <h2>Article themes · 公众号文章排版</h2>
    <div class="tabs">
      ${articleTabs}
      <span class="width-toggle">
        <button class="tab" onclick="setWidth(700, this)">文档宽</button>
        <button class="tab" onclick="setWidth(414, this)">手机宽</button>
      </span>
    </div>
    <div class="frame-wrap"><div id="article-frame">${articles[ART_THEMES[0]]}</div></div>
    <p class="hint">以上不是截图——是直接内嵌的发布级 HTML。发布到公众号的正文即此markup（内联样式，微信编辑器直接吃）。</p>
  </section>

  <section>
    <h2>Card themes · 小绿书卡片</h2>
    ${deckMarkup()}
    <p class="hint">滑动查看整组卡片；点任意卡片全屏翻阅。发布时卡片组按此顺序上传，首图为封面。</p>
  </section>

  <footer>
    Powered by <a href="https://github.com/turinglambdaai/publy">Publy</a> ·
    <a href="https://publy.jrtx.site/">产品主页</a> ·
    <a href="https://github.com/turinglambdaai/publy-themes">提交主题 (PR)</a>
  </footer>
</div>

${articleTemplates()}

<div class="lightbox" id="lb" onclick="if(event.target===this)closeLb()">
  <button class="lb-close" onclick="closeLb()">✕</button>
  <button class="lb-btn lb-prev" onclick="step(-1)">‹</button>
  <img id="lb-img" src="" alt="">
  <button class="lb-btn lb-next" onclick="step(1)">›</button>
</div>

<script>
  function showArticle(theme, btn) {
    document.querySelectorAll('.tabs .tab').forEach(b => b.classList.remove('sel'));
    if (btn) btn.classList.add('sel');
    const tpl = document.getElementById('art-' + theme);
    const frame = document.getElementById('article-frame');
    frame.innerHTML = '';
    frame.appendChild(tpl.content.cloneNode(true));
  }
  function setWidth(w, btn) {
    const f = document.getElementById('article-frame');
    f.classList.toggle('mobile', w === 414);
    f.style.maxWidth = w + 'px';
    btn.parentElement.querySelectorAll('.tab').forEach(b => b.classList.remove('sel'));
    btn.classList.add('sel');
  }
  let lbDeck = null, lbIdx = 0;
  function openLightbox(deck, idx) { lbDeck = deck; lbIdx = idx; renderLb(); document.getElementById('lb').classList.add('open'); }
  function renderLb() {
    const list = decks[lbDeck];
    document.getElementById('lb-img').src = list[lbIdx].file;
  }
  function step(d) {
    const list = decks[lbDeck];
    lbIdx = (lbIdx + d + list.length) % list.length;
    renderLb();
  }
  function closeLb() { document.getElementById('lb').classList.remove('open'); }
  document.addEventListener('keydown', e => {
    const open = document.getElementById('lb').classList.contains('open');
    if (!open) return;
    if (e.key === 'Escape') closeLb();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
  document.querySelectorAll('.deck img').forEach(img => img.onclick = () => openLightbox(img.dataset.deck, +img.dataset.idx));
  const decks = ${JSON.stringify(decks)};
</script>
</body>
</html>`;

fs.writeFileSync(path.join(themesRepo, "index.html"), page);

// prune obsolete article screenshots
for (const theme of ART_THEMES) {
  fs.rmSync(path.join(previewsDir, `${theme}.png`), { force: true });
  fs.rmSync(path.join(previewsDir, `${theme}-shot.html`), { force: true });
}

console.log("gallery built →", themesRepo);
console.log("article themes (live html):", ART_THEMES.join(", "));
console.log("card decks:", CARD_THEMES.map((t) => `${t}(${decks[t].length})`).join(", "));
