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
