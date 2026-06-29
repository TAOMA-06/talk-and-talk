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
