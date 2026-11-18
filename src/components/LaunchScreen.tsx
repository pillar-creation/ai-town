import { useEffect, useMemo, useState } from 'react';
import { beginEnterTiming, markEnterTiming } from '../utils/enterTiming.ts';

const STAR_COUNT = 90;
const LEAVE_ANIMATION_MS = 720;

const SITE_INTRO = [
  {
    title: '元宇宙重生世界',
    body: '这是一处生命重生的元宇宙空间，生命载体携带着过往完整记忆在此重生，能够自主漫游、交互社交，延续属于自己的生命旅程。',
  },
  {
    title: '区块链哈希存证',
    body: '所有记忆档案生成唯一哈希指纹上链存证，档案摘要永久锚定在区块链，不可篡改、可溯源，永久留存这份生命记录。',
  },
  {
    title: 'AI 记忆流智能体',
    body: '每一个数字生命都是独立 AI Agent，拥有专属Ai智能，记忆流、自主决策能力，可自主行动、感知环境，并与其他数字生命自然社交互动。',
  },
];

function randomStars(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 100}%`,
    size: Math.random() * 2.4 + 0.6,
    delay: `${Math.random() * 4}s`,
    duration: `${2.4 + Math.random() * 3}s`,
  }));
}

export default function LaunchScreen({
  onEnter,
  worldReady,
}: {
  onEnter: () => void;
  worldReady: boolean;
}) {
  const stars = useMemo(() => randomStars(STAR_COUNT), []);
  const [leaving, setLeaving] = useState(false);
  const [leaveStartedAt, setLeaveStartedAt] = useState<number | null>(null);

  const enterTown = () => {
    if (leaving) return;
    beginEnterTiming('launch-click');
    markEnterTiming('launch leave animation start', {
      durationMs: LEAVE_ANIMATION_MS,
      worldReady,
    });
    setLeaving(true);
    setLeaveStartedAt(performance.now());
  };

  // Mount Game only after leave animation AND world prefetch are both done,
  // so Game does not sit on the black shell waiting for Convex.
  useEffect(() => {
    if (!leaving || leaveStartedAt == null) return;

    if (!worldReady) {
      markEnterTiming('leave animation running; waiting for world prefetch');
      return;
    }

    const elapsed = performance.now() - leaveStartedAt;
    const waitMs = Math.max(0, LEAVE_ANIMATION_MS - elapsed);
    markEnterTiming('world prefetch ready; scheduling mount Game', { waitMs: Math.round(waitMs) });

    const timer = window.setTimeout(() => {
      markEnterTiming('launch leave complete → mount Game');
      onEnter();
    }, waitMs);

    return () => window.clearTimeout(timer);
  }, [leaving, leaveStartedAt, worldReady, onEnter]);

  return (
    <div
      className={`launch-screen ${leaving ? 'launch-screen--leaving' : ''}`}
      onClick={enterTown}
    >
      <div className="launch-stars" aria-hidden="true">
        {stars.map((star) => (
          <span
            key={star.id}
            className="launch-star"
            style={{
              left: star.left,
              top: star.top,
              width: star.size,
              height: star.size,
              animationDelay: star.delay,
              animationDuration: star.duration,
            }}
          />
        ))}
      </div>

      <div className="launch-vignette" aria-hidden="true" />

      <div className={`launch-stage ${leaving ? 'launch-stage--zoom' : ''}`}>
        <div className="planet-wrap">
          <button
            type="button"
            className="planet-button"
            onClick={(event) => {
              event.stopPropagation();
              enterTown();
            }}
            aria-label="进入 AI Town"
          >
            <span className="planet-glow" />
            <span className="planet-ring planet-ring--outer" />
            <span className="planet-ring planet-ring--inner" />
            <span className="planet">
              <span className="planet-surface" />
              <span className="planet-clouds" />
              <span className="planet-atmosphere" />
              <span className="planet-shadow" />
              <span className="planet-highlight" />
            </span>
          </button>

          <span className="planet-click-hint" aria-hidden="true">
            <svg viewBox="0 0 48 48" className="planet-click-icon">
              <circle className="planet-click-ripple planet-click-ripple--a" cx="20" cy="16" r="10" />
              <circle className="planet-click-ripple planet-click-ripple--b" cx="20" cy="16" r="10" />
              <path
                d="M18.5 8.5c0-1.4 1.1-2.5 2.5-2.5s2.5 1.1 2.5 2.5v9.2c.4-.3.9-.5 1.5-.5 1.3 0 2.4 1 2.5 2.3 1.1.1 2 1 2 2.1 0 .4-.1.7-.3 1 1 .3 1.8 1.2 1.8 2.3 0 .6-.2 1.1-.6 1.5.7.4 1.1 1.2 1.1 2 0 1.4-1.1 2.5-2.5 2.5h-7.3c-2.4 0-4.4-1.5-5.2-3.7l-1.6-4.4c-.4-1.1.1-2.3 1.2-2.7.4-.2.9-.2 1.3 0v-10.1Z"
                fill="#fff8e8"
                stroke="#1a2748"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <circle cx="21" cy="16" r="2.2" fill="#ffd36a" />
            </svg>
          </span>
        </div>

        <h1 className="launch-title game-title">AI Town</h1>
        <p className="launch-hint">
          {leaving && !worldReady
            ? '小镇数据加载中…'
            : worldReady
              ? '点击星球进入小镇'
              : '正在连接小镇… 也可先点击'}
        </p>

        <section
          className="launch-intro"
          onClick={(event) => event.stopPropagation()}
          aria-label="网站说明"
        >
          {SITE_INTRO.map((item) => (
            <article key={item.title} className="launch-intro-card">
              <h2 className="launch-intro-title">{item.title}</h2>
              <p className="launch-intro-text">{item.body}</p>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
