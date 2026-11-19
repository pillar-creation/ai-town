import React from 'react';
import ReactDOM from 'react-dom/client';
import Home from './App.tsx';
import './index.css';
import 'uplot/dist/uPlot.min.css';
import 'react-toastify/dist/ReactToastify.css';
import ConvexClientProvider from './components/ConvexClientProvider.tsx';
import { GameErrorBoundary } from './components/GameErrorBoundary.tsx';
import MonitorPage, { shouldShowMonitor } from './components/MonitorPage.tsx';

const showMonitor = shouldShowMonitor();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConvexClientProvider>
      <GameErrorBoundary>
        {showMonitor ? <MonitorPage /> : <Home />}
      </GameErrorBoundary>
    </ConvexClientProvider>
  </React.StrictMode>,
);
