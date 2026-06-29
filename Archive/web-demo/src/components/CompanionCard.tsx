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
