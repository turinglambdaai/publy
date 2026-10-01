// Storefront (purchase) + admin console pages — plain HTML, zh copy.
// NOTE: the admin page's inner <script> is hand-concatenated; never embed
// nested template literals here — they get evaluated at page-render time.

export function purchasePage(publicIp = "你的服务器公网 IP"): string {
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Publy · 购买</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #111; color: #eee; min-height: 100vh; display: flex; justify-content: center; padding: 40px 16px; }
  .box { width: 100%; max-width: 520px; }
  h1 { font-size: 22px; margin-bottom: 6px; }
  .sub { color: #999; font-size: 13px; margin-bottom: 28px; }
  .card { background: #1c1c1c; border: 1px solid #2a2a2a; border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  label { display: block; font-size: 13px; color: #999; margin: 14px 0 6px; }
  input, select { width: 100%; padding: 10px 12px; background: #111; color: #eee; border: 1px solid #333; border-radius: 8px; font-size: 14px; }
  .plans { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 6px; }
  .plan { border: 1px solid #333; border-radius: 10px; padding: 14px; cursor: pointer; text-align: center; }
  .plan.sel { border-color: #07C160; background: rgba(7,193,96,.08); }
  .plan .p { font-size: 20px; font-weight: 700; margin: 4px 0; }
  .plan .d { font-size: 12px; color: #999; }
  button { width: 100%; margin-top: 18px; padding: 12px; background: #07C160; color: #fff; border: 0; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .5; }
  .msg { margin-top: 14px; font-size: 13px; line-height: 1.7; color: #bbb; white-space: pre-wrap; word-break: break-all; display: none; }
  .msg a { color: #07C160; }
  .key { background: #0a0a0a; padding: 10px; border-radius: 8px; font-family: monospace; user-select: all; }
  .foot { margin-top: 24px; font-size: 12px; color: #666; line-height: 1.8; }
  .foot a { color: #888; }
</style></head><body><div class="box">
  <h1>Publy 托管发布服务</h1>
  <p class="sub">写作留在 Obsidian，发布交给一条命令。付款后自动开通，API key 当页发放。</p>

  <div class="card">
    <label>联系方式（用于订单关联与找回，请务必记住）</label>
    <input id="contact" placeholder="邮箱 / 手机号 / 微信号">
    <label>套餐</label>
    <div class="plans">
      <div class="plan" data-plan="pro" data-months="1"><div>Pro · 月付</div><div class="p">¥39</div><div class="d">5000 次发布/月 · 3 账号 · 定时</div></div>
      <div class="plan" data-plan="pro" data-months="12"><div>Pro · 年付</div><div class="p">¥390</div><div class="d">同月付权益 · 折合 ¥32.5/月</div></div>
    </div>
    <button id="buy" disabled>选择套餐后支付</button>
    <div class="msg" id="msg"></div>
  </div>

  <div class="card">
    <label>找回 key：输入购买时的联系方式</label>
    <div style="display:flex;gap:8px"><input id="lk-contact" placeholder="联系方式"><button id="lookup" style="width:auto;margin:0;padding:10px 16px">查询</button></div>
    <div class="msg" id="lk-msg"></div>
  </div>

  <div class="card" id="bind-card" style="display:none">
    <label style="font-weight:600;color:#eee">② 绑定公众号（自助，无需联系任何人）</label>
    <label>AppID（公众号后台「设置与开发 → 基本配置」）</label>
    <input id="bind-appid" placeholder="wx 开头的 AppID">
    <label>AppSecret（开发者密码，重置后复制）</label>
    <input id="bind-secret" placeholder="重置后生成的 secret">
    <label>账号名（CLI 里的 account 名，默认用 AppID）</label>
    <input id="bind-name" placeholder="如 my-gzh">
    <button id="bind-btn" style="margin-top:14px">验证并绑定</button>
    <div class="msg" id="bind-msg"></div>
  </div>

  <details class="card">
    <summary style="cursor:pointer;font-weight:600">📘 绑定前准备：IP 白名单（3 步，约 5 分钟，一次性）</summary>
    <ol style="margin:14px 0 4px 18px;line-height:2">
      <li>登录 <a href="https://mp.weixin.qq.com" target="_blank" style="color:#07C160">mp.weixin.qq.com</a> → 左下「设置与开发」→「基本配置」→ 找到 <b>IP 白名单</b> → 修改 → 添加本服务的公网 IP：<div class="key" style="cursor:pointer;margin-top:6px" onclick="navigator.clipboard.writeText('${publicIp}');this.style.outline='2px solid #07C160'" title="点击复制">${publicIp}（点击复制）</div></li>
      <li>同页面 <b>开发者密码(AppSecret)</b> → 启用/重置 → 管理员微信扫码确认 → <b>复制 secret（只显示这一次，务必存好）</b></li>
      <li>回到上方「绑定公众号」填入并点验证 — 若提示 IP 未加白名单，错误里会直接给出 IP，加入后重试即可</li>
    </ol>
    <p style="font-size:12px;color:#888;margin-top:10px;line-height:1.7">提示：以后若发布报错 40164，说明微信服务器 IP 有变——错误信息里会直接给出需要新加的 IP，加进白名单即可。AppSecret 我们只用于你授权的发布操作，AES-256-GCM 加密存储、永不下发。</p>
  </details>

  <div class="foot">
    免费档：每用户 1 个公众号账号、30 次发布/月，联系管理员开通。<br>
    支付即同意《服务条款》：仅使用微信公众号官方 API；AppSecret 仅用于你授权的发布操作，加密存储、永不下发。<br>
    <a href="https://github.com/turinglambdaai/publy">开源仓库</a> · <a href="https://themes.publy.jrtx.site/">主题画廊</a>
  </div>
</div>
<script>
let plan = null, months = 0;
document.querySelectorAll('.plan').forEach(el => el.onclick = () => {
  document.querySelectorAll('.plan').forEach(p => p.classList.remove('sel'));
  el.classList.add('sel');
  plan = el.dataset.plan; months = +el.dataset.months;
  document.getElementById('buy').disabled = false;
  document.getElementById('buy').textContent = '支付 ¥' + (months === 12 ? '390' : '39');
});
const show = (id, html) => { const el = document.getElementById(id); el.style.display = 'block'; el.innerHTML = html; };
function pollKey(orderId, btn, interval) {
  const timer = setInterval(async () => {
    const o = await (await fetch('/order/' + orderId)).json();
    if (o.status === 'paid') {
      clearInterval(timer);
      show('msg', '✅ 开通成功！你的 API key（已同时保存，可随时用下方"找回"）:\n<div class="key">' + o.apiKey + '</div>\n接入:\n<div class="key">publy config set server ' + location.origin + '\npubly config set api_key ' + o.apiKey + '</div>');
      window.__userKey = o.apiKey;
      const bc = document.getElementById('bind-card');
      if (bc) bc.style.display = 'block';
      btn.textContent = '已开通';
    }
  }, interval);
}
async function bindAccount() {
  const key = window.__userKey;
  if (!key) return show('bind-msg', '请先完成购买');
  const g = function (id) { return document.getElementById(id); };
  const appId = g('bind-appid').value, secret = g('bind-secret').value, name = g('bind-name').value;
  if (!appId || !secret) return show('bind-msg', '请填写 AppID 和 AppSecret');
  const out = document.getElementById('bind-msg');
  out.style.display = 'block';
  out.textContent = '验证中…（服务器会真实调用一次微信 API）';
  try {
    const r = await fetch('/v1/bind', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ appId: appId, appSecret: secret, accountName: name }) });
    const d = await r.json();
    if (d.ok) {
      out.innerHTML = '<span style="color:#4ade8c">✅ 绑定成功！账号名: ' + d.accountName + '</span>\n现在可以用 publy publish 发布了';
    } else if (d.code === 'NEEDS_WHITELIST') {
      out.innerHTML = '<span style="color:#f87171">❌ IP 未加白名单：请在公众号后台添加 <b>' + (d.ip || '错误信息中的 IP') + '</b> 后重试</span>';
    } else {
      out.textContent = '❌ ' + (d.message || d.code || r.status);
    }
  } catch (e) { out.textContent = '网络错误: ' + e.message; }
}
document.getElementById('buy').onclick = async () => {
  const contact = document.getElementById('contact').value.trim();
  if (!contact) return show('msg', '请先填写联系方式');
  const b = document.getElementById('buy'); b.disabled = true; b.textContent = '正在创建订单…';
  try {
    const r = await fetch('/purchase', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contact, plan, months }) });
    const d = await r.json();
    if (d.payUrl) {
      show('msg', '订单已创建，<a href="' + d.payUrl + '" target="_blank">点击完成支付</a>（或扫码）。支付完成后本页自动显示 key，请勿关闭页面。');
      pollKey(d.orderId, b, 2500);
    } else if (d.qrDataUrl) {
      const remark = String(d.orderId).slice(-6).toUpperCase();
      show('msg', '请用 <b>支付宝</b> 扫码支付（金额 ¥' + (months === 12 ? '390' : '39') + '），<b>支付时在备注里填写编号 <span style="color:#07C160">' + remark + '</span></b>。管理员确认后本页自动开通并显示 key，请勿关闭页面。<br><br><img src="' + d.qrDataUrl + '" style="width:240px;background:#fff;padding:8px;border-radius:8px">');
      pollKey(d.orderId, b, 3000);
    } else if (d.manual) {
      show('msg', '订单已提交（' + d.orderId + '）。当前支付通道未开启，请联系管理员完成支付后自动开通。');
    } else {
      show('msg', '创建失败：' + (d.message || d.code || r.status)); b.disabled = false;
    }
  } catch (e) { show('msg', '网络错误：' + e.message); b.disabled = false; }
};
document.getElementById('lookup').onclick = async () => {
  const c = document.getElementById('lk-contact').value.trim();
  if (!c) return show('lk-msg', '请输入联系方式');
  const r = await (await fetch('/lookup?contact=' + encodeURIComponent(c))).json();
  show('lk-msg', r.keys?.length
    ? r.keys.map(k => '<div class="key">publy_' + '•'.repeat(20) + k.slice(-4) + '</div>').join('')
    : '未找到该联系方式的订单');
};
</script></body></html>`;
}

export function adminPage(): string {
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Publy · Admin</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "Microsoft YaHei", sans-serif; background: #111; color: #eee; padding: 32px 16px; }
  .wrap { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 20px; margin-bottom: 16px; }
  h2 { font-size: 14px; color: #999; margin: 26px 0 8px; }
  input { padding: 9px 12px; background: #1a1a1a; color: #eee; border: 1px solid #333; border-radius: 8px; font-size: 13px; }
  button { padding: 9px 14px; background: #07C160; color: #fff; border: 0; border-radius: 8px; font-size: 13px; cursor: pointer; }
  button.gray { background: #333; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 13px; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #262626; }
  th { color: #888; font-weight: 500; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 10px 0; }
  .key { font-family: monospace; font-size: 12px; }
  form { display: none; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 10px; padding: 14px; margin-top: 10px; }
  form label { display: block; color: #999; font-size: 12px; margin: 8px 0 4px; }
  form input { width: 100%; }
</style></head><body><div class="wrap">
  <h1>Publy Admin</h1>
  <div class="row"><input id="key" type="password" placeholder="admin key" style="width:280px"><button onclick="load()">进入</button></div>

  <div id="panel" style="display:none">
    <h2>用户</h2>
    <div class="row">
      <button onclick="form('mk')">手工开通/延期</button>
      <button onclick="form('acc')">绑定公众号账号</button>
    </div>
    <form id="f-mk">
      <label>联系方式（已存在则自动延期 Pro）</label><input id="mk-contact">
      <label>套餐</label>
      <select id="mk-plan"><option value="pro">Pro</option><option value="free">Free</option></select>
      <label>月数</label><input id="mk-months" value="1">
      <div class="row"><button onclick="submitMk()">执行</button></div>
      <div id="mk-out" class="key"></div>
    </form>
    <form id="f-acc">
      <label>账号名（客户 CLI 里的 account 名）</label><input id="acc-name">
      <label>AppID</label><input id="acc-appid">
      <label>AppSecret</label><input id="acc-secret">
      <label>所属用户（联系方式）</label><input id="acc-owner">
      <div class="row">
        <button onclick="verifyAcc()">① 验证连通性</button>
        <button onclick="submitAcc()">② 保存</button>
      </div>
      <div id="acc-out" class="key"></div>
    </form>
    <table id="tbl"><thead><tr><th>联系方式</th><th>套餐</th><th>到期</th><th>本月用量</th><th>状态</th><th>API key</th><th></th></tr></thead><tbody></tbody></table>

    <h2 style="font-size:14px;color:#999;margin:26px 0 8px">待确认订单（静态收款码模式）</h2>
    <table id="ordtbl"><thead><tr><th>编号</th><th>联系方式</th><th>套餐</th><th>金额</th><th>时间</th><th></th></tr></thead><tbody></tbody></table>
  </div>
</div>
<script>
const H = function () { return { 'x-api-key': document.getElementById('key').value }; };
function form(id) { const el = document.getElementById('f-' + id); el.style.display = el.style.display === 'block' ? 'none' : 'block'; }
async function load() {
  const r = await fetch('/v1/admin/users', { headers: H() });
  if (!r.ok) { alert('key 不对'); return; }
  document.getElementById('panel').style.display = 'block';
  const d = await r.json();
  const tb = document.querySelector('#tbl tbody'); tb.innerHTML = '';
  for (const u of d.users) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + u.contact + '</td><td>' + u.plan + '</td><td>' + (u.expiresAt ? new Date(u.expiresAt).toLocaleDateString() : '—') + '</td>'
      + '<td>' + u.used + ' / ' + u.limit + '</td><td>' + (u.disabled ? '已停用' : '正常') + '</td>'
      + '<td class="key">' + u.apiKey.slice(0, 12) + '…</td><td>'
      + '<button class="gray" data-id="' + u.id + '" data-dis="' + (!u.disabled) + '">' + (u.disabled ? '启用' : '停用') + '</button></td>';
    tb.appendChild(tr);
  }
  tb.querySelectorAll('button').forEach(function (b) {
    b.onclick = function () { toggle(b.dataset.id, b.dataset.dis === 'true'); };
  });
  const or = await fetch('/v1/admin/orders?status=pending', { headers: H() });
  const od = await or.json();
  const otb = document.querySelector('#ordtbl tbody'); otb.innerHTML = '';
  for (const o of od.orders ?? []) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="key">' + o.id.slice(0, 8) + '</td><td>' + o.contact + '</td><td>' + o.plan + '×' + o.months + '月</td>'
      + '<td>¥' + (o.amountFen / 100).toFixed(0) + '</td><td>' + new Date(o.createdAt).toLocaleString() + '</td><td>'
      + '<button data-id="' + o.id + '">确认收款</button></td>';
    otb.appendChild(tr);
  }
  otb.querySelectorAll('button').forEach(function (b) {
    b.onclick = function () { completeOrder(b.dataset.id); };
  });
  if (!(od.orders ?? []).length) otb.innerHTML = '<tr><td colspan="6" style="color:#666">（无待确认订单）</td></tr>';
}
async function toggle(id, disabled) {
  await fetch('/v1/admin/users/' + id + '/disable', { method: 'POST', headers: Object.assign(H(), { 'content-type': 'application/json' }), body: JSON.stringify({ disabled: disabled }) });
  load();
}
async function submitMk() {
  const r = await fetch('/v1/admin/users', { method: 'POST', headers: Object.assign(H(), { 'content-type': 'application/json' }),
    body: JSON.stringify({ contact: val('mk-contact'), plan: val('mk-plan'), months: +val('mk-months') }) });
  const d = await r.json();
  document.getElementById('mk-out').textContent = d.apiKey ? 'key: ' + d.apiKey : JSON.stringify(d);
  load();
}
async function submitAcc() {
  const r = await fetch('/v1/admin/accounts', { method: 'POST', headers: Object.assign(H(), { 'content-type': 'application/json' }),
    body: JSON.stringify({ name: val('acc-name'), appId: val('acc-appid'), appSecret: val('acc-secret'), ownerContact: val('acc-owner') }) });
  const d = await r.json();
  document.getElementById('acc-out').textContent = d.ok ? '已保存' : JSON.stringify(d);
}
async function verifyAcc() {
  const out = document.getElementById('acc-out');
  out.textContent = '验证中…（本服务器会真实调用一次微信 API）';
  const r = await fetch('/v1/admin/verify-wechat', { method: 'POST', headers: Object.assign(H(), { 'content-type': 'application/json' }),
    body: JSON.stringify({ appId: val('acc-appid'), appSecret: val('acc-secret') }) });
  const d = await r.json();
  out.textContent = (d.ok ? '✅ ' : '❌ ') + d.message + (d.ip ? '（已为你标出该加的 IP）' : '');
  out.style.color = d.ok ? '#4ade8c' : '#f87171';
}
function val(id) { return document.getElementById(id).value; }
</script></body></html>`;
}
