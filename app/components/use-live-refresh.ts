"use client";

import { useEffect, useRef } from "react";

/** Quiet refresh only while visible; never overlap interval/focus requests. */
export function useLiveRefresh(refresh: () => Promise<unknown>, enabled = true) {
  const callback = useRef(refresh);
  useEffect(() => { callback.current = refresh; }, [refresh]);
  useEffect(() => {
    if (!enabled) return;
    let pending = false;
    let disposed = false;
    const run = async () => {
      if (disposed || pending || document.visibilityState === "hidden") return;
      pending = true;
      try { await callback.current(); } finally { pending = false; }
    };
    const timer = window.setInterval(() => { void run(); }, 15_000);
    const onFocus = () => { void run(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [enabled]);
}
