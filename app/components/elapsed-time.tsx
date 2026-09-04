"use client";

import { useEffect, useState } from "react";

/** Mount for the lifetime of an operation. This is elapsed time, not a deadline. */
export default function ElapsedTime() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span role="timer" aria-live="off">Geçen süre: {String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</span>;
}
