"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeRoomCode } from "@/lib/room-code";

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resume options
  const [resumeMode, setResumeMode] = useState<"player" | "host">("player");
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

  async function resume(e: React.FormEvent) {
    e.preventDefault();
    const room = normalizeRoomCode(code);
    const rc = normalizeRoomCode(rejoinCode);
    if (!room || !rc) return;
    setResuming(true);
    setError(null);
    try {
      if (resumeMode === "player") {
        const res = await fetch(`/api/rooms/${room}/rejoin`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rejoin_code: rc }),
        });
        if (!res.ok) throw new Error(await res.text());
        const json = (await res.json()) as { player_id: string };
        localStorage.setItem(`quiz:player:${room}`, json.player_id);
        router.push(`/r/${room}?p=${json.player_id}`);
      } else {
        const res = await fetch(`/api/rooms/${room}/host-resume`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ host_rejoin_code: rc }),
        });
        if (!res.ok) throw new Error(await res.text());
        const json = (await res.json()) as { host_secret: string };
        router.push(`/r/${room}/host?k=${json.host_secret}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resume");
    } finally {
      setResuming(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
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

        <section className="rounded-2xl bg-zinc-900 p-6 space-y-4 border border-zinc-800">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Resume with a code</h2>
            <div className="flex text-xs rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
              <button
                onClick={() => setResumeMode("player")}
                className={
                  "px-2 py-1 " +
                  (resumeMode === "player" ? "bg-indigo-500/30 text-indigo-100" : "text-zinc-400")
                }
              >
                Player
              </button>
              <button
                onClick={() => setResumeMode("host")}
                className={
                  "px-2 py-1 " +
                  (resumeMode === "host" ? "bg-indigo-500/30 text-indigo-100" : "text-zinc-400")
                }
              >
                Host
              </button>
            </div>
          </div>
          <form onSubmit={resume} className="space-y-3">
            <input
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ROOM CODE"
              className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-4 py-3 tracking-[0.3em] text-center font-mono text-lg outline-none focus:border-indigo-500"
            />
            <input
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={rejoinCode}
              onChange={(e) => setRejoinCode(e.target.value.toUpperCase())}
              placeholder={resumeMode === "player" ? "YOUR CODE" : "HOST CODE"}
              className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-4 py-3 tracking-[0.3em] text-center font-mono text-lg outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={resuming || !normalizeRoomCode(code) || !normalizeRoomCode(rejoinCode)}
              className="w-full rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 px-4 py-3 font-medium"
            >
              {resuming ? "Resuming…" : "Resume"}
            </button>
          </form>
        </section>

        {error && <p className="text-sm text-red-400 text-center">{error}</p>}
      </div>
    </main>
  );
}
