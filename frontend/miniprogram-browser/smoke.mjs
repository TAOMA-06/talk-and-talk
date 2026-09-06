import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/taoma/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const repo = path.resolve(import.meta.dirname, '../..');
const origin = process.env.MINI_TEST_ORIGIN || 'http://localhost:3025';
assert.ok(['http://localhost:3025', 'http://localhost:3026'].includes(origin));
const out = path.join(repo, 'artifacts/delivery/miniprogram-browser');
await fs.mkdir(out, { recursive: true });
const code = (await fs.readFile(path.join(repo, 'backend/api/.env.partner-access'), 'utf8')).split('PARTNER_ACCESS_CODE=')[1]?.trim();
assert.ok(code);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
const consoleErrors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') consoleErrors.push(message.text()); });
const assertions = [];
const ok = (name, condition = true) => { assert.ok(condition, name); assertions.push({ name, outcome: 'pass' }); console.log('PASS', name); };
try {
  await page.goto(`${origin}/mini/index.html`);
  const mini = page.frameLocator('iframe[title="Talk&Talk 小程序"]');
  await mini.getByText('开始前确认', { exact: true }).waitFor();
  await page.screenshot({ path: path.join(out, '01-consent-phone.png'), fullPage: true });
  ok('native-consent-page-rendered');
  await mini.locator('input[type=checkbox]').nth(0).check();
  await mini.locator('input[type=checkbox]').nth(1).check();
  await mini.locator('wx-button').filter({ hasText: '同意并进入' }).click();
  await mini.getByRole('heading', { name: '进入小程序测试' }).waitFor();
  ok('native-consent-events-and-navigation');
  await mini.getByLabel('测试口令').fill(code);
  await mini.getByRole('button', { name: '进入', exact: true }).click();
  await mini.locator('#mini-login').waitFor({ state: 'hidden', timeout: 45000 });
  await mini.getByText('现在需要什么？', { exact: true }).waitFor();
  await mini.locator('section:visible wx-tt-skeleton').waitFor({ state: 'hidden', timeout: 45000 });
  ok('real-cookie-session-login');
  await mini.locator('textarea').fill('工作有点累，想聊一聊');
  await mini.getByText(`${'工作有点累，想聊一聊'.length} / 120`, { exact: true }).waitFor();
  ok('native-textarea-data-binding');
  await page.screenshot({ path: path.join(out, '02-home-phone.png'), fullPage: true, animations: 'disabled' });
  for (const [label, route] of [['发现', 'pages/discover/index'], ['订单', 'pages/orders/index'], ['消息', 'pages/messages/index'], ['我的', 'pages/profile/index']]) {
    await mini.getByRole('button', { name: label, exact: true }).click();
    await mini.locator(`section[data-mini-route="${route}"]:visible`).waitFor();
    await mini.locator('section:visible wx-tt-skeleton').waitFor({ state: 'hidden', timeout: 45000 });
    ok(`native-tab-${label}`);
    await page.screenshot({ path: path.join(out, `${label}-phone.png`), fullPage: true, animations: 'disabled' });
    if (label === '发现') {
      await mini.getByPlaceholder('搜索名称、角色、服务或标签').fill('林屿');
      await mini.locator('section:visible wx-button').filter({ hasText: /^搜索$/ }).click();
      const card = mini.locator('section:visible wx-tt-media-card[data-id="c1"]');
      await card.waitFor({ state: 'visible' });
      ok('live-companion-directory-loaded');
      await card.click();
      await mini.locator('section[data-mini-route="pages/companion/detail"]:visible').waitFor();
      await mini.locator('section:visible wx-tt-skeleton').waitFor({ state: 'hidden', timeout: 45000 });
      await mini.getByText('保存到我的书签', { exact: true }).or(mini.getByText('已保存到我的书签', { exact: true })).waitFor();
      ok('native-companion-detail-opened');
      await page.screenshot({ path: path.join(out, 'companion-detail-phone.png'), animations: 'disabled' });
      await mini.getByRole('button', { name: '返回', exact: true }).click();
    }
    if (label === '消息') {
      await mini.locator('section:visible wx-view[data-id]').filter({ hasText: '进入会话' }).click();
      await mini.getByPlaceholder('输入消息…').waitFor();
      await mini.locator('section:visible wx-tt-skeleton').waitFor({ state: 'hidden', timeout: 45000 });
      const content = `原小程序容器测试 ${Date.now()}`;
      await mini.getByPlaceholder('输入消息…').fill(content);
      await mini.locator('wx-button').filter({ hasText: /^发送$/ }).click();
      await mini.getByText(content, { exact: true }).waitFor();
      ok('native-chat-message-persisted');
      await mini.getByPlaceholder('输入消息…').waitFor();
      assert.equal(await mini.getByPlaceholder('输入消息…').inputValue(), '');
      ok('native-input-cleared-after-send');
      await page.screenshot({ path: path.join(out, 'chat-phone.png'), animations: 'disabled' });
      await mini.getByRole('button', { name: '返回', exact: true }).click();
    }
  }
  await mini.getByRole('button', { name: '首页', exact: true }).click();
  assert.equal(await mini.locator('textarea').inputValue(), '工作有点累，想聊一聊');
  ok('tab-page-state-preserved');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(out, '03-home-desktop.png'), fullPage: true, animations: 'disabled' });
  const frameBox = await page.locator('iframe').boundingBox();
  ok('desktop-retains-portrait-mini-program', frameBox.width === 430);
  ok('no-browser-runtime-errors', errors.length === 0);
} catch (error) {
  await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true });
  console.log('Visible page:', await page.frames().at(-1).locator('body').innerText().catch(() => 'unavailable'));
  console.log('Runtime errors:', errors);
  console.log('Console:', consoleErrors.slice(0, 30));
  console.log('DOM:', (await page.frames().at(-1).locator('body').innerHTML()).slice(0, 10000));
  throw error;
} finally {
  await fs.writeFile(path.join(out, 'smoke-report.json'), JSON.stringify({ assertions, errors }, null, 2));
  await browser.close();
}
