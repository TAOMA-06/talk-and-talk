import { Controller, Get, NotFoundException, OnModuleInit, Param, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Response } from "express";

import { LegalDocumentArchiveService, LegalDocumentType } from "./legal-document-archive.service";

/**
 * Legal text is rendered from production-only disclosure configuration rather
 * than baked into a client bundle. This prevents a deploy with a generic or
 * stale operator/contact identity once the production configuration gate is on.
 */
@Controller("legal")
export class LegalController implements OnModuleInit {
  constructor(
    private readonly config: ConfigService,
    private readonly archive: LegalDocumentArchiveService
  ) {}

  async onModuleInit(): Promise<void> {
    // Publish the exact same rendered documents used by the HTTP endpoints
    // before accepting traffic. Consent recording can therefore never depend
    // on an operator having manually visited a legal page first.
    const sink: any = {};
    sink.type = () => sink;
    sink.send = () => undefined;
    await this.terms(sink as Response);
    await this.privacy(sink as Response);
    await this.platformRules(sink as Response);
  }

  @Get("terms")
  async terms(@Res() response: Response) {
    const refundWindowHours = this.config.getOrThrow<number>("REFUND_REQUEST_WINDOW_HOURS");
    const settlementHoldHours = this.config.getOrThrow<number>("COMPANION_SETTLEMENT_HOLD_HOURS");
    const html = this.document("Talk&Talk 用户协议与平台规则", `
      <h1>Talk&Talk 用户协议与平台规则</h1>
      ${this.meta()}
      <h2>一、平台角色与适用范围</h2>
      <p>${this.operator()}（以下简称“平台”）提供线上陪伴、内容互动、预约、订单信息展示、平台内沟通与客服协调能力。本服务不提供线下见面撮合、医疗诊断、心理治疗、法律或投资建议；如有紧急危险、急性医疗或自伤风险，请立即联系当地紧急服务或专业机构。</p>
      <p>平台采用线上撮合、微信支付与受控结算模式：订单款项由微信支付处理，陪伴者的身份、服务协议、税务档案和收款对象须经双人复核；订单创建时会固定收款对象快照。陪伴者应结款最早在服务完成 ${settlementHoldHours} 小时后，且退款申请窗口届满、没有未处理争议或追偿时进入结算流程。平台不会因本协议承诺即时到账或未经核验的自动分账。</p>
      <h2>二、账号、年龄与身份</h2>
      <p>你须年满 18 周岁，并对通过本人微信身份完成的操作负责。不得出借账号、冒用他人身份、规避平台审核或以任何方式协助他人规避平台规则。陪伴者接单资格、展示与结算均可能受平台人工核验、风险处置与运营安排限制。</p>
      <h2>三、预约、履约、支付与退款</h2>
      <p>下单前请确认服务对象、时间、时长和金额。陪伴者须在订单展示的响应时限内确认或拒绝；超时未确认的订单将自动取消且不扣款。支付是否成功以平台收到的微信支付服务端结果为准，客户端提示只表示支付请求已提交。</p>
      <p>服务开始、完成、取消、退款与售后以订单状态和实际履约证据为准。完成订单的自助退款申请窗口为服务完成后 ${refundWindowHours} 小时；用户主动确认完成不会缩短该期限。期限届满后仍可通过客服提交履约、合规或法定权利争议，由平台按照证据、适用规则与法律处理。未解决工单、失败退款和退款后追偿会冻结相关结算。退款通常按原支付路径处理，具体以微信支付处理结果及适用法律为准。</p>
      <h2>四、平台内沟通与内容规范</h2>
      <p>禁止诱导添加私人联系方式、私下转账、线下邀约、诈骗、骚扰、歧视、低俗色情、威胁、PUA、自伤煽动、侵犯隐私或知识产权、刷量引流和其他违法违规内容。平台可基于规则、自动化风险识别及人工复核进行提醒、限制、下架、冻结结算或停止服务；你可通过客服工单提出申诉。</p>
      <h2>五、推荐、通知与选择</h2>
      <p>平台可能基于已展示的服务偏好、互动和订单信息进行推荐排序。你可通过平台提供的偏好设置、删除相关标签或客服渠道提出查询、解释、拒绝个性化推荐或删除请求。微信订阅消息仅在你对具体模板主动授权后用于订单、支付、履约或工单更新；未授权或授权已用尽时，平台仍以站内订单和消息中心为准。</p>
      <h2>六、规则更新、投诉与联系</h2>
      <p>本规则、服务者管理规范、交易与争议处理规则、隐私规则共同构成平台规则。发生实质变化时，平台会按适用要求公示、保留历史版本，并在需要时重新取得同意。投诉、履约争议、退款、账号或规则问题可通过：${this.contact()}。</p>
      <p>完整平台规则页面：<a href="${this.escape(this.config.getOrThrow<string>("LEGAL_PLATFORM_RULES_URL"))}">${this.escape(this.config.getOrThrow<string>("LEGAL_PLATFORM_RULES_URL"))}</a></p>
    `);
    await this.archive.ensureSnapshot("terms", this.version(), html);
    return response.type("html").send(html);
  }

  @Get("privacy")
  async privacy(@Res() response: Response) {
    const retention = this.config.getOrThrow<number>("LEGAL_PRIVACY_RETENTION_DAYS");
    const html = this.document("Talk&Talk 隐私政策", `
      <h1>Talk&Talk 隐私政策</h1>
      ${this.meta()}
      <h2>一、个人信息处理者与联系方式</h2>
      <p>个人信息处理者：${this.operator()}。联系、个人信息权利请求和投诉渠道：${this.contact()}。</p>
      <h2>二、处理的信息、目的与方式</h2>
      <ul>
        <li>微信登录标识（OpenID 等）与平台账号：用于识别账号、防止冒用和维持登录；</li>
        <li>你主动填写的昵称、性别、年龄、联系方式及服务资料：用于账号展示、服务交付与必要安全核验；</li>
        <li>订单、服务时间、金额、支付交易号、退款和结算状态：用于预约、支付核验、对账、退款、争议与法定义务；</li>
        <li>你对具体微信订阅消息模板作出的授权结果与投递状态：仅用于订单、支付、履约和工单的事务性提醒，不用于营销推送；</li>
        <li>聊天、广场、评价、举报和客服工单内容：用于交付服务、处理纠纷、内容安全和申诉；</li>
        <li>推荐偏好和交互记录：用于改善推荐与展示排序，你可提出拒绝个性化推荐或删除相关标签的请求。</li>
      </ul>
      <h2>三、共享、委托与公开</h2>
      <p>为完成小程序登录、支付及必要安全能力，相关信息可能由微信、微信支付和已配置的内容审核服务在其职责范围内处理。我们不会出售个人信息，也不会将聊天内容用于与本服务无关的广告画像。依法向监管、司法或执法机关提供信息时，将限于法定范围。</p>
      <h2>四、保存期限与安全</h2>
      <p>我们仅在实现目的、处理争议和履行法定义务所需期限内保存信息；站内通知、已使用订阅授权等低风险运营记录的最长保留期配置为 ${retention} 天，并由定期清理任务执行。订单、支付、服务、客服、审核和同意证据按照经确认的分类留存表及适用法律处理，期限届满后删除或匿名化。我们采取 HTTPS 传输、访问控制、审计日志、最小权限和敏感信息脱敏等措施；发生可能影响你权益的安全事件时，将依法处理和通知。</p>
      <h2>五、你的权利</h2>
      <p>你可查询、更正或删除部分资料，申请注销账号，提出复制、解释、限制处理、撤回同意、拒绝个性化推荐或投诉请求。你可在小程序内使用相应功能或通过上述联系渠道提交；为保护账号和交易安全，我们可能核验你的身份并在法定期限内答复。撤回不影响撤回前基于合法基础已进行的处理。</p>
      <h2>六、未成年人与政策更新</h2>
      <p>本服务仅面向年满 18 周岁的用户。政策发生实质变化时，我们会更新版本并在需要时重新取得明确同意。</p>
    `);
    await this.archive.ensureSnapshot("privacy", this.version(), html);
    return response.type("html").send(html);
  }

  @Get("platform-rules")
  async platformRules(@Res() response: Response) {
    const html = this.document("Talk&Talk 平台规则", `
      <h1>Talk&Talk 平台规则</h1>
      ${this.meta()}
      <h2>一、规则范围</h2>
      <p>本页与《用户协议》《隐私政策》、订单页面展示规则、陪伴者管理规范及客服处理记录共同构成平台规则。运营方为：${this.operator()}。</p>
      <h2>二、陪伴者管理</h2>
      <p>陪伴者在展示、接单和结算前须满足平台当前的账号、身份、服务能力、安全与审核要求。平台可暂停展示、接单或结算，并要求补充核验；平台不以“已认证”字样替代法定或必要的身份、资质核验。</p>
      <h2>三、交易和争议处理</h2>
      <p>订单会记录响应时限、确认、支付、服务开始和完成状态。争议可由订单任一参与方通过客服工单提交；平台可要求补充沟通、订单与支付证据，并在处理期间冻结相关结算。处理结果和退款以适用规则、证据和支付通道处理结果为准。</p>
      <h2>四、投诉、申诉与规则历史</h2>
      <p>投诉和申诉渠道：${this.contact()}。平台将按适用要求展示规则更新、保留历史版本和处理记录；涉及个人信息、内容处置或交易争议的请求可使用该渠道提交。</p>
    `);
    await this.archive.ensureSnapshot("platformRules", this.version(), html);
    return response.type("html").send(html);
  }

  @Get(":document/versions/:version")
  async versionedDocument(
    @Param("document") document: string,
    @Param("version") version: string,
    @Res() response: Response
  ) {
    const documentType = this.documentType(document);
    const snapshot = await this.archive.getSnapshot(documentType, version);
    return response.type("html").send(snapshot.html);
  }

  private meta() {
    return `<p class="meta">版本 ${this.escape(this.version())} · 生效日期：${this.escape(this.config.getOrThrow<string>("LEGAL_CONSENT_EFFECTIVE_DATE"))}</p>`;
  }

  private version() {
    return this.config.getOrThrow<string>("LEGAL_CONSENT_VERSION");
  }

  private documentType(document: string): LegalDocumentType {
    if (document === "terms") return "terms";
    if (document === "privacy") return "privacy";
    if (document === "platform-rules") return "platformRules";
    throw new NotFoundException("Legal document type not found");
  }

  private operator() {
    return this.escape(this.config.getOrThrow<string>("LEGAL_OPERATOR_NAME"));
  }

  private contact() {
    const email = this.escape(this.config.getOrThrow<string>("LEGAL_CONTACT_EMAIL"));
    const phone = this.escape(this.config.getOrThrow<string>("LEGAL_CONTACT_PHONE"));
    const channel = this.escape(this.config.getOrThrow<string>("LEGAL_COMPLAINT_CHANNEL"));
    return `${channel}；邮箱：${email}；电话：${phone}`;
  }

  private document(title: string, body: string) {
    return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${this.escape(title)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.7;max-width:760px;margin:0 auto;padding:24px;color:#1a1a1a}h1{font-size:1.5rem}h2{font-size:1.12rem;margin-top:1.6rem}p,li{color:#333}.meta{color:#666;font-size:.9rem}a{word-break:break-all}</style></head><body>${body}</body></html>`;
  }

  private escape(value: string) {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
  }
}
