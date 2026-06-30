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
      <div className="flex items-center gap-3 p-3 bg-card rounded-lg border border-border">
        <img src={companion.avatar} alt={companion.name} className="w-12 h-12 rounded-lg" />
        <div>
          <p className="font-medium text-ink">{companion.name}</p>
          <p className="text-sm text-muted-foreground">沟通已完成</p>
        </div>
      </div>

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
