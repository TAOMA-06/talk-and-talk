import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Upload, Phone, User } from 'lucide-react';

export default function Verify() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');

  const handleSubmit = () => {
    if (step < 3) {
      setStep(step + 1);
    } else {
      navigate('/profile');
    }
  };

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`flex-1 h-2 rounded-full ${
              s <= step ? 'bg-teal' : 'bg-secondary'
            }`}
          />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div className="text-center space-y-2">
            <Shield className="w-12 h-12 text-teal mx-auto" />
            <h2 className="text-xl font-semibold text-ink">实名认证</h2>
            <p className="text-sm text-muted-foreground">为了平台安全，需要完成实名认证</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-ink mb-1 block">真实姓名</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="请输入真实姓名"
                className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:border-teal"
              />
            </div>
            <div>
              <label className="text-sm text-ink mb-1 block">身份证号</label>
              <input
                type="text"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                placeholder="请输入身份证号"
                className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:border-teal"
              />
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="text-center space-y-2">
            <Upload className="w-12 h-12 text-teal mx-auto" />
            <h2 className="text-xl font-semibold text-ink">人脸识别</h2>
            <p className="text-sm text-muted-foreground">请进行人脸识别验证</p>
          </div>
          <div className="aspect-square bg-card rounded-lg border-2 border-dashed border-border flex items-center justify-center">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-2 rounded-full bg-secondary flex items-center justify-center">
                <User className="w-10 h-10 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">点击开始人脸识别</p>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="text-center space-y-2">
            <Phone className="w-12 h-12 text-teal mx-auto" />
            <h2 className="text-xl font-semibold text-ink">手机验证</h2>
            <p className="text-sm text-muted-foreground">验证您的手机号码</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-ink mb-1 block">手机号码</label>
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="请输入手机号"
                  className="flex-1 px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:border-teal"
                />
                <button className="px-3 py-2 text-sm bg-secondary rounded-lg whitespace-nowrap">
                  获取验证码
                </button>
              </div>
            </div>
            <div>
              <label className="text-sm text-ink mb-1 block">验证码</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="请输入验证码"
                className="w-full px-3 py-2 bg-card border border-border rounded-lg text-sm focus:outline-none focus:border-teal"
              />
            </div>
          </div>
        </div>
      )}

      <button
        onClick={handleSubmit}
        className="w-full py-3 bg-ink text-white rounded-lg font-medium hover:bg-ink/90 transition-colors"
      >
        {step === 3 ? '完成认证' : '下一步'}
      </button>
    </div>
  );
}
