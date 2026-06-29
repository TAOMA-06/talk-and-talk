# Talk & Talk MVP H5 Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first H5 demo for a companion booking platform, showcasing the complete user journey from discovery to review.

**Architecture:** A single-page React application using React Router for navigation between views. All state is managed locally with React hooks and context. Mock data is used for all backend services.

**Tech Stack:** Vite + React + TypeScript + Tailwind CSS + lucide-react + react-router-dom

---

## Task 1: Project Setup & Dependencies

**Covers:** [S1]

**Files:**
- Modify: `package.json`
- Modify: `src/index.css`
- Modify: `src/main.tsx`
- Modify: `vite.config.ts`
- Delete: `src/App.css`
- Delete: `src/assets/hero.png`
- Delete: `src/assets/react.svg`
- Delete: `src/assets/vite.svg`

- [ ] **Step 1: Install dependencies**

```bash
npm install react-router-dom lucide-react
npm install -D @types/react-router-dom
```

- [ ] **Step 2: Configure Tailwind CSS**

Update `src/index.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 220 13% 10%;
    --card: 0 0% 100%;
    --card-foreground: 220 13% 10%;
    --popover: 0 0% 100%;
    --popover-foreground: 220 13% 10%;
    --primary: 220 13% 10%;
    --primary-foreground: 0 0% 100%;
    --secondary: 220 13% 96%;
    --secondary-foreground: 220 13% 10%;
    --muted: 220 13% 96%;
    --muted-foreground: 220 9% 46%;
    --accent: 220 13% 96%;
    --accent-foreground: 220 13% 10%;
    --destructive: 0 84% 60%;
    --destructive-foreground: 0 0% 100%;
    --border: 220 13% 90%;
    --input: 220 13% 90%;
    --ring: 220 13% 10%;
    --radius: 0.5rem;
    
    /* Custom brand colors */
    --coral: 14 100% 67%;
    --teal: 168 76% 42%;
    --ink: 220 13% 10%;
    --paper: 0 0% 98%;
  }

  * {
    @apply border-border;
  }

  body {
    @apply bg-background text-foreground;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  #root {
    @apply max-w-md mx-auto min-h-screen bg-paper;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.05);
  }
}
```

- [ ] **Step 3: Create tailwind.config.js**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        coral: "hsl(var(--coral))",
        teal: "hsl(var(--teal))",
        ink: "hsl(var(--ink))",
        paper: "hsl(var(--paper))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 4: Update main.tsx with Router**

```typescript
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 5: Clean up default files**

Delete `src/App.css`, `src/assets/hero.png`, `src/assets/react.svg`, `src/assets/vite.svg`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: setup project with tailwind and router"
```

---

## Task 2: Create Mock Data & Types

**Covers:** [S2]

**Files:**
- Create: `src/data/types.ts`
- Create: `src/data/mock.ts`

- [ ] **Step 1: Define types**

```typescript
// src/data/types.ts

export interface Companion {
  id: string;
  name: string;
  avatar: string;
  tags: string[];
  rating: number;
  reviewCount: number;
  pricePerHour: number;
  isOnline: boolean;
  isVerified: boolean;
  bio: string;
  availableTimes: string[];
  languages: string[];
  specialties: string[];
}

export interface Theme {
  id: string;
  name: string;
  icon: string;
  description: string;
}

export interface Order {
  id: string;
  companionId: string;
  themeId: string;
  duration: number;
  totalPrice: number;
  status: 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  createdAt: string;
  scheduledAt: string;
}

export interface Review {
  id: string;
  companionId: string;
  userName: string;
  rating: number;
  content: string;
  createdAt: string;
}

export interface Message {
  id: string;
  senderId: string;
  content: string;
  type: 'text' | 'voice' | 'system';
  timestamp: string;
}

export interface User {
  id: string;
  name: string;
  avatar: string;
  isVerified: boolean;
  phone?: string;
}
```

- [ ] **Step 2: Create mock data**

```typescript
// src/data/mock.ts
import type { Companion, Theme, Order, Review, Message, User } from './types';

export const mockUser: User = {
  id: 'u1',
  name: '小美',
  avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=xiaomei',
  isVerified: false,
  phone: '138****8888',
};

export const themes: Theme[] = [
  { id: 't1', name: '情感倾诉', icon: 'Heart', description: '倾听你的心事，给予温暖陪伴' },
  { id: 't2', name: '职场解压', icon: 'Briefcase', description: '释放工作压力，找回内心平静' },
  { id: 't3', name: '学习陪伴', icon: 'BookOpen', description: '专注学习时光，互相督促进步' },
  { id: 't4', name: '运动鼓励', icon: 'Dumbbell', description: '一起运动打卡，保持健康生活' },
  { id: 't5', name: '旅行分享', icon: 'Plane', description: '分享旅途故事，探索世界美好' },
  { id: 't6', name: '美食探索', icon: 'Utensils', description: '发现美食乐趣，分享味蕾体验' },
];

export const companions: Companion[] = [
  {
    id: 'c1',
    name: '林悦',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=linyue',
    tags: ['温柔倾听', '心理学背景', '深夜在线'],
    rating: 4.9,
    reviewCount: 128,
    pricePerHour: 88,
    isOnline: true,
    isVerified: true,
    bio: '国家二级心理咨询师，擅长情感疏导与压力管理。愿做你深夜里的那盏灯，倾听你的故事，陪你走过低谷。',
    availableTimes: ['09:00', '14:00', '20:00', '22:00'],
    languages: ['中文', '英语'],
    specialties: ['情感倾诉', '职场解压'],
  },
  {
    id: 'c2',
    name: '苏晴',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=suqing',
    tags: ['阳光活力', '健身教练', '早起型'],
    rating: 4.8,
    reviewCount: 96,
    pricePerHour: 68,
    isOnline: true,
    isVerified: true,
    bio: '健身教练兼营养师，热爱运动与生活。可以陪你一起制定运动计划，分享健康饮食心得，让每一天都充满活力！',
    availableTimes: ['06:00', '07:00', '18:00', '19:00'],
    languages: ['中文'],
    specialties: ['运动鼓励', '美食探索'],
  },
  {
    id: 'c3',
    name: '陈墨',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=chenmo',
    tags: ['知性优雅', '旅行达人', '摄影师'],
    rating: 4.7,
    reviewCount: 84,
    pricePerHour: 78,
    isOnline: false,
    isVerified: true,
    bio: '自由摄影师，足迹遍布30+国家。热爱分享旅行故事与摄影技巧，带你用镜头发现世界的美。',
    availableTimes: ['10:00', '15:00', '19:00'],
    languages: ['中文', '英语', '日语'],
    specialties: ['旅行分享', '学习陪伴'],
  },
  {
    id: 'c4',
    name: '周暖',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=zhounuan',
    tags: ['治愈系', '手绘爱好者', '慢生活'],
    rating: 4.9,
    reviewCount: 156,
    pricePerHour: 58,
    isOnline: true,
    isVerified: true,
    bio: '插画师，喜欢手绘与手工。享受慢生活的美好，愿意陪你一起画画、做手工，在安静中找到内心的宁静。',
    availableTimes: ['09:00', '13:00', '16:00', '20:00'],
    languages: ['中文'],
    specialties: ['学习陪伴', '情感倾诉'],
  },
  {
    id: 'c5',
    name: '赵朗',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=zhaolang',
    tags: ['幽默风趣', '程序员', '夜猫子'],
    rating: 4.6,
    reviewCount: 72,
    pricePerHour: 98,
    isOnline: true,
    isVerified: false,
    bio: '全栈工程师，热爱技术与创业。可以陪你聊职业规划、技术学习，或者只是吐槽一下工作中的那些事儿。',
    availableTimes: ['20:00', '21:00', '22:00', '23:00'],
    languages: ['中文', '英语'],
    specialties: ['职场解压', '学习陪伴'],
  },
  {
    id: 'c6',
    name: '吴悠',
    avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=wuyou',
    tags: ['美食家', '烘焙达人', '生活家'],
    rating: 4.8,
    reviewCount: 112,
    pricePerHour: 72,
    isOnline: false,
    isVerified: true,
    bio: '美食博主，擅长烘焙与家常菜。可以分享独家食谱，陪你探讨美食文化，让每一餐都充满幸福感。',
    availableTimes: ['11:00', '14:00', '17:00', '20:00'],
    languages: ['中文', '粤语'],
    specialties: ['美食探索', '情感倾诉'],
  },
];

export const mockOrders: Order[] = [
  {
    id: 'o1',
    companionId: 'c1',
    themeId: 't1',
    duration: 1,
    totalPrice: 88,
    status: 'completed',
    createdAt: '2024-01-15T10:00:00Z',
    scheduledAt: '2024-01-15T20:00:00Z',
  },
];

export const mockReviews: Review[] = [
  {
    id: 'r1',
    companionId: 'c1',
    userName: '匿名用户',
    rating: 5,
    content: '林悦老师非常温柔专业，倾听了我工作上的困扰，给了很多实用的建议。聊完之后感觉轻松多了！',
    createdAt: '2024-01-16T08:00:00Z',
  },
  {
    id: 'r2',
    companionId: 'c1',
    userName: '小雨',
    rating: 5,
    content: '第二次预约了，每次都能感受到真诚的关心。深夜有人倾听的感觉真的很好。',
    createdAt: '2024-01-14T09:00:00Z',
  },
  {
    id: 'r3',
    companionId: 'c1',
    userName: '阿明',
    rating: 4,
    content: '整体不错，就是预约时间有点紧张，希望可以增加更多时段。',
    createdAt: '2024-01-12T15:00:00Z',
  },
];

export const mockMessages: Message[] = [
  {
    id: 'm1',
    senderId: 'system',
    content: '订单已确认，您可以在约定时间开始沟通。',
    type: 'system',
    timestamp: '2024-01-15T19:55:00Z',
  },
  {
    id: 'm2',
    senderId: 'c1',
    content: '你好呀，我是林悦。很高兴能陪伴你度过这段时间。有什么想聊的吗？',
    type: 'text',
    timestamp: '2024-01-15T20:00:00Z',
  },
  {
    id: 'm3',
    senderId: 'u1',
    content: '最近工作压力好大，感觉快撑不住了...',
    type: 'text',
    timestamp: '2024-01-15T20:02:00Z',
  },
  {
    id: 'm4',
    senderId: 'c1',
    content: '听起来你真的很辛苦。愿意多说说吗？是什么让你感到压力最大呢？',
    type: 'text',
    timestamp: '2024-01-15T20:03:00Z',
  },
];
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add mock data and types"
```

---

## Task 3: Create Layout & Navigation Components

**Covers:** [S3]

**Files:**
- Create: `src/components/Layout.tsx`
- Create: `src/components/BottomNav.tsx`
- Create: `src/components/Header.tsx`

- [ ] **Step 1: Create Header component**

```typescript
// src/components/Header.tsx
import { Bell, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface HeaderProps {
  title?: string;
  showBack?: boolean;
  showNotification?: boolean;
}

export default function Header({ title, showBack = false, showNotification = true }: HeaderProps) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-50 bg-paper/95 backdrop-blur-sm border-b border-border">
      <div className="flex items-center justify-between h-12 px-4">
        <div className="flex items-center gap-2">
          {showBack ? (
            <button onClick={() => navigate(-1)} className="p-1 -ml-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <Shield className="w-5 h-5 text-teal" />
              <span className="font-semibold text-ink">Talk&Talk</span>
            </div>
          )}
          {title && <h1 className="text-base font-semibold text-ink">{title}</h1>}
        </div>
        {showNotification && (
          <button className="p-1 relative">
            <Bell className="w-5 h-5 text-muted-foreground" />
            <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-coral rounded-full" />
          </button>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Create BottomNav component**

```typescript
// src/components/BottomNav.tsx
import { Home, MessageSquare, User, Calendar } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

const navItems = [
  { path: '/', icon: Home, label: '首页' },
  { path: '/orders', icon: Calendar, label: '订单' },
  { path: '/messages', icon: MessageSquare, label: '消息' },
  { path: '/profile', icon: User, label: '我的' },
];

export default function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="sticky bottom-0 z-50 bg-paper border-t border-border">
      <div className="flex items-center justify-around h-14">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center gap-0.5 py-1 px-3 ${
                isActive ? 'text-ink' : 'text-muted-foreground'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-xs">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] **Step 3: Create Layout component**

```typescript
// src/components/Layout.tsx
import { Outlet } from 'react-router-dom';
import Header from './Header';
import BottomNav from './BottomNav';

interface LayoutProps {
  header?: {
    title?: string;
    showBack?: boolean;
    showNotification?: boolean;
  };
  showNav?: boolean;
}

export default function Layout({ header, showNav = true }: LayoutProps) {
  return (
    <div className="flex flex-col min-h-screen">
      {header && <Header {...header} />}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      {showNav && <BottomNav />}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add layout and navigation components"
```

---

## Task 4: Create Home/Discovery Page

**Covers:** [S4]

**Files:**
- Create: `src/pages/Home.tsx`
- Create: `src/components/ThemeCard.tsx`
- Create: `src/components/CompanionCard.tsx`

- [ ] **Step 1: Create ThemeCard component**

```typescript
// src/components/ThemeCard.tsx
import { Heart, Briefcase, BookOpen, Dumbbell, Plane, Utensils } from 'lucide-react';
import type { Theme } from '../data/types';

const iconMap = {
  Heart,
  Briefcase,
  BookOpen,
  Dumbbell,
  Plane,
  Utensils,
};

interface ThemeCardProps {
  theme: Theme;
  onClick: () => void;
}

export default function ThemeCard({ theme, onClick }: ThemeCardProps) {
  const Icon = iconMap[theme.icon as keyof typeof iconMap] || Heart;

  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-4 bg-card rounded-lg border border-border hover:border-teal transition-colors"
    >
      <div className="w-12 h-12 flex items-center justify-center rounded-full bg-teal/10">
        <Icon className="w-6 h-6 text-teal" />
      </div>
      <span className="text-sm font-medium text-ink">{theme.name}</span>
      <span className="text-xs text-muted-foreground text-center">{theme.description}</span>
    </button>
  );
}
```

- [ ] **Step 2: Create CompanionCard component**

```typescript
// src/components/CompanionCard.tsx
import { Star, BadgeCheck } from 'lucide-react';
import type { Companion } from '../data/types';

interface CompanionCardProps {
  companion: Companion;
  onClick: () => void;
}

export default function CompanionCard({ companion, onClick }: CompanionCardProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-3 p-3 bg-card rounded-lg border border-border hover:border-teal transition-colors text-left"
    >
      <div className="relative shrink-0">
        <img
          src={companion.avatar}
          alt={companion.name}
          className="w-16 h-16 rounded-lg object-cover"
        />
        {companion.isOnline && (
          <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-teal rounded-full border-2 border-card" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="font-medium text-ink">{companion.name}</span>
          {companion.isVerified && <BadgeCheck className="w-4 h-4 text-teal" />}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <Star className="w-3.5 h-3.5 fill-coral text-coral" />
          <span className="text-sm text-ink">{companion.rating}</span>
          <span className="text-xs text-muted-foreground">({companion.reviewCount})</span>
        </div>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {companion.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="px-1.5 py-0.5 text-xs bg-secondary rounded">
              {tag}
            </span>
          ))}
        </div>
        <div className="mt-1.5 text-sm text-coral font-medium">
          ¥{companion.pricePerHour}/小时
        </div>
      </div>
    </button>
  );
}
```

- [ ] **Step 3: Create Home page**

```typescript
// src/pages/Home.tsx
import { useNavigate } from 'react-router-dom';
import { Shield, ChevronRight } from 'lucide-react';
import ThemeCard from '../components/ThemeCard';
import CompanionCard from '../components/CompanionCard';
import { themes, companions } from '../data/mock';

export default function Home() {
  const navigate = useNavigate();

  const handleThemeClick = (themeId: string) => {
    navigate(`/companions?theme=${themeId}`);
  };

  const handleCompanionClick = (companionId: string) => {
    navigate(`/companion/${companionId}`);
  };

  return (
    <div className="p-4 space-y-6">
      {/* Safety Banner */}
      <div className="flex items-center gap-3 p-3 bg-teal/5 rounded-lg border border-teal/20">
        <Shield className="w-5 h-5 text-teal shrink-0" />
        <div className="flex-1">
          <p className="text-sm text-ink">平台安全提示</p>
          <p className="text-xs text-muted-foreground">所有陪伴者均通过实名认证，沟通全程受平台保护</p>
        </div>
      </div>

      {/* Themes Section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-ink">选择沟通主题</h2>
          <button className="flex items-center text-sm text-muted-foreground">
            全部 <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {themes.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              onClick={() => handleThemeClick(theme.id)}
            />
          ))}
        </div>
      </section>

      {/* Recommended Companions */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-ink">推荐陪伴者</h2>
          <button
            onClick={() => navigate('/companions')}
            className="flex items-center text-sm text-muted-foreground"
          >
            更多 <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          {companions.slice(0, 4).map((companion) => (
            <CompanionCard
              key={companion.id}
              companion={companion}
              onClick={() => handleCompanionClick(companion.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add home page with themes and companions"
```

---

## Task 5: Create Companion List Page

**Covers:** [S5]

**Files:**
- Create: `src/pages/CompanionList.tsx`

- [ ] **Step 1: Create CompanionList page**

```typescript
// src/pages/CompanionList.tsx
import { useState, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { SlidersHorizontal, X } from 'lucide-react';
import CompanionCard from '../components/CompanionCard';
import { companions, themes } from '../data/mock';

type FilterType = 'all' | 'online' | 'verified';
type SortType = 'rating' | 'price_asc' | 'price_desc';

export default function CompanionList() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const themeId = searchParams.get('theme');

  const [filter, setFilter] = useState<FilterType>('all');
  const [sort, setSort] = useState<SortType>('rating');
  const [showFilters, setShowFilters] = useState(false);

  const theme = themes.find((t) => t.id === themeId);

  const filteredCompanions = useMemo(() => {
    let result = companions;

    if (themeId) {
      result = result.filter((c) => c.specialties.includes(theme?.name || ''));
    }

    if (filter === 'online') {
      result = result.filter((c) => c.isOnline);
    } else if (filter === 'verified') {
      result = result.filter((c) => c.isVerified);
    }

    result = [...result].sort((a, b) => {
      if (sort === 'rating') return b.rating - a.rating;
      if (sort === 'price_asc') return a.pricePerHour - b.pricePerHour;
      if (sort === 'price_desc') return b.pricePerHour - a.pricePerHour;
      return 0;
    });

    return result;
  }, [themeId, theme, filter, sort]);

  return (
    <div className="p-4 space-y-4">
      {/* Filter Bar */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1 px-3 py-1.5 text-sm border border-border rounded-full hover:border-teal"
        >
          <SlidersHorizontal className="w-4 h-4" />
          筛选
        </button>
        {(['all', 'online', 'verified'] as FilterType[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded-full ${
              filter === f
                ? 'bg-ink text-white'
                : 'border border-border hover:border-teal'
            }`}
          >
            {f === 'all' ? '全部' : f === 'online' ? '在线' : '已认证'}
          </button>
        ))}
      </div>

      {/* Sort Options */}
      {showFilters && (
        <div className="flex items-center gap-2 p-3 bg-card rounded-lg border border-border">
          <span className="text-sm text-muted-foreground">排序：</span>
          {([
            { value: 'rating', label: '评分' },
            { value: 'price_asc', label: '价格 ↑' },
            { value: 'price_desc', label: '价格 ↓' },
          ] as { value: SortType; label: string }[]).map((s) => (
            <button
              key={s.value}
              onClick={() => setSort(s.value)}
              className={`px-2 py-1 text-sm rounded ${
                sort === s.value ? 'bg-teal/10 text-teal' : 'text-muted-foreground'
              }`}
            >
              {s.label}
            </button>
          ))}
          <button
            onClick={() => setShowFilters(false)}
            className="ml-auto p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Results */}
      {filteredCompanions.length > 0 ? (
        <div className="space-y-3">
          {filteredCompanions.map((companion) => (
            <CompanionCard
              key={companion.id}
              companion={companion}
              onClick={() => navigate(`/companion/${companion.id}`)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-muted-foreground">暂无符合条件的陪伴者</p>
          <button
            onClick={() => { setFilter('all'); setSort('rating'); }}
            className="mt-2 text-sm text-teal"
          >
            重置筛选
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add companion list page with filters"
```

---

## Task 6: Create Companion Detail Page

**Covers:** [S6]

**Files:**
- Create: `src/pages/CompanionDetail.tsx`

- [ ] **Step 1: Create CompanionDetail page**

```typescript
// src/pages/CompanionDetail.tsx
import { useParams, useNavigate } from 'react-router-dom';
import { Star, BadgeCheck, Clock, MessageCircle, Globe, Shield, Flag } from 'lucide-react';
import { companions, mockReviews } from '../data/mock';

export default function CompanionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const companion = companions.find((c) => c.id === id);

  if (!companion) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">陪伴者不存在</p>
        <button onClick={() => navigate('/')} className="mt-2 text-teal">
          返回首页
        </button>
      </div>
    );
  }

  const reviews = mockReviews.filter((r) => r.companionId === id);

  return (
    <div className="pb-20">
      {/* Profile Header */}
      <div className="relative">
        <div className="h-32 bg-gradient-to-br from-teal/20 to-coral/20" />
        <div className="px-4 -mt-12">
          <div className="flex items-end gap-4">
            <img
              src={companion.avatar}
              alt={companion.name}
              className="w-24 h-24 rounded-xl border-4 border-paper object-cover"
            />
            <div className="pb-2">
              <div className="flex items-center gap-1">
                <span className="text-xl font-semibold text-ink">{companion.name}</span>
                {companion.isVerified && <BadgeCheck className="w-5 h-5 text-teal" />}
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <Star className="w-4 h-4 fill-coral text-coral" />
                <span className="text-ink">{companion.rating}</span>
                <span className="text-muted-foreground">({companion.reviewCount} 评价)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="px-4 mt-4 space-y-4">
        {/* Tags */}
        <div className="flex flex-wrap gap-2">
          {companion.tags.map((tag) => (
            <span key={tag} className="px-2.5 py-1 text-sm bg-secondary rounded-full">
              {tag}
            </span>
          ))}
        </div>

        {/* Bio */}
        <p className="text-sm text-muted-foreground leading-relaxed">{companion.bio}</p>

        {/* Details */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 p-3 bg-card rounded-lg">
            <Clock className="w-4 h-4 text-teal" />
            <div>
              <p className="text-xs text-muted-foreground">可约时间</p>
              <p className="text-sm text-ink">{companion.availableTimes.length} 个时段</p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 bg-card rounded-lg">
            <Globe className="w-4 h-4 text-teal" />
            <div>
              <p className="text-xs text-muted-foreground">语言</p>
              <p className="text-sm text-ink">{companion.languages.join('、')}</p>
            </div>
          </div>
        </div>

        {/* Specialties */}
        <div>
          <h3 className="text-sm font-medium text-ink mb-2">擅长领域</h3>
          <div className="flex flex-wrap gap-2">
            {companion.specialties.map((s) => (
              <span key={s} className="px-2 py-1 text-sm bg-teal/10 text-teal rounded">
                {s}
              </span>
            ))}
          </div>
        </div>

        {/* Reviews */}
        <div>
          <h3 className="text-sm font-medium text-ink mb-2">用户评价</h3>
          <div className="space-y-3">
            {reviews.slice(0, 3).map((review) => (
              <div key={review.id} className="p-3 bg-card rounded-lg border border-border">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">{review.userName}</span>
                  <div className="flex items-center gap-1">
                    <Star className="w-3.5 h-3.5 fill-coral text-coral" />
                    <span className="text-sm text-ink">{review.rating}</span>
                  </div>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{review.content}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Action */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-paper border-t border-border">
        <div className="max-w-md mx-auto flex items-center gap-3">
          <div className="text-lg font-semibold text-coral">
            ¥{companion.pricePerHour}<span className="text-sm font-normal text-muted-foreground">/小时</span>
          </div>
          <button
            onClick={() => navigate(`/order/${companion.id}`)}
            className="flex-1 py-3 bg-ink text-white rounded-lg font-medium hover:bg-ink/90 transition-colors"
          >
            发起沟通
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add companion detail page"
```

---

## Task 7: Create Order Page

**Covers:** [S7]

**Files:**
- Create: `src/pages/Order.tsx`

- [ ] **Step 1: Create Order page**

```typescript
// src/pages/Order.tsx
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Clock, Shield, AlertCircle } from 'lucide-react';
import { companions, themes, mockUser } from '../data/mock';

const durations = [0.5, 1, 1.5, 2, 3];

export default function Order() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const companion = companions.find((c) => c.id === id);

  const [selectedTheme, setSelectedTheme] = useState(themes[0].id);
  const [selectedDuration, setSelectedDuration] = useState(1);
  const [agreedToRules, setAgreedToRules] = useState(false);

  if (!companion) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">陪伴者不存在</p>
        <button onClick={() => navigate('/')} className="mt-2 text-teal">
          返回首页
        </button>
      </div>
    );
  }

  const totalPrice = companion.pricePerHour * selectedDuration;

  const handleSubmit = () => {
    if (!mockUser.isVerified) {
      navigate('/verify');
      return;
    }
    navigate(`/chat/${companion.id}`);
  };

  return (
    <div className="p-4 space-y-6">
      {/* Companion Info */}
      <div className="flex items-center gap-3 p-3 bg-card rounded-lg border border-border">
        <img src={companion.avatar} alt={companion.name} className="w-12 h-12 rounded-lg" />
        <div>
          <p className="font-medium text-ink">{companion.name}</p>
          <p className="text-sm text-muted-foreground">¥{companion.pricePerHour}/小时</p>
        </div>
      </div>

      {/* Theme Selection */}
      <div>
        <h3 className="text-sm font-medium text-ink mb-2">选择沟通主题</h3>
        <div className="grid grid-cols-3 gap-2">
          {themes.map((theme) => (
            <button
              key={theme.id}
              onClick={() => setSelectedTheme(theme.id)}
              className={`p-2 text-sm rounded-lg border transition-colors ${
                selectedTheme === theme.id
                  ? 'border-teal bg-teal/10 text-teal'
                  : 'border-border hover:border-teal/50'
              }`}
            >
              {theme.name}
            </button>
          ))}
        </div>
      </div>

      {/* Duration Selection */}
      <div>
        <h3 className="text-sm font-medium text-ink mb-2">选择时长</h3>
        <div className="grid grid-cols-5 gap-2">
          {durations.map((d) => (
            <button
              key={d}
              onClick={() => setSelectedDuration(d)}
              className={`p-2 text-sm rounded-lg border transition-colors ${
                selectedDuration === d
                  ? 'border-teal bg-teal/10 text-teal'
                  : 'border-border hover:border-teal/50'
              }`}
            >
              {d}h
            </button>
          ))}
        </div>
      </div>

      {/* Price Summary */}
      <div className="p-4 bg-card rounded-lg border border-border space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">单价</span>
          <span>¥{companion.pricePerHour}/小时</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">时长</span>
          <span>{selectedDuration} 小时</span>
        </div>
        <div className="border-t border-border pt-2 flex justify-between">
          <span className="font-medium text-ink">合计</span>
          <span className="text-lg font-semibold text-coral">¥{totalPrice}</span>
        </div>
      </div>

      {/* Safety Rules */}
      <div className="p-4 bg-teal/5 rounded-lg border border-teal/20 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-teal" />
          <span className="font-medium text-ink">平台安全规范</span>
        </div>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>• 沟通内容受平台保护，严禁违法违规内容</li>
          <li>• 陪伴者仅提供情感支持与陪伴服务</li>
          <li>• 如遇不适可立即结束并举报</li>
          <li>• 未成年人禁止下单</li>
        </ul>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={agreedToRules}
            onChange={(e) => setAgreedToRules(e.target.checked)}
            className="rounded border-border"
          />
          <span className="text-sm text-ink">我已阅读并同意平台安全规范</span>
        </label>
      </div>

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={!agreedToRules}
        className="w-full py-3 bg-ink text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ink/90 transition-colors"
      >
        确认下单
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add order page with theme and duration selection"
```

---

## Task 8: Create Chat Page

**Covers:** [S8]

**Files:**
- Create: `src/pages/Chat.tsx`

- [ ] **Step 1: Create Chat page**

```typescript
// src/pages/Chat.tsx
import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Phone, Send, Mic, MoreVertical, ChevronLeft } from 'lucide-react';
import { companions, mockMessages, mockUser } from '../data/mock';
import type { Message } from '../data/types';

export default function Chat() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const companion = companions.find((c) => c.id === id);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<Message[]>(mockMessages);
  const [inputText, setInputText] = useState('');
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!companion) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">对话不存在</p>
        <button onClick={() => navigate('/')} className="mt-2 text-teal">
          返回首页
        </button>
      </div>
    );
  }

  const handleSend = () => {
    if (!inputText.trim()) return;

    const newMessage: Message = {
      id: `m${Date.now()}`,
      senderId: mockUser.id,
      content: inputText,
      type: 'text',
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, newMessage]);
    setInputText('');

    // Simulate companion reply
    setTimeout(() => {
      const reply: Message = {
        id: `m${Date.now() + 1}`,
        senderId: companion.id,
        content: '我理解你的感受，继续说说吧，我在这里陪着你。',
        type: 'text',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, reply]);
    }, 1500);
  };

  const handleComplete = () => {
    navigate(`/review/${companion.id}`);
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Chat Header */}
      <div className="flex items-center justify-between p-3 bg-paper border-b border-border">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} className="p-1">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <img src={companion.avatar} alt={companion.name} className="w-8 h-8 rounded-full" />
          <div>
            <p className="text-sm font-medium text-ink">{companion.name}</p>
            <p className="text-xs text-teal">{companion.isOnline ? '在线' : '离线'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCallActive(!isCallActive)}
            className={`p-2 rounded-full ${isCallActive ? 'bg-teal text-white' : 'hover:bg-secondary'}`}
          >
            <Phone className="w-4 h-4" />
          </button>
          <button className="p-2 hover:bg-secondary rounded-full">
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.senderId === mockUser.id ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[70%] px-3 py-2 rounded-lg text-sm ${
                message.senderId === mockUser.id
                  ? 'bg-ink text-white'
                  : message.senderId === 'system'
                  ? 'bg-muted text-muted-foreground text-xs'
                  : 'bg-card border border-border'
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Voice Call Overlay */}
      {isCallActive && (
        <div className="absolute inset-0 bg-ink/90 flex flex-col items-center justify-center text-white z-50">
          <img src={companion.avatar} alt={companion.name} className="w-24 h-24 rounded-full mb-4" />
          <p className="text-lg font-medium">{companion.name}</p>
          <p className="text-sm opacity-70 mt-1">语音通话中...</p>
          <button
            onClick={() => setIsCallActive(false)}
            className="mt-8 px-6 py-3 bg-destructive rounded-full"
          >
            结束通话
          </button>
        </div>
      )}

      {/* Input Area */}
      <div className="p-3 bg-paper border-t border-border">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsVoiceMode(!isVoiceMode)}
            className={`p-2 rounded-full ${isVoiceMode ? 'bg-teal text-white' : 'hover:bg-secondary'}`}
          >
            <Mic className="w-5 h-5" />
          </button>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="输入消息..."
            className="flex-1 px-3 py-2 bg-card border border-border rounded-full text-sm focus:outline-none focus:border-teal"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="p-2 bg-ink text-white rounded-full disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={handleComplete}
          className="w-full mt-2 py-2 text-sm text-teal border border-teal rounded-lg hover:bg-teal/10"
        >
          结束沟通并评价
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add chat page with messaging and voice call"
```

---

## Task 9: Create Review Page

**Covers:** [S9]

**Files:**
- Create: `src/pages/Review.tsx`

- [ ] **Step 1: Create Review page**

```typescript
// src/pages/Review.tsx
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Star } from 'lucide-react';
import { companions } from '../data/mock';

export default function Review() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const companion = companions.find((c) => c.id === id);

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [content, setContent] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (!companion) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">订单不存在</p>
        <button onClick={() => navigate('/')} className="mt-2 text-teal">
          返回首页
        </button>
      </div>
    );
  }

  const handleSubmit = () => {
    setSubmitted(true);
    setTimeout(() => navigate('/'), 2000);
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <div className="w-16 h-16 bg-teal/10 rounded-full flex items-center justify-center">
          <Star className="w-8 h-8 text-teal fill-teal" />
        </div>
        <h2 className="text-xl font-semibold text-ink">评价已提交</h2>
        <p className="text-muted-foreground">感谢您的反馈，这将帮助我们提供更好的服务</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      {/* Companion Info */}
      <div className="flex items-center gap-3 p-3 bg-card rounded-lg border border-border">
        <img src={companion.avatar} alt={companion.name} className="w-12 h-12 rounded-lg" />
        <div>
          <p className="font-medium text-ink">{companion.name}</p>
          <p className="text-sm text-muted-foreground">沟通已完成</p>
        </div>
      </div>

      {/* Rating */}
      <div className="text-center space-y-3">
        <p className="text-lg font-medium text-ink">为这次沟通打分</p>
        <div className="flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onMouseEnter={() => setHoverRating(star)}
              onMouseLeave={() => setHoverRating(0)}
              onClick={() => setRating(star)}
              className="p-1"
            >
              <Star
                className={`w-8 h-8 ${
                  star <= (hoverRating || rating)
                    ? 'fill-coral text-coral'
                    : 'text-muted-foreground'
                }`}
              />
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {rating === 0 ? '点击星星评分' : rating === 5 ? '非常满意' : rating >= 3 ? '满意' : '一般'}
        </p>
      </div>

      {/* Review Content */}
      <div>
        <label className="text-sm font-medium text-ink mb-2 block">评价内容（可选）</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="分享您的体验，帮助其他用户..."
          rows={4}
          className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm resize-none focus:outline-none focus:border-teal"
        />
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={rating === 0}
        className="w-full py-3 bg-ink text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ink/90 transition-colors"
      >
        提交评价
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add review page with star rating"
```

---

## Task 10: Create Orders List Page

**Covers:** [S10]

**Files:**
- Create: `src/pages/Orders.tsx`

- [ ] **Step 1: Create Orders page**

```typescript
// src/pages/Orders.tsx
import { useNavigate } from 'react-router-dom';
import { Clock, CheckCircle, XCircle, MessageCircle } from 'lucide-react';
import { mockOrders, companions } from '../data/mock';

const statusMap = {
  pending: { label: '待确认', icon: Clock, color: 'text-coral' },
  confirmed: { label: '已确认', icon: CheckCircle, color: 'text-teal' },
  in_progress: { label: '进行中', icon: MessageCircle, color: 'text-teal' },
  completed: { label: '已完成', icon: CheckCircle, color: 'text-muted-foreground' },
  cancelled: { label: '已取消', icon: XCircle, color: 'text-muted-foreground' },
};

export default function Orders() {
  const navigate = useNavigate();

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold text-ink">我的订单</h1>

      {mockOrders.length > 0 ? (
        <div className="space-y-3">
          {mockOrders.map((order) => {
            const companion = companions.find((c) => c.id === order.companionId);
            const status = statusMap[order.status];
            const StatusIcon = status.icon;

            return (
              <button
                key={order.id}
                onClick={() => navigate(`/chat/${order.companionId}`)}
                className="w-full flex items-center gap-3 p-3 bg-card rounded-lg border border-border hover:border-teal transition-colors text-left"
              >
                <img
                  src={companion?.avatar}
                  alt={companion?.name}
                  className="w-12 h-12 rounded-lg object-cover"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink">{companion?.name}</span>
                    <div className={`flex items-center gap-1 ${status.color}`}>
                      <StatusIcon className="w-4 h-4" />
                      <span className="text-sm">{status.label}</span>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {new Date(order.scheduledAt).toLocaleDateString('zh-CN')} · {order.duration}小时 · ¥{order.totalPrice}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Clock className="w-12 h-12 text-muted-foreground mb-2" />
          <p className="text-muted-foreground">暂无订单</p>
          <button
            onClick={() => navigate('/')}
            className="mt-2 text-sm text-teal"
          >
            去发现页看看
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add orders list page"
```

---

## Task 11: Create Profile Page

**Covers:** [S11]

**Files:**
- Create: `src/pages/Profile.tsx`

- [ ] **Step 1: Create Profile page**

```typescript
// src/pages/Profile.tsx
import { useNavigate } from 'react-router-dom';
import { User, Shield, ChevronRight, Phone, BadgeCheck } from 'lucide-react';
import { mockUser } from '../data/mock';

export default function Profile() {
  const navigate = useNavigate();

  const menuItems = [
    { icon: Shield, label: '实名认证', path: '/verify', showBadge: !mockUser.isVerified },
    { icon: Phone, label: '联系方式', path: '/contact' },
    { icon: User, label: '个人资料', path: '/edit-profile' },
  ];

  return (
    <div className="p-4 space-y-6">
      {/* User Card */}
      <div className="flex items-center gap-4 p-4 bg-card rounded-lg border border-border">
        <img
          src={mockUser.avatar}
          alt={mockUser.name}
          className="w-16 h-16 rounded-full object-cover"
        />
        <div>
          <div className="flex items-center gap-1">
            <span className="text-lg font-semibold text-ink">{mockUser.name}</span>
            {mockUser.isVerified && <BadgeCheck className="w-5 h-5 text-teal" />}
          </div>
          <p className="text-sm text-muted-foreground">{mockUser.phone}</p>
          {!mockUser.isVerified && (
            <button
              onClick={() => navigate('/verify')}
              className="mt-1 text-xs text-coral"
            >
              未认证，点击完成实名认证
            </button>
          )}
        </div>
      </div>

      {/* Menu */}
      <div className="space-y-2">
        {menuItems.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className="w-full flex items-center justify-between p-3 bg-card rounded-lg border border-border hover:border-teal transition-colors"
          >
            <div className="flex items-center gap-3">
              <item.icon className="w-5 h-5 text-muted-foreground" />
              <span className="text-ink">{item.label}</span>
            </div>
            <div className="flex items-center gap-2">
              {item.showBadge && (
                <span className="w-2 h-2 bg-coral rounded-full" />
              )}
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </div>
          </button>
        ))}
      </div>

      {/* Safety Info */}
      <div className="p-4 bg-teal/5 rounded-lg border border-teal/20">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-5 h-5 text-teal" />
          <span className="font-medium text-ink">平台保障</span>
        </div>
        <p className="text-sm text-muted-foreground">
          您的隐私与安全是我们的首要任务。所有沟通内容均经过加密，陪伴者均通过严格审核。
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add profile page"
```

---

## Task 12: Create Verification Page

**Covers:** [S12]

**Files:**
- Create: `src/pages/Verify.tsx`

- [ ] **Step 1: Create Verify page**

```typescript
// src/pages/Verify.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, CheckCircle, Upload } from 'lucide-react';

export default function Verify() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');

  const handleSubmit = () => {
    if (step < 3) {
      setStep(step + 1);
    } else {
      navigate('/profile');
    }
  };

  return (
    <div className="p-4 space-y-6">
      {/* Progress */}
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`flex-1 h-2 rounded-full ${
              s <= step ? 'bg-teal' : 'bg-secondary'
            }`}
          />
        ))}
      </div>

      {/* Step Content */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="text-center space-y-2">
            <Shield className="w-12 h-12 text-teal mx-auto" />
            <h2 className="text-xl font-semibold text-ink">实名认证</h2>
            <p className="text-sm text-muted-foreground">为了平台安全，需要完成实名认证</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-ink mb-1 block">真实姓名</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="请输入真实姓名"
                className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:border-teal"
              />
            </div>
            <div>
              <label className="text-sm text-ink mb-1 block">身份证号</label>
              <input
                type="text"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                placeholder="请输入身份证号"
                className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:border-teal"
              />
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="text-center space-y-2">
            <Upload className="w-12 h-12 text-teal mx-auto" />
            <h2 className="text-xl font-semibold text-ink">人脸识别</h2>
            <p className="text-sm text-muted-foreground">请进行人脸识别验证</p>
          </div>
          <div className="aspect-square bg-card rounded-lg border-2 border-dashed border-border flex items-center justify-center">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-2 rounded-full bg-secondary flex items-center justify-center">
                <User className="w-10 h-10 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">点击开始人脸识别</p>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="text-center space-y-2">
            <Phone className="w-12 h-12 text-teal mx-auto" />
            <h2 className="text-xl font-semibold text-ink">手机验证</h2>
            <p className="text-sm text-muted-foreground">验证您的手机号码</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-ink mb-1 block">手机号码</label>
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="请输入手机号"
                  className="flex-1 px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:border-teal"
                />
                <button className="px-3 py-2 text-sm bg-secondary rounded-lg whitespace-nowrap">
                  获取验证码
                </button>
              </div>
            </div>
            <div>
              <label className="text-sm text-ink mb-1 block">验证码</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="请输入验证码"
                className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:border-teal"
              />
            </div>
          </div>
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        className="w-full py-3 bg-ink text-white rounded-lg font-medium hover:bg-ink/90 transition-colors"
      >
        {step === 3 ? '完成认证' : '下一步'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add verification page with multi-step flow"
```

---

## Task 13: Create Messages Page

**Covers:** [S13]

**Files:**
- Create: `src/pages/Messages.tsx`

- [ ] **Step 1: Create Messages page**

```typescript
// src/pages/Messages.tsx
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Clock } from 'lucide-react';
import { companions, mockMessages } from '../data/mock';

export default function Messages() {
  const navigate = useNavigate();

  // Get unique conversations
  const conversations = companions.filter((c) =>
    mockMessages.some((m) => m.senderId === c.id || m.senderId === 'u1')
  );

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold text-ink">消息</h1>

      {conversations.length > 0 ? (
        <div className="space-y-2">
          {conversations.map((companion) => {
            const lastMessage = mockMessages
              .filter((m) => m.senderId === companion.id || m.senderId === 'u1')
              .slice(-1)[0];

            return (
              <button
                key={companion.id}
                onClick={() => navigate(`/chat/${companion.id}`)}
                className="w-full flex items-center gap-3 p-3 bg-card rounded-lg border border-border hover:border-teal transition-colors text-left"
              >
                <div className="relative">
                  <img
                    src={companion.avatar}
                    alt={companion.name}
                    className="w-12 h-12 rounded-lg object-cover"
                  />
                  {companion.isOnline && (
                    <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-teal rounded-full border-2 border-paper" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink">{companion.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {lastMessage && new Date(lastMessage.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {lastMessage?.content || '暂无消息'}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <MessageSquare className="w-12 h-12 text-muted-foreground mb-2" />
          <p className="text-muted-foreground">暂无消息</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: add messages page"
```

---

## Task 14: Setup Routing

**Covers:** [S14]

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Create routes**

```typescript
// src/App.tsx
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import CompanionList from './pages/CompanionList';
import CompanionDetail from './pages/CompanionDetail';
import Order from './pages/Order';
import Chat from './pages/Chat';
import Review from './pages/Review';
import Orders from './pages/Orders';
import Messages from './pages/Messages';
import Profile from './pages/Profile';
import Verify from './pages/Verify';

function App() {
  return (
    <Routes>
      <Route element={<Layout showNav={true} />}>
        <Route path="/" element={<Home />} />
        <Route path="/companions" element={<CompanionList />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/profile" element={<Profile />} />
      </Route>
      <Route element={<Layout header={{ showBack: true }} showNav={false} />}>
        <Route path="/companion/:id" element={<CompanionDetail />} />
        <Route path="/order/:id" element={<Order />} />
        <Route path="/review/:id" element={<Review />} />
        <Route path="/verify" element={<Verify />} />
      </Route>
      <Route path="/chat/:id" element={<Chat />} />
    </Routes>
  );
}

export default App;
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: setup app routing"
```

---

## Task 15: Build & Test

**Covers:** [S15]

- [ ] **Step 1: Build project**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Start dev server**

```bash
npm run dev
```

Expected: Server starts on `http://localhost:5173`

- [ ] **Step 3: Manual testing checklist**

- [ ] Mobile width (390px) layout correct
- [ ] Mobile width (430px) layout correct
- [ ] Desktop centered preview correct
- [ ] Home page: themes display, companions display
- [ ] Theme click navigates to filtered companion list
- [ ] Companion list: filters work, sort works, empty state works
- [ ] Companion detail: info displays, bottom action bar fixed
- [ ] Order page: theme selection, duration selection, price calculation
- [ ] Unverified user redirected to verification
- [ ] Chat: send message, voice call overlay, complete order
- [ ] Review: star rating, submit, success state
- [ ] Orders list: displays with status
- [ ] Messages: conversation list
- [ ] Profile: user info, verification badge, menu navigation
- [ ] Verification: multi-step flow

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: complete mvp demo with all features"
```

---

## Summary

This plan implements a complete mobile-first H5 demo for the Talk & Talk companion platform. The implementation includes:

1. **Project Setup**: Vite + React + TypeScript + Tailwind CSS
2. **Mock Data**: Companions, themes, orders, reviews, messages
3. **Core Pages**: Home, Companion List, Companion Detail, Order, Chat, Review, Orders, Messages, Profile, Verification
4. **User Flow**: Discovery → Detail → Order → Chat → Review
5. **Features**: Filtering, sorting, real-time chat simulation, voice call UI, multi-step verification

All backend services are mocked, making this a fully functional frontend demo that can be demonstrated in a browser.