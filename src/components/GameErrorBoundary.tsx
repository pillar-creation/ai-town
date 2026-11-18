import { Component, ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Convex useQuery throws server errors during render. Without a boundary the
 * whole app unmounts to a blank body background.
 */
export class GameErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  private retry = () => {
    const message = this.state.error?.message ?? '';
    // Convex keeps failed query errors in the client; remount alone rethrows.
    if (/timed out|timeout|CONVEX/i.test(message)) {
      window.location.reload();
      return;
    }
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      const message = this.state.error.message || '未知错误';
      const timedOut = /timed out|timeout/i.test(message);
      return (
        <div className="w-full h-full min-h-0 flex flex-col items-center justify-center gap-4 p-6 text-center bg-brown-900 text-brown-100">
          <p className="text-lg font-display tracking-wide">小镇连接中断</p>
          <p className="max-w-md text-sm opacity-90 font-system">
            {timedOut
              ? '后端查询超时（Convex 过载）。点重试会刷新页面；若反复出现，请重启 Docker 里的 convex backend。'
              : message}
          </p>
          <button
            type="button"
            className="px-4 py-2 rounded bg-brown-700 hover:bg-brown-600 border border-brown-500 font-system"
            onClick={this.retry}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
