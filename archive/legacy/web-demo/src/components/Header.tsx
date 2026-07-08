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
