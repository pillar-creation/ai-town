import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react';
import { useAuthSession } from '../hooks/useAuthSession';
import EmailOtpForm from './EmailOtpForm';

function SignedInView() {
  const { session, signOut } = useAuthSession();
  return (
    <div className="auth-signed-in">
      <p className="auth-status">已验证访客</p>
      <p className="auth-email">{session?.email ?? session?.name ?? '已登录'}</p>
      <button className="auth-button" type="button" onClick={() => void signOut()}>
        退出登录
      </button>
    </div>
  );
}

export default function AuthPanel() {
  return (
    <aside
      className="auth-panel"
      onClick={(event) => event.stopPropagation()}
      aria-label="邮箱注册与登录"
    >
      <h2 className="auth-panel-title">注册 / 登录</h2>
      <p className="auth-panel-lead">邮箱验证码或登录链接均可；游客也可直接进入小镇。</p>
      <AuthLoading>
        <p className="auth-form-hint">登录态加载中…</p>
      </AuthLoading>
      <Unauthenticated>
        <EmailOtpForm />
      </Unauthenticated>
      <Authenticated>
        <SignedInView />
      </Authenticated>
    </aside>
  );
}
