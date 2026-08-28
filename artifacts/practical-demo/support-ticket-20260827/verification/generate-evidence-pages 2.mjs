import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const artifactRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = resolve(artifactRoot, "evidence");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function shortId(value) {
  const text = String(value || "");
  return text.length > 14 ? `${text.slice(0, 8)}…${text.slice(-4)}` : text;
}

function shell(title, kicker, body) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{--ivory:#FAF9F5;--paper:#FFFFFF;--slate:#141413;--clay:#D97757;--olive:#788C5D;--rust:#B04A3F;--oat:#E3DACC;--g100:#F0EEE6;--g200:#E6E3DA;--g300:#D1CFC5;--g500:#87867F;--g700:#3D3D3A;--serif:ui-serif,Georgia,"Times New Roman",serif;--sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,Monaco,monospace}
*{box-sizing:border-box;margin:0;padding:0}html,body{width:100%;min-height:100%;background:var(--ivory);color:var(--slate)}body{font-family:var(--sans);line-height:1.5;padding:34px 44px 38px}.page{max-width:1320px;margin:0 auto}.top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:1.5px solid var(--g300);padding-bottom:20px}.kicker{font:700 12px var(--mono);letter-spacing:.14em;color:var(--clay);text-transform:uppercase}.notice{font:700 11px var(--mono);letter-spacing:.08em;padding:7px 11px;border:1.5px solid var(--clay);border-radius:999px;color:var(--clay);background:rgba(217,119,87,.08)}h1,h2,h3{font-family:var(--serif);font-weight:500;letter-spacing:-.015em}h1{font-size:42px;line-height:1.05;margin:8px 0 9px}h2{font-size:22px;margin-bottom:12px}h3{font-size:17px;margin-bottom:6px}.sub{color:var(--g700);font-size:15px}.grid{display:grid;grid-template-columns:repeat(12,1fr);gap:16px;margin-top:20px}.card{background:var(--paper);border:1.5px solid var(--g300);border-radius:13px;padding:19px 21px;box-shadow:0 4px 12px rgba(20,20,19,.03)}.span-3{grid-column:span 3}.span-4{grid-column:span 4}.span-5{grid-column:span 5}.span-6{grid-column:span 6}.span-7{grid-column:span 7}.span-8{grid-column:span 8}.span-12{grid-column:span 12}.metric{font:600 36px var(--serif);line-height:1;color:var(--olive);margin:5px 0}.label{font:700 11px var(--mono);letter-spacing:.09em;color:var(--g500);text-transform:uppercase}.small{font-size:13px;color:var(--g500)}.mono{font-family:var(--mono)}.badge{display:inline-flex;align-items:center;padding:4px 9px;border-radius:7px;border:1.5px solid var(--g300);font:700 11px var(--mono);letter-spacing:.05em}.pass{color:var(--olive);background:rgba(120,140,93,.10);border-color:rgba(120,140,93,.45)}.blocked{color:var(--clay);background:rgba(217,119,87,.09);border-color:rgba(217,119,87,.4)}.timeline{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin-top:10px}.step{position:relative;background:var(--g100);border-radius:10px;padding:12px;min-height:88px}.step::before{content:"";display:block;width:9px;height:9px;border-radius:50%;background:var(--olive);margin-bottom:8px}.step.ui::before{background:var(--clay)}.step strong{display:block;font-size:13px}.step span{display:block;margin-top:3px;font-size:11px;color:var(--g500)}.rows{display:grid;gap:8px}.row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid var(--g200);font-size:13px}.row:last-child{border:0}.row strong{font-family:var(--mono);font-size:12px}.boundary{border-left:5px solid var(--clay)}.footer{display:flex;justify-content:space-between;gap:20px;margin-top:17px;color:var(--g500);font:11px var(--mono)}
@media(max-width:900px){body{padding:24px}.span-3,.span-4,.span-5,.span-6,.span-7,.span-8{grid-column:span 12}.timeline{grid-template-columns:1fr 1fr}.top{flex-direction:column}}
</style>
</head>
<body><main class="page" data-evidence-card="true"><header class="top"><div><div class="kicker">${escapeHtml(kicker)}</div><h1>${escapeHtml(title)}</h1><p class="sub">本页由本次实际脱敏 JSON 生成，用于演示编排；不是 Talk&amp;Talk 应用界面。</p></div><div class="notice">EVIDENCE CARD · NOT APPLICATION UI</div></header>${body}<footer class="footer"><span>Talk&amp;Talk · 本地隔离工程证据</span><span>外部微信送达与 Mini UI 未验证</span></footer></main></body></html>`;
}

const preclaim = JSON.parse(await readFile(resolve(artifactRoot, "verification/media-api-preclaim-assertions.json"), "utf8"));
const final = JSON.parse(await readFile(resolve(artifactRoot, "verification/media-api-final-assertions.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve(artifactRoot, "manifest.json"), "utf8"));
const passed = preclaim.assertions.filter((item) => item.outcome === "pass").length
  + final.assertions.filter((item) => item.outcome === "pass").length;
const failed = preclaim.assertions.filter((item) => item.outcome !== "pass").length
  + final.assertions.filter((item) => item.outcome !== "pass").length;
const ticket = final.ticket;

const overview = shell("实用客服工单 · 证据总览", "Evidence card 01 · Run summary", `
<section class="grid">
  <article class="card span-3"><div class="label">deterministic checks</div><div class="metric">${passed}/${passed + failed}</div><div class="small">逐项断言通过</div></article>
  <article class="card span-3"><div class="label">ticket state</div><div class="metric">${escapeHtml(ticket.status)}</div><div class="small mono">${escapeHtml(shortId(ticket.id))}</div></article>
  <article class="card span-3"><div class="label">claim http</div><div class="metric">201</div><div class="small">并发安全认领</div></article>
  <article class="card span-3"><div class="label">resolve http</div><div class="metric">200</div><div class="small">noRefund · 用户可读结论</div></article>
  <article class="card span-8">
    <h2>这次真实发生的处理链路</h2>
    <div class="timeline">
      <div class="step"><strong>真实 API 建单</strong><span>open / unassigned</span></div>
      <div class="step ui"><strong>真实后台画面</strong><span>匿名队列可见</span></div>
      <div class="step ui"><strong>受控弹窗</strong><span>UI 停在提交前</span></div>
      <div class="step"><strong>API 完成认领</strong><span>201 / inProgress</span></div>
      <div class="step"><strong>API 完成结案</strong><span>200 / resolved</span></div>
    </div>
  </article>
  <article class="card span-4 boundary"><span class="badge blocked">HARNESS BOUNDARY</span><h2 style="margin-top:12px">后台画面经本地代理</h2><p class="small">代理只提供仓库中原始 admin 静态文件，并把同源 <span class="mono">/api/v1/*</span> 转发到真实 NestJS。生产源码未修改。</p></article>
</section>`);

const auditItems = final.auditActions.map((action) => `<div class="row"><span>${escapeHtml(action)}</span><strong class="pass">RECORDED</strong></div>`).join("");
const delivery = final.deliveryIntent || {};
const notification = final.notification || {};
const detail = shell("审计与通知 · 持久化证据", "Evidence card 02 · Audit and notification", `
<section class="grid">
  <article class="card span-6"><div class="label">audit trail</div><h2>三段业务动作均有独立审计</h2><div class="rows">${auditItems}</div></article>
  <article class="card span-6"><div class="label">customer inbox</div><h2>${escapeHtml(notification.title || "客服工单已更新")}</h2><div class="rows">
    <div class="row"><span>通知类型</span><strong>${escapeHtml(notification.type)}</strong></div>
    <div class="row"><span>业务状态</span><strong>${escapeHtml(notification.status)}</strong></div>
    <div class="row"><span>未读状态</span><strong>${notification.unread ? "UNREAD" : "READ"}</strong></div>
    <div class="row"><span>模板键</span><strong>${escapeHtml(delivery.templateKey)}</strong></div>
    <div class="row"><span>投递意图</span><strong>${escapeHtml(delivery.status)}</strong></div>
  </div></article>
  <article class="card span-7"><h2>证据边界</h2><div class="rows">
    <div class="row"><span>真实 API + PostgreSQL</span><strong class="pass">PASS</strong></div>
    <div class="row"><span>真实 admin 静态资源</span><strong class="pass">CAPTURED VIA PROXY</strong></div>
    <div class="row"><span>Mini Program UI</span><strong class="blocked">BLOCKED</strong></div>
    <div class="row"><span>外部微信送达</span><strong class="blocked">NOT RUN</strong></div>
  </div></article>
  <article class="card span-5 boundary"><span class="badge blocked">DO NOT OVERCLAIM</span><h2 style="margin-top:12px">pending 不是送达</h2><p>已验证站内通知与投递意图持久化；没有真实微信授权或 provider 成功回执。</p><p class="small mono">SHA ${escapeHtml(manifest.source.sha.slice(0, 12))} · ticket ${escapeHtml(shortId(ticket.id))}</p></article>
</section>`);

await mkdir(evidenceRoot, { recursive: true });
await writeFile(resolve(evidenceRoot, "01-run-summary.html"), overview);
await writeFile(resolve(evidenceRoot, "02-audit-notification.html"), detail);
process.stdout.write(JSON.stringify({ pages: 2, passed, failed, ticketId: ticket.id }) + "\n");
