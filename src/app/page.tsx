"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeRoomCode } from "@/lib/room-code";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rejoinCode, setRejoinCode] = useState("");
  const [resuming, setResuming] = useState(false);

  async function createRoom() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { code: string; host_secret: string };
      router.push(`/r/${json.code}/host?k=${json.host_secret}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Klarte ikke å lage rom");
      setCreating(false);
    }
  }

  function joinRoom(e: React.FormEvent) {
    e.preventDefault();
    const c = normalizeRoomCode(code);
    if (!c) return;
    router.push(`/r/${c}`);
  }

  async function resume(e: React.FormEvent) {
    e.preventDefault();
    const rc = normalizeRoomCode(rejoinCode);
    if (!rc) return;
    setResuming(true);
    setError(null);
    try {
      const res = await fetch(`/api/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: rc }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as
        | { type: "player"; room_code: string; player_id: string }
        | { type: "host"; room_code: string; host_secret: string };
      if (json.type === "host") {
        router.push(`/r/${json.room_code}/host?k=${json.host_secret}`);
      } else {
        localStorage.setItem(`quiz:player:${json.room_code}`, json.player_id);
        router.push(`/r/${json.room_code}?p=${json.player_id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunne ikke fortsette");
    } finally {
      setResuming(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 pb-24">
      <ThemeToggle className="fixed right-4 bottom-4 sm:top-4 sm:bottom-auto z-10" />
      <div className="w-full max-w-md space-y-6">
        <header className="text-center space-y-2">
          <h1 className="text-4xl font-bold">Quiz</h1>
          <p className="text-zinc-600 dark:text-zinc-400">FaceTime-quiz med venner, helt enkelt.</p>
        </header>

        <section className="rounded-2xl bg-white dark:bg-zinc-900 p-6 space-y-4 border border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-semibold">Vær quizmaster</h2>
          <button
            onClick={createRoom}
            disabled={creating}
            className="w-full rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 px-4 py-3 font-medium text-white"
          >
            {creating ? "Lager…" : "Lag rom"}
          </button>
        </section>

        <section className="rounded-2xl bg-white dark:bg-zinc-900 p-6 space-y-4 border border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-semibold">Bli med i en quiz</h2>
          <form onSubmit={joinRoom} className="space-y-3">
            <input
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ROMKODE"
              className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-4 py-3 tracking-[0.3em] text-center font-mono text-lg outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={!normalizeRoomCode(code)}
              className="w-full rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-60 px-4 py-3 font-medium"
            >
              Bli med
            </button>
          </form>
        </section>

        <section className="rounded-2xl bg-white dark:bg-zinc-900 p-6 space-y-4 border border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-semibold">Fortsett med en kode</h2>
          <p className="text-xs text-zinc-500">
            Skriv din personlige kode (spiller eller quizmaster) – vi finner riktig rom for deg.
          </p>
          <form onSubmit={resume} className="space-y-3">
            <input
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={rejoinCode}
              onChange={(e) => setRejoinCode(e.target.value.toUpperCase())}
              placeholder="DIN KODE"
              className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-4 py-3 tracking-[0.3em] text-center font-mono text-lg outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={resuming || !normalizeRoomCode(rejoinCode)}
              className="w-full rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-60 px-4 py-3 font-medium"
            >
              {resuming ? "Fortsetter…" : "Fortsett"}
            </button>
          </form>
        </section>

        {error && <p className="text-sm text-red-500 dark:text-red-400 text-center">{error}</p>}
      </div>
    </main>
  );
}
