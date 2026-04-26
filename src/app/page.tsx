"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeRoomCode } from "@/lib/room-code";

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createRoom() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { code: string; host_secret: string };
      router.push(`/r/${json.code}/host?k=${json.host_secret}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create room");
      setCreating(false);
    }
  }

  function joinRoom(e: React.FormEvent) {
    e.preventDefault();
    const c = normalizeRoomCode(code);
    if (!c) return;
    router.push(`/r/${c}`);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8">
        <header className="text-center space-y-2">
          <h1 className="text-4xl font-bold">Quiz</h1>
          <p className="text-zinc-400">FaceTime quiz nights, made simple.</p>
        </header>

        <section className="rounded-2xl bg-zinc-900 p-6 space-y-4 border border-zinc-800">
          <h2 className="text-lg font-semibold">Host a quiz</h2>
          <button
            onClick={createRoom}
            disabled={creating}
            className="w-full rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 px-4 py-3 font-medium"
          >
            {creating ? "Creating…" : "Create room"}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </section>

        <section className="rounded-2xl bg-zinc-900 p-6 space-y-4 border border-zinc-800">
          <h2 className="text-lg font-semibold">Join a quiz</h2>
          <form onSubmit={joinRoom} className="space-y-3">
            <input
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ROOM CODE"
              className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-4 py-3 tracking-[0.3em] text-center font-mono text-lg outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={!normalizeRoomCode(code)}
              className="w-full rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 px-4 py-3 font-medium"
            >
              Join
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
