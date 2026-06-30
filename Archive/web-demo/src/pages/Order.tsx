import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Shield } from 'lucide-react';
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
      <div className="flex items-center gap-3 p-3 bg-card rounded-lg border border-border">
        <img src={companion.avatar} alt={companion.name} className="w-12 h-12 rounded-lg" />
        <div>
          <p className="font-medium text-ink">{companion.name}</p>
          <p className="text-sm text-muted-foreground">¥{companion.pricePerHour}/小时</p>
        </div>
      </div>

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
