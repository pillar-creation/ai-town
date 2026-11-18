import Game from './components/Game.tsx';

import { ToastContainer } from 'react-toastify';
import a16zImg from '../assets/a16z.png';
import convexImg from '../assets/convex.svg';
// import { UserButton } from '@clerk/clerk-react';
// import { Authenticated, Unauthenticated } from 'convex/react';
// import LoginButton from './components/buttons/LoginButton.tsx';
import { useCallback, useState } from 'react';
import PoweredByConvex from './components/PoweredByConvex.tsx';
import LaunchScreen from './components/LaunchScreen.tsx';
import { markEnterTiming } from './utils/enterTiming.ts';
import { usePrefetchWorldData } from './hooks/usePrefetchWorldData.ts';

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
      <PoweredByConvex />

      {/*<div className="p-3 absolute top-0 right-0 z-10 text-2xl">
        <Authenticated>
          <UserButton afterSignOutUrl="/ai-town" />
        </Authenticated>

        <Unauthenticated>
          <LoginButton />
        </Unauthenticated>
      </div> */}

      <div className="w-full h-screen relative isolate overflow-hidden flex flex-col">
        <h1 className="pointer-events-none absolute top-2 left-0 right-0 z-10 mx-auto text-3xl sm:text-5xl font-bold font-display leading-none tracking-wide game-title w-full text-center">
          AI Town
        </h1>

        <div className="flex-1 min-h-0 w-full">
          <Game />
        </div>

        <footer className="absolute justify-end bottom-0 left-0 w-full flex items-center gap-3 p-4 flex-wrap pointer-events-none z-10">
          <a href="https://a16z.com">
            <img className="w-8 h-8 pointer-events-auto" src={a16zImg} alt="a16z" />
          </a>
          <a href="https://convex.dev/c/ai-town">
            <img className="w-20 h-8 pointer-events-auto" src={convexImg} alt="Convex" />
          </a>
        </footer>
        <ToastContainer position="bottom-right" autoClose={2000} closeOnClick theme="dark" />
      </div>
    </main>
  );
}
