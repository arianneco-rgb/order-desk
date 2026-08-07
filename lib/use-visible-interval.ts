"use client";

import { useEffect, useRef } from "react";

/**
 * setInterval that stops while the tab is in the background, and fires once
 * immediately when you come back to it.
 *
 * Every page in this app polls (Processed 2.5s, Queue 2s, nav counts 5s, the
 * payment pane 5s per open order), and several of those calls reach Google
 * Apps Script — which is slow and fails intermittently. A plain setInterval
 * keeps hammering it from tabs nobody is looking at, which is pure cost:
 * it competes with the tab Joey IS using and burns the bridge's limited
 * concurrency. Nothing is lost by pausing, because the callback runs on
 * return, so a backgrounded tab is up to date the moment it's visible again.
 */
export function useVisibleInterval(callback: () => void, delayMs: number): void {
  // Kept in a ref so a caller re-creating the function each render doesn't
  // tear down and restart the timer.
  const savedCallback = useRef(callback);
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    const start = () => {
      if (timer !== undefined) return;
      timer = setInterval(() => savedCallback.current(), delayMs);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        savedCallback.current(); // catch up straight away, don't wait a full tick
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [delayMs]);
}
