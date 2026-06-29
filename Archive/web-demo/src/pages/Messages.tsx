import { useNavigate } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { companions, mockMessages } from '../data/mock';

export default function Messages() {
  const navigate = useNavigate();

  // Get unique conversations
  const conversations = companions.filter((c) =>
    mockMessages.some((m) => m.senderId === c.id || m.senderId === 'u1')
  );

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold text-ink">消息</h1>

      {conversations.length > 0 ? (
        <div className="space-y-2">
          {conversations.map((companion) => {
            const lastMessage = mockMessages
              .filter((m) => m.senderId === companion.id || m.senderId === 'u1')
              .slice(-1)[0];

            return (
              <button
                key={companion.id}
                onClick={() => navigate(`/chat/${companion.id}`)}
                className="w-full flex items-center gap-3 p-3 bg-card rounded-lg border border-border hover:border-teal transition-colors text-left"
              >
                <div className="relative">
                  <img
                    src={companion.avatar}
                    alt={companion.name}
                    className="w-12 h-12 rounded-lg object-cover"
                  />
                  {companion.isOnline && (
                    <span className="absolute -bottom-1 -right-1 w-3 h-3 bg-teal rounded-full border-2 border-paper" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-ink">{companion.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {lastMessage && new Date(lastMessage.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {lastMessage?.content || '暂无消息'}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <MessageSquare className="w-12 h-12 text-muted-foreground mb-2" />
          <p className="text-muted-foreground">暂无消息</p>
        </div>
      )}
    </div>
  );
}
