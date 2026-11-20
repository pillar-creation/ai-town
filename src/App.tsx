import Game from './components/Game.tsx';

import { ToastContainer } from 'react-toastify';
import a16zImg from '../assets/a16z.png';
import { Authenticated, Unauthenticated } from 'convex/react';
import { useCallback, useState } from 'react';
import { useAuthSession } from './auth';
import LaunchScreen from './components/LaunchScreen.tsx';
import { markEnterTiming } from './utils/enterTiming.ts';
import { usePrefetchWorldData } from './hooks/usePrefetchWorldData.ts';

function InGameAuthChrome() {
  const { session, signOut } = useAuthSession();
  return (
    <div className="p-3 absolute top-0 right-0 z-10 text-sm pointer-events-auto">
      <Authenticated>
        <div className="flex items-center gap-2 rounded-lg bg-black/45 px-3 py-1.5 text-white backdrop-blur">
          <span className="max-w-[12rem] truncate opacity-90">{session?.email ?? '已登录'}</span>
          <button
            type="button"
            className="underline opacity-80 hover:opacity-100"
            onClick={() => void signOut()}
          >
            退出
          </button>
        </div>
      </Authenticated>
      <Unauthenticated>
        <div className="rounded-lg bg-black/45 px-3 py-1.5 text-white/80 backdrop-blur">游客</div>
      </Unauthenticated>
    </div>
  );
}

export default function Home() {
  const [enteredTown, setEnteredTown] = useState(false);
  // Keep subscriptions alive across the launch → Game transition so enter hits cache.
  const { ready: worldPrefetchReady } = usePrefetchWorldData();

  const handleEnter = useCallback(() => {
    markEnterTiming('App enteredTown=true');
    setEnteredTown(true);
  }, []);

  if (!enteredTown) {
    return <LaunchScreen worldReady={worldPrefetchReady} onEnter={handleEnter} />;
  }

  return (
    <main className="relative h-screen overflow-hidden font-body game-background">
      <InGameAuthChrome />

      <div className="w-full h-screen relative isolate overflow-hidden flex flex-col">
        <h1 className="pointer-events-none absolute top-2 left-0 right-0 z-10 mx-auto text-3xl sm:text-5xl font-bold font-display leading-none tracking-wide game-title w-full text-center">
          伊甸园
        </h1>

        <div className="flex-1 min-h-0 w-full">
          <Game />
        </div>

        <footer className="absolute justify-end bottom-0 left-0 w-full flex items-center gap-3 p-4 flex-wrap pointer-events-none z-10">
          <a href="https://a16z.com">
            <img className="w-8 h-8 pointer-events-auto" src={a16zImg} alt="a16z" />
          </a>
        </footer>
        <ToastContainer position="bottom-right" autoClose={2000} closeOnClick theme="dark" />
      </div>
    </main>
  );
}
