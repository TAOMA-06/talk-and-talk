import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = JSON.parse(readFileSync(resolve(root, "app.json"), "utf8"));
const baselineCharacters = 18_172;
const maximumCharacters = 10_500;
const maximumPageCharacters = 1_200;

function literalCopy(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\{\{[\s\S]*?\}\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function characterCount(value) {
  return [...value].filter((character) => !/\s/.test(character)).length;
}

const pages = app.pages.map((page) => {
  const source = readFileSync(resolve(root, `${page}.wxml`), "utf8");
  return { page, source, characters: characterCount(literalCopy(source)) };
});
const totalCharacters = pages.reduce((sum, page) => sum + page.characters, 0);
const reduction = 1 - totalCharacters / baselineCharacters;
const errors = [];

if (pages.length !== 31) errors.push(`expected 31 registered pages, found ${pages.length}`);
if (totalCharacters > maximumCharacters) errors.push(`visible literal copy ${totalCharacters} exceeds ${maximumCharacters}`);
for (const page of pages) {
  if (page.characters > maximumPageCharacters) errors.push(`${page.page} has ${page.characters} visible literal characters`);
}

const required = [
  ["pages/consent/index", "我已阅读并同意《用户协议》和《隐私政策》"],
  ["pages/consent/index", "我确认本人已年满 18 周岁"],
  ["pages/consent/index", "首发为文字陪伴：不开放媒体上传、实时语音或 TRTC"],
  ["pages/order/payment", "用户协议与完整退款条款"],
  ["pages/order/payment", "平台客服"],
  ["pages/order/detail", "用户协议与完整退款条款"],
  ["pages/order/detail", "平台客服"],
  ["pages/voice/index", "深圳市腾讯计算机系统有限公司"],
  ["pages/voice/index", "麦克风音频、IP、网络及设备系统基础信息"],
  ["pages/chat/index", "客户不会收到原因或被处罚"],
  ["pages/support/index", "正式发起入口在微信的"],
  ["pages/order/detail", "查看履约争议详情"],
  ["pages/order/detail", "进入安全支付与结果页"],
  ["pages/orders/index", "保持原预约"],
  ["pages/companion/detail", "新预约和支付暂不可用"],
  ["pages/crisis/index", "如果你或他人正处在危险中"],
  ["pages/account/adult-eligibility", "复核完成前，新的付费服务保持关闭"],
  ["pages/account/adult-eligibility", "提交成功不等于核验通过"],
  ["pages/account/adult-eligibility", "不接收证件照片"],
  ["pages/account/adult-eligibility", "不要填写身份证号、手机号、姓名、住址或验证码"],
  ["pages/account/deletion-status", "不会显示该标识关联的历史账号状态、处理日期或其他资料"],
  ["pages/safety/index", "已提交不代表已处理"],
  ["pages/companion/safety/index", "不自动判责、退款或冻结"]
];
for (const [pageName, text] of required) {
  const page = pages.find((candidate) => candidate.page === pageName);
  if (!page?.source.includes(text)) errors.push(`${pageName} must retain critical copy: ${text}`);
}

for (const [pageName, expression] of [
  ["pages/order/payment", "refundRequestWindowHours"],
  ["pages/order/payment", "refundPolicyVersion"],
  ["pages/order/detail", "refundRequestWindowHours"],
  ["pages/order/detail", "refundPolicyVersion"]
]) {
  const page = pages.find((candidate) => candidate.page === pageName);
  if (!page?.source.includes(expression)) errors.push(`${pageName} must retain ${expression}`);
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    passed: true,
    pages: pages.length,
    baselineCharacters,
    currentCharacters: totalCharacters,
    removedCharacters: baselineCharacters - totalCharacters,
    reductionPercent: Number((reduction * 100).toFixed(1)),
    largestPages: pages
      .sort((left, right) => right.characters - left.characters)
      .slice(0, 5)
      .map(({ page, characters }) => ({ page, characters }))
  }));
}
