import { Doc } from '../../convex/_generated/dataModel';
import { useEffect, useRef, useState } from 'react';

export function useHistoricalTime(engineStatus?: Doc<'engines'>) {
  const timeManager = useRef(new HistoricalTimeManager());
  const rafRef = useRef<number>();
  const [historicalTime, setHistoricalTime] = useState<number | undefined>(undefined);
  if (engineStatus) {
    timeManager.current.receive(engineStatus);
  }
  const updateTime = (performanceNow: number) => {
    // We don't need sub-millisecond precision for interpolation, so just use `Date.now()`.
    const now = Date.now();
    setHistoricalTime(timeManager.current.historicalServerTime(now));
    rafRef.current = requestAnimationFrame(updateTime);
  };
  useEffect(() => {
    rafRef.current = requestAnimationFrame(updateTime);
    return () => cancelAnimationFrame(rafRef.current!);
  }, []);
  return { historicalTime, timeManager: timeManager.current };
}

type ServerTimeInterval = {
  startTs: number;
  endTs: number;
};

export class HistoricalTimeManager {
  intervals: Array<ServerTimeInterval> = [];
  prevClientTs?: number;
  prevServerTs?: number;
  totalDuration: number = 0;

  latestEngineStatus?: Doc<'engines'>;

  receive(engineStatus: Doc<'engines'>) {
    this.latestEngineStatus = engineStatus;
    if (!engineStatus.currentTime || !engineStatus.lastStepTs) {
      return;
    }
    const latest = this.intervals[this.intervals.length - 1];
    if (latest) {
      if (latest.endTs === engineStatus.currentTime) {
        return;
      }
      // Engine restart / reconnect / clock rewind can send an older currentTime.
      // Throwing here runs during React render and blanks the whole app.
      if (latest.endTs > engineStatus.currentTime) {
        console.warn('Received out-of-order engine status; resetting time buffer', {
          previousEndTs: latest.endTs,
          currentTime: engineStatus.currentTime,
        });
        this.intervals = [];
        this.totalDuration = 0;
        this.prevClientTs = undefined;
        this.prevServerTs = undefined;
      }
    }
    const newInterval = {
      startTs: engineStatus.lastStepTs,
      endTs: engineStatus.currentTime,
    };
    this.intervals.push(newInterval);
    this.totalDuration += newInterval.endTs - newInterval.startTs;
  }

  historicalServerTime(clientNow: number): number | undefined {
    if (this.intervals.length == 0) {
      return undefined;
    }
    if (clientNow === this.prevClientTs) {
      return this.prevServerTs;
    }
    // If this is our first time simulating, start at the beginning of the buffer.
    const prevClientTs = this.prevClientTs ?? clientNow;
    const prevServerTs = this.prevServerTs ?? this.intervals[0].startTs;
    const lastServerTs = this.intervals[this.intervals.length - 1].endTs;

    // Continuously adjust playback rate from buffer size. Prefer speeding up
    // over hard-jumping — large jumps look like characters teleporting.
    const bufferDuration = lastServerTs - prevServerTs;
    let rate = 1;
    if (bufferDuration < SOFT_MIN_SERVER_BUFFER_AGE) {
      rate = 0.75;
    } else if (bufferDuration > SOFT_MAX_SERVER_BUFFER_AGE) {
      // Ramp up gradually so multi-second catch-up still looks continuous.
      rate = Math.min(2.5, 1 + (bufferDuration - SOFT_MAX_SERVER_BUFFER_AGE) / 1000);
    }
    let serverTs = prevServerTs + (clientNow - prevClientTs) * rate;
    // Only hard-clamp when the buffer is pathologically large (e.g. after a
    // long tab background). Normal catch-up should drain via rate > 1.
    if (bufferDuration > MAX_SERVER_BUFFER_AGE) {
      serverTs = Math.max(serverTs, lastServerTs - MAX_SERVER_BUFFER_AGE);
    }

    let chosen = null;
    for (let i = 0; i < this.intervals.length; i++) {
      const snapshot = this.intervals[i];
      // We're past this snapshot, continue to the next one.
      if (snapshot.endTs < serverTs) {
        continue;
      }
      // We're cleanly within this snapshot.
      if (serverTs >= snapshot.startTs) {
        chosen = i;
        break;
      }
      // We've gone past the desired timestamp, which implies a gap in our server state.
      // Jump time forward to the beginning of this snapshot.
      if (serverTs < snapshot.startTs) {
        serverTs = snapshot.startTs;
        chosen = i;
      }
    }
    if (chosen === null) {
      serverTs = this.intervals.at(-1)!.endTs;
      chosen = this.intervals.length - 1;
    }
    // Time only moves forward, so we can trim all of the snapshots before our chosen one.
    const toTrim = Math.max(chosen - 1, 0);
    if (toTrim > 0) {
      for (const snapshot of this.intervals.slice(0, toTrim)) {
        this.totalDuration -= snapshot.endTs - snapshot.startTs;
      }
      this.intervals = this.intervals.slice(toTrim);
    }

    this.prevClientTs = clientNow;
    this.prevServerTs = serverTs;

    return serverTs;
  }

  bufferHealth(): number {
    if (!this.intervals.length) {
      return 0;
    }
    const lastServerTs = this.prevServerTs ?? this.intervals[0].startTs;
    return this.intervals[this.intervals.length - 1].endTs - lastServerTs;
  }

  clockSkew(): number {
    if (!this.prevClientTs || !this.prevServerTs) {
      return 0;
    }
    return this.prevClientTs - this.prevServerTs;
  }
}

const MAX_SERVER_BUFFER_AGE = 4000;
const SOFT_MAX_SERVER_BUFFER_AGE = 1000;
const SOFT_MIN_SERVER_BUFFER_AGE = 250;
