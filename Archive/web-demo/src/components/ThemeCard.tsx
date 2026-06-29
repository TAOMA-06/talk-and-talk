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
