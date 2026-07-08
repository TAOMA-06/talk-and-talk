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
