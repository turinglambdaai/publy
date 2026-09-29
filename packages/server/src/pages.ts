// Purchase / lookup / admin pages — plain HTML, no framework, zh copy.

export function purchasePage(): string {
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
      const timer = setInterval(async () => {
        const o = await (await fetch('/order/' + d.orderId)).json();
        if (o.status === 'paid') {
          clearInterval(timer);
          show('msg', '✅ 开通成功！你的 API key（已同时保存，可随时用下方“找回”）:\\n<div class="key">' + o.apiKey + '</div>\\n接入：\\n<div class="key">publy config set server ' + location.origin + '\\npubly config set api_key ' + o.apiKey + '\\npubly account add 你的账号名 …（见使用手册）</div>');
          b.textContent = '已开通';
        }
      }, 2500);
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
  input { padding: 9px 12px; background: #1a1a1a; color: #eee; border: 1px solid #333; border-radius: 8px; font-size: 13px; }
  button { padding: 9px 14px; background: #07C160; color: #fff; border: 0; border-radius: 8px; font-size: 13px; cursor: pointer; }
  button.gray { background: #333; }
  button.danger { background: #b91c1c; }
  table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 13px; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #262626; }
  th { color: #888; font-weight: 500; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 10px 0; }
  h2 { font-size: 14px; color: #999; margin: 26px 0 8px; }
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
      <div class="row"><button onclick="submitAcc()">保存</button></div>
      <div id="acc-out" class="key"></div>
    </form>
    <table id="tbl"><thead><tr><th>联系方式</th><th>套餐</th><th>到期</th><th>本月用量</th><th>状态</th><th>API key</th><th></th></tr></thead><tbody></tbody></table>
  </div>
</div>
<script>
const H = () => ({ 'x-api-key': document.getElementById('key').value });
function form(id) { const el = document.getElementById('f-' + id); el.style.display = el.style.display === 'block' ? 'none' : 'block'; }
async function load() {
  const r = await fetch('/v1/admin/users', { headers: H() });
  if (!r.ok) { alert('key 不对'); return; }
  document.getElementById('panel').style.display = 'block';
  const d = await r.json();
  const tb = document.querySelector('#tbl tbody'); tb.innerHTML = '';
  for (const u of d.users) {
    const tr = document.createElement('tr');
    tr.innerHTML = \`<td>\${u.contact}</td><td>\${u.plan}</td><td>\${u.expiresAt ? new Date(u.expiresAt).toLocaleDateString() : '—'}</td>
      <td>\${u.used} / \${u.limit}</td><td>\${u.disabled ? '已停用' : '正常'}</td>
      <td class="key">\${u.apiKey.slice(0, 12)}…</td><td>
      <button class="gray" onclick="toggle('\${u.id}', \${!u.disabled})">\${u.disabled ? '启用' : '停用'}</button></td>\`;
    tb.appendChild(tr);
  }
}
async function toggle(id, disabled) {
  await fetch('/v1/admin/users/' + id + '/disable', { method: 'POST', headers: { ...H(), 'content-type': 'application/json' }, body: JSON.stringify({ disabled }) });
  load();
}
async function submitMk() {
  const r = await fetch('/v1/admin/users', { method: 'POST', headers: { ...H(), 'content-type': 'application/json' },
    body: JSON.stringify({ contact: v('mk-contact'), plan: v('mk-plan'), months: +v('mk-months') }) });
  const d = await r.json();
  document.getElementById('mk-out').textContent = d.apiKey ? 'key: ' + d.apiKey : JSON.stringify(d);
  load();
}
async function submitAcc() {
  const r = await fetch('/v1/admin/accounts', { method: 'POST', headers: { ...H(), 'content-type': 'application/json' },
    body: JSON.stringify({ name: v('acc-name'), appId: v('acc-appid'), appSecret: v('acc-secret'), ownerContact: v('acc-owner') }) });
  const d = await r.json();
  document.getElementById('acc-out').textContent = d.ok ? '已保存' : JSON.stringify(d);
}
const v = (id) => document.getElementById(id).value;
</script></body></html>`;
}
