"use client";
import { useEffect } from "react";
import confetti from "canvas-confetti";

export function Confetti({ trigger }: { trigger: unknown }) {
  useEffect(() => {
    if (!trigger) return;
    const end = Date.now() + 1500;
    const colors = ["#6366f1", "#10b981", "#f59e0b", "#ef4444"];
    (function frame() {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors,
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors,
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }, [trigger]);
  return null;
}
