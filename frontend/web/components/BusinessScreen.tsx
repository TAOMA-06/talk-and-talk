import {
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDot,
  HeartHandshake,
  LockKeyhole,
  MessageCircleHeart,
  Network,
  ShieldCheck,
  Sparkles,
  TimerReset,
  UserRoundSearch,
  WalletCards,
} from "lucide-react";
import Link from "next/link";

const readyCapabilities = [
  "公开陪伴者资料、服务商品与真实可约时间",
  "手机号验证码登录、18+ 与法律同意回执",
  "预约确认、支付、取消、退款和订单时间线",
  "支付后平台内会话、内容治理、举报与屏蔽",
  "同账号陪伴者工作台：服务、时段、订单与履约",
  "HttpOnly 会话、服务端代理和角色权限隔离",
];

const productionConditions = [
  "生产短信供应商与签名模板配置",
  "微信商户号、Native Pay 权限与证书配置",
  "正式后端域名、TLS、数据库迁移和运行监控",
  "正式陪伴者审核、运营排班与售后响应机制",
];

export default function BusinessScreen() {
  return (
    <div className="business-page">
      <section className="business-hero">
        <div className="business-hero-copy">
          <p className="hero-kicker">
            <span><Sparkles size={15} /></span>
            平台与合作
          </p>
          <h1>把线上陪伴，从一次偶然连接，做成一套可信的服务基础设施。</h1>
          <p>
            Talk&amp;Talk 是女性友好的双边线上陪伴平台。需求端更容易找到合适的人，
            供给端拥有清晰的经营工具，平台把审核、交易、沟通和售后串成可治理的闭环。
            本页只陈述已实现能力与明确标注的后续验证项；用户服务入口以微信小程序页面状态为准。
          </p>
          <div className="hero-actions">
            <Link href="/demo" className="button button-primary button-large">
              查看网页产品演示 <ArrowRight size={18} />
            </Link>
            <Link href="/partners" className="button button-secondary button-large">
              了解合作方式
            </Link>
          </div>
          <div className="business-truth-note">
            <BadgeCheck size={18} />
            <span>
              本页面只说明已经实现或明确标注为“后续验证”的能力，不使用未经核验的用户数、GMV 或增长率。
            </span>
          </div>
        </div>
        <div className="business-system-card" aria-label="平台三方价值结构">
          <div className="system-card-head">
            <span>Talk&amp;Talk service network</span>
            <small>当前产品架构</small>
          </div>
          <div className="system-node demand">
            <span><UserRoundSearch size={21} /></span>
            <div><small>需求端</small><strong>更低决策成本</strong></div>
          </div>
          <div className="system-connector"><i /><Network size={24} /><i /></div>
          <div className="system-node platform">
            <span><ShieldCheck size={21} /></span>
            <div><small>平台</small><strong>信任与交易治理</strong></div>
          </div>
          <div className="system-connector"><i /><Network size={24} /><i /></div>
          <div className="system-node supply">
            <span><BriefcaseBusiness size={21} /></span>
            <div><small>供给端</small><strong>更高履约效率</strong></div>
          </div>
          <div className="system-card-foot">
            <span><CircleDot size={14} /> 同一订单状态</span>
            <span><CircleDot size={14} /> 同一平台会话</span>
            <span><CircleDot size={14} /> 同一安全规则</span>
          </div>
        </div>
      </section>

      <section className="business-thesis-section">
        <header className="editorial-heading">
          <p className="eyebrow">产品判断</p>
          <h2>真正的竞争力，不只是“找到一个人”</h2>
          <p>一次匹配很容易复制，持续的信任、供给质量与履约系统才构成平台壁垒。</p>
        </header>
        <div className="thesis-grid">
          <article>
            <span>01</span>
            <h3>需求是高频但非标准化的</h3>
            <p>用户需要的不是统一答案，而是在不同情绪、时间和表达方式下找到更合适的陪伴者。</p>
          </article>
          <article>
            <span>02</span>
            <h3>信任必须由产品承接</h3>
            <p>只靠双方自觉无法规模化。资料审核、平台内沟通、订单状态和售后证据必须成为默认路径。</p>
          </article>
          <article>
            <span>03</span>
            <h3>供给效率决定体验上限</h3>
            <p>陪伴者需要商品、排班、确认和履约工具，用户端看到的可约状态才会真实、稳定、可解释。</p>
          </article>
        </div>
      </section>

      <section className="value-chain-section">
        <div className="value-chain-copy">
          <p className="eyebrow">双边价值链</p>
          <h2>一套后端，驱动用户体验、陪伴者经营与平台治理</h2>
          <p>
            用户端和工作台不是简单拼接：它们围绕同一份陪伴者资料、服务商品、可约容量、
            订单状态和会话权限协同工作。平台治理贯穿每一个状态变化。
          </p>
        </div>
        <div className="value-chain-flow">
          <article><span><UserRoundSearch size={19} /></span><strong>发现与筛选</strong><small>主题 · 方式 · 时间</small></article>
          <i><ArrowRight size={16} /></i>
          <article><span><TimerReset size={19} /></span><strong>预约确认</strong><small>价格 · 容量 · 排班</small></article>
          <i><ArrowRight size={16} /></i>
          <article><span><WalletCards size={19} /></span><strong>交易履约</strong><small>支付 · 服务 · 售后</small></article>
          <i><ArrowRight size={16} /></i>
          <article><span><MessageCircleHeart size={19} /></span><strong>关系沉淀</strong><small>会话 · 评价 · 再次选择</small></article>
        </div>
      </section>

      <section className="business-model-section">
        <header className="editorial-heading centered">
          <p className="eyebrow">商业化路径</p>
          <h2>先用订单验证价值，再扩展供给效率工具</h2>
          <p>收入逻辑与产品价值保持同向，不以制造焦虑或延长无效互动为目标。</p>
        </header>
        <div className="business-model-grid">
          <article className="current">
            <span className="model-status">当前交易入口</span>
            <WalletCards size={24} />
            <h3>按订单成交</h3>
            <p>平台已经承接服务价格、预约、支付和退款状态。实际服务费率与分账方案由商业和财务配置落地。</p>
            <small>验证重点：转化率、履约率、退款率与复购意愿</small>
          </article>
          <article>
            <span className="model-status future">后续验证</span>
            <BriefcaseBusiness size={24} />
            <h3>供给侧效率工具</h3>
            <p>在订单密度成立后，为高质量陪伴者提供更精细的排班、经营洞察和服务组合工具。</p>
            <small>前提：不影响平台公平分发与用户选择权</small>
          </article>
          <article>
            <span className="model-status future">后续验证</span>
            <HeartHandshake size={24} />
            <h3>机构与品牌合作</h3>
            <p>在合规边界清晰后，探索员工关怀、女性社区和品牌公益场景，不与医疗服务混淆。</p>
            <small>前提：独立合同、隐私隔离与明确服务范围</small>
          </article>
        </div>
      </section>

      <section className="readiness-section">
        <div className="readiness-heading">
          <p className="eyebrow">交付与上线准备度</p>
          <h2>产品闭环已具备，生产经营依赖被明确拆开</h2>
          <p>“代码可用”和“正式经营”不是同一个结论。以下清单把两者分开，方便尽调和上线决策。</p>
        </div>
        <div className="readiness-columns">
          <section className="readiness-card ready">
            <div className="readiness-card-head">
              <span><CheckCircle2 size={20} /></span>
              <div><small>本版本</small><h3>已经实现并可联调</h3></div>
            </div>
            <ul>
              {readyCapabilities.map((item) => (
                <li key={item}><CheckCircle2 size={16} /> {item}</li>
              ))}
            </ul>
          </section>
          <section className="readiness-card conditions">
            <div className="readiness-card-head">
              <span><LockKeyhole size={20} /></span>
              <div><small>正式经营前</small><h3>需要部署方完成</h3></div>
            </div>
            <ul>
              {productionConditions.map((item) => (
                <li key={item}><CircleDot size={16} /> {item}</li>
              ))}
            </ul>
            <p>这些是外部账号、凭据、基础设施与运营流程条件，不会被演示数据伪装成“已经完成”。</p>
          </section>
        </div>
      </section>

      <section className="demo-path-section">
        <div>
          <p className="eyebrow">建议体验路径</p>
          <h2>用十分钟看完一个完整双边市场</h2>
        </div>
        <div className="demo-path-grid">
          <Link href="/demo?stage=discover#demo-route"><span>01</span><strong>浏览与筛选</strong><small>看公开供给与服务商品</small></Link>
          <Link href="/demo?stage=booking#demo-route"><span>02</span><strong>预约决策</strong><small>看价格、时间与下单保护</small></Link>
          <Link href="/demo?stage=delivery#demo-route"><span>03</span><strong>交易与履约</strong><small>看订单状态、支付与售后</small></Link>
          <Link href="/demo?stage=support#demo-route"><span>04</span><strong>供给端经营</strong><small>看服务、时段和履约工具</small></Link>
        </div>
      </section>

      <section className="business-closing">
        <span><MessageCircleHeart size={28} /></span>
        <div>
          <p className="eyebrow">Talk&amp;Talk</p>
          <h2>让每一次倾听，都有安心的边界。</h2>
          <p>从真实可用的产品开始，逐步验证需求密度、供给质量与可持续的单位经济。合作请联系 hello@talkandtalk.app。</p>
        </div>
        <Link href="/demo" className="button button-inverse button-large">
          进入网页产品演示 <ArrowRight size={18} />
        </Link>
      </section>
    </div>
  );
}
