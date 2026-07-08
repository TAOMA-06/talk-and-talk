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
      <div className="flex items-center gap-3 p-3 bg-teal/5 rounded-lg border border-teal/20">
        <Shield className="w-5 h-5 text-teal shrink-0" />
        <div className="flex-1">
          <p className="text-sm text-ink">平台安全提示</p>
          <p className="text-xs text-muted-foreground">所有陪伴者均通过实名认证，沟通全程受平台保护</p>
        </div>
      </div>

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
