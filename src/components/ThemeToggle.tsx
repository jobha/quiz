"use client";

import { useEffect, useState } from "react";

type Mode = "light" | "dark" | "system";

const STORAGE_KEY = "quiz:theme";

function readStored(): Mode {
  if (typeof window === "undefined") return "system";
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === "light" || v === "dark") return v;
  return "system";
}

function applyMode(mode: Mode) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = mode === "dark" || (mode === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [mode, setMode] = useState<Mode>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMode(readStored());
    setMounted(true);
  }, []);

  // React to system pref changes when in "system" mode.
  useEffect(() => {
    if (!mounted) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readStored() === "system") applyMode("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mounted]);

  function set(next: Mode) {
    setMode(next);
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
    applyMode(next);
  }

  if (!mounted) {
    // Avoid hydration mismatch — render a sized placeholder.
    return <div className={"h-8 w-24 " + className} aria-hidden />;
  }

  const items: { value: Mode; label: string; icon: string }[] = [
    { value: "light", label: "Lys", icon: "☀" },
    { value: "system", label: "Auto", icon: "◐" },
    { value: "dark", label: "Mørk", icon: "☾" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className={
        "inline-flex text-xs rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-0.5 " +
        className
      }
    >
      {items.map((item) => {
        const active = mode === item.value;
        return (
          <button
            key={item.value}
            role="radio"
            aria-checked={active}
            onClick={() => set(item.value)}
            className={
              "px-2.5 py-1 rounded-full transition-colors " +
              (active
                ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300")
            }
            title={item.label}
          >
            <span aria-hidden>{item.icon}</span>
            <span className="ml-1">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
