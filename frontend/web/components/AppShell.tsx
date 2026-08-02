"use client";

import {
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Compass,
  Home,
  MessageCircle,
  MessageCircleHeart,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  PRIVACY_URL,
  TERMS_URL,
  clearConsent,
  getSession,
  logout,
} from "../lib/api-client";
import { initials } from "../lib/format";
import { miniprogramEntryUrl } from "../lib/miniprogram-entry";
import { publicDisclosure } from "../lib/public-disclosure";
import type { AuthUser } from "../lib/types";

type SessionContextValue = {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: (withdrawConsent?: boolean) => Promise<void>;
};

const SessionContext = createContext<SessionContextValue>({
  user: null,
  loading: true,
  refresh: async () => undefined,
  signOut: async () => undefined,
});

export function useSession() {
  return useContext(SessionContext);
}

const publicNavigation = [
  { href: "/", label: "首页", icon: Home },
  { href: "/how-it-works", label: "服务如何运作", icon: CalendarDays },
  { href: "/business", label: "平台能力", icon: BriefcaseBusiness },
  { href: "/safety", label: "安全与支持", icon: ShieldCheck },
  { href: "/partners", label: "合作与联系", icon: Sparkles },
  { href: "/about", label: "关于", icon: Building2 },
];

const memberNavigation = [
  { href: "/discover", label: "发现陪伴", icon: Compass },
  { href: "/community", label: "广场", icon: UsersRound },
  { href: "/orders", label: "订单", icon: CalendarDays },
  { href: "/messages", label: "消息", icon: MessageCircle },
  { href: "/safety", label: "安全与支持", icon: ShieldCheck },
];

const mobileNavigation = [
  { href: "/discover", label: "发现", icon: Compass },
  { href: "/community", label: "广场", icon: UsersRound },
  { href: "/orders", label: "订单", icon: CalendarDays },
  { href: "/messages", label: "消息", icon: MessageCircle },
  { href: "/profile", label: "我的", icon: UserRound },
];

const marketingPaths = ["/", "/about", "/business", "/demo", "/how-it-works", "/partners", "/safety"];

function pathIsActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/discover") {
    return pathname === "/discover" || pathname.startsWith("/companions/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const isMarketing = marketingPaths.some(
    (path) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)),
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setUser(await getSession());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isMarketing) {
      return undefined;
    }

    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [isMarketing, refresh]);

  const signOut = useCallback(
    async (withdrawConsent = false) => {
      await logout();
      setUser(null);
      if (withdrawConsent) {
        clearConsent();
      }
      router.push("/");
      router.refresh();
    },
    [router],
  );

  const context = useMemo(
    () => ({ user, loading, refresh, signOut }),
    [user, loading, refresh, signOut],
  );

  const isCompanion = user?.role === "companion";
  const displayName = user?.profile?.displayName || (isCompanion ? "陪伴者" : "你好");
  const desktopNavigation = isMarketing || !user ? publicNavigation : memberNavigation;
  const showMobileNav = !isMarketing;

  return (
    <SessionContext.Provider value={context}>
      <div className={isMarketing ? "site-shell marketing-shell" : "site-shell"}>
        <a className="skip-link" href="#main-content">跳到主要内容</a>
        <header className={isMarketing ? "site-header marketing-header" : "site-header"}>
          <div className="header-inner">
            <Link href="/" className="brand-lockup" aria-label="Talk&Talk 首页">
              <span className="brand-mark"><MessageCircleHeart size={19} /></span>
              <span className="brand-wordmark">
                <strong>Talk&amp;Talk</strong>
                <small>有边界的陪伴</small>
              </span>
            </Link>

            <nav className="desktop-nav" aria-label="主导航">
              {desktopNavigation.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={pathIsActive(pathname, item.href) ? "nav-link active" : "nav-link"}
                >
                  <span>{item.label}</span>
                </Link>
              ))}
              {isCompanion && (
                <Link
                  href="/workbench"
                  className={pathIsActive(pathname, "/workbench") ? "nav-link workbench active" : "nav-link workbench"}
                >
                  <span>工作台</span>
                </Link>
              )}
            </nav>

            <div className="header-actions">
              {isCompanion && (
                <Link
                  className="role-switch"
                  href={pathname === "/workbench" ? "/discover" : "/workbench"}
                >
                  <Sparkles size={15} />
                  {pathname === "/workbench" ? "去找陪伴" : "陪伴者工作台"}
                </Link>
              )}
              {loading && !isMarketing ? (
                <span className="account-loading" aria-label="正在读取账号" />
              ) : user ? (
                <Link className="account-chip" href="/profile">
                  <span className="mini-avatar">{initials(displayName)}</span>
                  <span className="account-copy">
                    <strong>{displayName}</strong>
                    <small>{isCompanion ? "用户 · 陪伴者" : "普通用户"}</small>
                  </span>
                </Link>
              ) : isMarketing ? (
                miniprogramEntryUrl ? (
                  <a href={miniprogramEntryUrl} rel="noreferrer" className="button button-primary button-compact">
                    打开小程序
                  </a>
                ) : (
                  <Link href="/how-it-works" className="button button-primary button-compact">
                    了解服务
                  </Link>
                )
              ) : (
                <Link href="/login" className="button button-primary button-compact">
                  登录
                </Link>
              )}
            </div>
          </div>
        </header>

        {isMarketing && (
          <nav className="marketing-mobile-nav" aria-label="官网导航">
            {publicNavigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={pathIsActive(pathname, item.href) ? "marketing-mobile-link active" : "marketing-mobile-link"}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}

        <main id="main-content" className="site-main" tabIndex={-1}>{children}</main>

        <footer className="site-footer">
          <div className="footer-brand-column">
            <div className="brand-lockup footer-brand">
              <span className="brand-mark"><MessageCircleHeart size={18} /></span>
              <span className="brand-wordmark">
                <strong>Talk&amp;Talk</strong>
                <small>有边界的陪伴</small>
              </span>
            </div>
            <p>
              女性友好的线上陪伴平台官方网站。网页用于了解产品与体验路径；服务入口以微信小程序页面状态为准。
            </p>
          </div>
          <div className="footer-nav-groups">
            <div>
              <strong>产品</strong>
              <Link href="/how-it-works">服务如何运作</Link>
              <Link href="/demo">网页产品演示</Link>
              <span>微信搜索 Talk&amp;Talk</span>
            </div>
            <div>
              <strong>信任</strong>
              <Link href="/safety">安全与支持</Link>
              <Link href="/how-it-works">服务边界与路径</Link>
              <span>重要互动留在平台内</span>
            </div>
            <div>
              <strong>公司</strong>
              <Link href="/about">关于我们</Link>
              <Link href="/partners">合作与联系</Link>
              <Link href="/business">平台能力</Link>
              <a href="mailto:hello@talkandtalk.app">联系合作</a>
              <span>仅面向 18+ 用户</span>
            </div>
            <div>
              <strong>法律与公示</strong>
              <a href={TERMS_URL} target="_blank" rel="noreferrer">小程序用户协议</a>
              <a href={PRIVACY_URL} target="_blank" rel="noreferrer">小程序隐私政策</a>
              {publicDisclosure.operatorName ? <span>{publicDisclosure.operatorName}</span> : <span>备案信息核验后公示</span>}
              {publicDisclosure.icpRecord && (
                publicDisclosure.icpRecordUrl ? (
                  <a href={publicDisclosure.icpRecordUrl} target="_blank" rel="noreferrer">{publicDisclosure.icpRecord}</a>
                ) : <span>{publicDisclosure.icpRecord}</span>
              )}
            </div>
          </div>
          <p className="footer-bottom">
            © 2026 Talk&amp;Talk · 官方网站 · 所有互动与交易均应在平台内完成
          </p>
        </footer>

        {showMobileNav && (
          <nav className="mobile-nav" aria-label="移动端主导航">
            {mobileNavigation.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={pathIsActive(pathname, item.href) ? "mobile-nav-link active" : "mobile-nav-link"}
                >
                  <Icon size={21} strokeWidth={1.8} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </SessionContext.Provider>
  );
}
