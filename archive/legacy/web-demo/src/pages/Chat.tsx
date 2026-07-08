import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Phone, Send, Mic, MoreVertical, ChevronLeft } from 'lucide-react';
import { companions, mockMessages, mockUser } from '../data/mock';
import type { Message } from '../data/types';

export default function Chat() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const companion = companions.find((c) => c.id === id);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<Message[]>(mockMessages);
  const [inputText, setInputText] = useState('');
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isCallActive, setIsCallActive] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!companion) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">对话不存在</p>
        <button onClick={() => navigate('/')} className="mt-2 text-teal">
          返回首页
        </button>
      </div>
    );
  }

  const handleSend = () => {
    if (!inputText.trim()) return;

    const newMessage: Message = {
      id: `m${Date.now()}`,
      senderId: mockUser.id,
      content: inputText,
      type: 'text',
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, newMessage]);
    setInputText('');

    setTimeout(() => {
      const reply: Message = {
        id: `m${Date.now() + 1}`,
        senderId: companion.id,
        content: '我理解你的感受，继续说说吧，我在这里陪着你。',
        type: 'text',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, reply]);
    }, 1500);
  };

  const handleComplete = () => {
    navigate(`/review/${companion.id}`);
  };

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center justify-between p-3 bg-paper border-b border-border">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} className="p-1">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <img src={companion.avatar} alt={companion.name} className="w-8 h-8 rounded-full" />
          <div>
            <p className="text-sm font-medium text-ink">{companion.name}</p>
            <p className="text-xs text-teal">{companion.isOnline ? '在线' : '离线'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCallActive(!isCallActive)}
            className={`p-2 rounded-full ${isCallActive ? 'bg-teal text-white' : 'hover:bg-secondary'}`}
          >
            <Phone className="w-4 h-4" />
          </button>
          <button className="p-2 hover:bg-secondary rounded-full">
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.senderId === mockUser.id ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[70%] px-3 py-2 rounded-lg text-sm ${
                message.senderId === mockUser.id
                  ? 'bg-ink text-white'
                  : message.senderId === 'system'
                  ? 'bg-muted text-muted-foreground text-xs'
                  : 'bg-card border border-border'
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {isCallActive && (
        <div className="absolute inset-0 bg-ink/90 flex flex-col items-center justify-center text-white z-50">
          <img src={companion.avatar} alt={companion.name} className="w-24 h-24 rounded-full mb-4" />
          <p className="text-lg font-medium">{companion.name}</p>
          <p className="text-sm opacity-70 mt-1">语音通话中...</p>
          <button
            onClick={() => setIsCallActive(false)}
            className="mt-8 px-6 py-3 bg-destructive rounded-full"
          >
            结束通话
          </button>
        </div>
      )}

      <div className="p-3 bg-paper border-t border-border">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsVoiceMode(!isVoiceMode)}
            className={`p-2 rounded-full ${isVoiceMode ? 'bg-teal text-white' : 'hover:bg-secondary'}`}
          >
            <Mic className="w-5 h-5" />
          </button>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="输入消息..."
            className="flex-1 px-3 py-2 bg-card border border-border rounded-full text-sm focus:outline-none focus:border-teal"
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="p-2 bg-ink text-white rounded-full disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={handleComplete}
          className="w-full mt-2 py-2 text-sm text-teal border border-teal rounded-lg hover:bg-teal/10"
        >
          结束沟通并评价
        </button>
      </div>
    </div>
  );
}
