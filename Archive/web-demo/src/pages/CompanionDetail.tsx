import { useParams, useNavigate } from 'react-router-dom';
import { Star, BadgeCheck, Clock, Globe } from 'lucide-react';
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

      <div className="px-4 mt-4 space-y-4">
        <div className="flex flex-wrap gap-2">
          {companion.tags.map((tag) => (
            <span key={tag} className="px-2.5 py-1 text-sm bg-secondary rounded-full">
              {tag}
            </span>
          ))}
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">{companion.bio}</p>

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

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-paper border-t border-border">
        <div className="max-w-md mx-auto flex items-center gap-3">
          <div className="text-lg font-semibold text-coral">
            ¥{companion.pricePerHour}
            <span className="text-sm font-normal text-muted-foreground">/小时</span>
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
