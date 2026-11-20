import { useAuthActions } from '@convex-dev/auth/react';
import { FormEvent, useState } from 'react';
import type { AuthStep } from '../types';

export default function EmailOtpForm() {
  const { signIn } = useAuthActions();
  const [step, setStep] = useState<AuthStep>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSendOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const formData = new FormData(event.currentTarget);
    try {
      await signIn('resend-otp', formData);
      setEmail(String(formData.get('email') ?? ''));
      setStep('otp');
      setMessage('验证码已发送，请查收邮箱');
    } catch (e: any) {
      setError(e?.message ?? '发送验证码失败');
    } finally {
      setBusy(false);
    }
  };

  const onSendMagicLink = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const formData = new FormData();
    formData.set('email', email);
    try {
      await signIn('resend', formData);
      setMessage('登录链接已发送，请查收邮箱并点击链接');
    } catch (e: any) {
      setError(e?.message ?? '发送登录链接失败');
    } finally {
      setBusy(false);
    }
  };

  const onVerifyOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const formData = new FormData(event.currentTarget);
    try {
      await signIn('resend-otp', formData);
      setMessage('登录成功');
    } catch (e: any) {
      setError(e?.message ?? '验证码无效或已过期');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'otp') {
    return (
      <form className="auth-form" onSubmit={onVerifyOtp}>
        <p className="auth-form-hint">验证码已发至 {email}</p>
        <label className="auth-label">
          验证码
          <input
            className="auth-input"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="8 位数字"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </label>
        <input type="hidden" name="email" value={email} />
        <div className="auth-actions">
          <button className="auth-button auth-button--primary" type="submit" disabled={busy}>
            {busy ? '验证中…' : '验证并登录'}
          </button>
          <button
            className="auth-button"
            type="button"
            disabled={busy}
            onClick={() => {
              setStep('email');
              setCode('');
              setMessage(null);
              setError(null);
            }}
          >
            换邮箱
          </button>
        </div>
        {message && <p className="auth-message">{message}</p>}
        {error && <p className="auth-error">{error}</p>}
      </form>
    );
  }

  return (
    <form
      className="auth-form"
      onSubmit={onSendOtp}
      onChange={(e) => {
        const target = e.target as HTMLInputElement;
        if (target.name === 'email') setEmail(target.value);
      }}
    >
      <label className="auth-label">
        邮箱
        <input
          className="auth-input"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <div className="auth-actions">
        <button className="auth-button auth-button--primary" type="submit" disabled={busy || !email}>
          {busy ? '发送中…' : '发送验证码'}
        </button>
        <button
          className="auth-button"
          type="button"
          disabled={busy || !email}
          onClick={onSendMagicLink}
        >
          发送登录链接
        </button>
      </div>
      {message && <p className="auth-message">{message}</p>}
      {error && <p className="auth-error">{error}</p>}
    </form>
  );
}
