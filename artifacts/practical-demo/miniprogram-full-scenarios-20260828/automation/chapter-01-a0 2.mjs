import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.env.MINIPROGRAM_AUTOMATOR_ROOT;
const port = Number(process.env.MINIPROGRAM_AUTOMATION_PORT || 0);
if (!root || !port) throw new Error("automator root and port are required");

const automatorRoot = `${root}/node_modules/miniprogram-automator`;
const MiniProgram = require(`${automatorRoot}/out/MiniProgram.js`).default;
MiniProgram.prototype.checkVersion = async function checkVersionCompatibilityBridge() {};
const automator = require(automatorRoot);
const miniProgram = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${port}` });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function current() {
  const page = await miniProgram.currentPage();
  if (!page) throw new Error("no current Mini Program page");
  return page;
}

try {
  await miniProgram.reLaunch("/pages/consent/index");
  await wait(1800);

  let page = await current();
  const documentLinks = await page.$$(".document-link");
  if (documentLinks.length < 2) throw new Error("legal document links missing");

  await documentLinks[0].tap();
  await wait(1400);
  await miniProgram.pageScrollTo(650);
  await wait(1000);
  await miniProgram.navigateBack();
  await wait(1000);

  page = await current();
  const refreshedLinks = await page.$$(".document-link");
  await refreshedLinks[1].tap();
  await wait(1400);
  await miniProgram.pageScrollTo(650);
  await wait(1000);
  await miniProgram.navigateBack();
  await wait(1200);

  page = await current();
  const checkboxes = await page.$$("checkbox");
  if (checkboxes.length < 2) throw new Error("consent checkboxes missing");
  await checkboxes[0].tap();
  await wait(900);
  await checkboxes[1].tap();
  await wait(2200);

  const accept = await page.$(".accept");
  const disabled = accept ? await accept.attribute("disabled") : "missing";
  process.stdout.write(JSON.stringify({ chapter: "A0-consent", completed: true, acceptDisabled: disabled }) + "\n");
} finally {
  miniProgram.disconnect();
}
