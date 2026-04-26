"use client";

import { useEffect, useMemo, useRef, useState, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { normalizeRoomCode } from "@/lib/room-code";
import type { Answer, Player, Question, Room } from "@/lib/types";

type Params = { code: string };

export default function PlayerPage({ params }: { params: Promise<Params> }) {
  const { code: rawCode } = use(params);
  const code = normalizeRoomCode(rawCode);
  const router = useRouter();
  const searchParams = useSearchParams();
  const playerIdFromUrl = searchParams.get("p");

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [room, setRoom] = useState<Room | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [myAnswers, setMyAnswers] = useState<Record<string, Answer>>({});
  const [answeredQuestions, setAnsweredQuestions] = useState<Question[]>([]);

  const storageKey = `quiz:player:${code}`;

  // Restore player ID from URL or localStorage.
  useEffect(() => {
    if (playerIdFromUrl) {
      localStorage.setItem(storageKey, playerIdFromUrl);
      setPlayerId(playerIdFromUrl);
      return;
    }
    const stored = localStorage.getItem(storageKey);
    if (stored) setPlayerId(stored);
  }, [playerIdFromUrl, storageKey]);

  // Subscribe to room state.
  useEffect(() => {
    const sb = supabaseBrowser();
    let cancelled = false;

    async function load() {
      const { data: roomData } = await sb
        .from("rooms")
        .select("code, phase, current_question_id, created_at")
        .eq("code", code)
        .maybeSingle();
      if (cancelled) return;
      if (!roomData) {
        setRoom(null);
        return;
      }
      setRoom(roomData as Room);

      const { data: playerData } = await sb
        .from("players")
        .select("*")
        .eq("room_code", code)
        .order("created_at");
      if (!cancelled && playerData) setPlayers(playerData as Player[]);
    }
    load();

    const channel = sb
      .channel(`room:${code}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `code=eq.${code}` },
        (payload) => {
          if (payload.new && "code" in payload.new) {
            setRoom(payload.new as Room);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `room_code=eq.${code}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setPlayers((prev) => [...prev, payload.new as Player]);
          } else if (payload.eventType === "DELETE") {
            const removed = payload.old as { id: string };
            setPlayers((prev) => prev.filter((p) => p.id !== removed.id));
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [code]);

  // Load current question whenever it changes.
  useEffect(() => {
    if (!room?.current_question_id) {
      setQuestion(null);
      return;
    }
    const sb = supabaseBrowser();
    let cancelled = false;
    sb.from("questions")
      .select("*")
      .eq("id", room.current_question_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setQuestion(data as Question);
      });
    return () => {
      cancelled = true;
    };
  }, [room?.current_question_id]);

  // Load my answers + subscribe.
  useEffect(() => {
    if (!playerId) return;
    const sb = supabaseBrowser();
    let cancelled = false;

    async function load() {
      const { data } = await sb
        .from("answers")
        .select("*")
        .eq("room_code", code)
        .eq("player_id", playerId);
      if (cancelled || !data) return;
      const map: Record<string, Answer> = {};
      for (const a of data as Answer[]) map[a.question_id] = a;
      setMyAnswers(map);
    }
    load();

    const channel = sb
      .channel(`answers:${code}:${playerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "answers",
          filter: `player_id=eq.${playerId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as Answer;
          setMyAnswers((prev) => ({ ...prev, [row.question_id]: row }));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [code, playerId]);

  // Load all answered questions for scoreboard context.
  useEffect(() => {
    const ids = Object.keys(myAnswers);
    if (ids.length === 0) {
      setAnsweredQuestions([]);
      return;
    }
    const sb = supabaseBrowser();
    let cancelled = false;
    sb.from("questions")
      .select("*")
      .in("id", ids)
      .then(({ data }) => {
        if (!cancelled && data) setAnsweredQuestions(data as Question[]);
      });
    return () => {
      cancelled = true;
    };
  }, [Object.keys(myAnswers).join(",")]);

  async function joinRoom(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setJoining(true);
    setJoinError(null);
    try {
      const res = await fetch(`/api/rooms/${code}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { player_id: string };
      localStorage.setItem(storageKey, json.player_id);
      setPlayerId(json.player_id);
      router.replace(`/r/${code}?p=${json.player_id}`);
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : "Failed to join");
    } finally {
      setJoining(false);
    }
  }

  const me = useMemo(
    () => players.find((p) => p.id === playerId) ?? null,
    [players, playerId],
  );

  const myScore = useMemo(() => {
    let s = 0;
    for (const a of Object.values(myAnswers)) {
      if (a.is_correct) {
        const q = answeredQuestions.find((q) => q.id === a.question_id);
        s += q?.points ?? 1;
      }
    }
    return s;
  }, [myAnswers, answeredQuestions]);

  if (!room) {
    return (
      <Centered>
        <p className="text-zinc-400">Looking up room {code}…</p>
      </Centered>
    );
  }

  if (!playerId || !me) {
    return (
      <Centered>
        <div className="w-full max-w-md space-y-6">
          <header className="text-center">
            <p className="text-zinc-400 text-sm">Joining room</p>
            <h1 className="text-3xl font-bold tracking-[0.3em] font-mono">
              {code}
            </h1>
          </header>
          <form
            onSubmit={joinRoom}
            className="rounded-2xl bg-zinc-900 border border-zinc-800 p-6 space-y-4"
          >
            <label className="block text-sm text-zinc-400">Your name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jonas"
              maxLength={40}
              className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-4 py-3 outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={joining || !name.trim()}
              className="w-full rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 px-4 py-3 font-medium"
            >
              {joining ? "Joining…" : "Join"}
            </button>
            {joinError && (
              <p className="text-sm text-red-400">{joinError}</p>
            )}
          </form>
        </div>
      </Centered>
    );
  }

  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-widest">
            Room {code}
          </p>
          <p className="text-lg font-semibold">{me.name}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-500 uppercase tracking-widest">Score</p>
          <p className="text-2xl font-bold">{myScore}</p>
        </div>
      </header>

      <PlayerStage
        room={room}
        question={question}
        myAnswer={question ? myAnswers[question.id] : undefined}
        playerId={playerId}
        code={code}
      />

      <section className="rounded-2xl bg-zinc-900 border border-zinc-800 p-4">
        <h2 className="text-sm font-semibold text-zinc-400 mb-3">
          Players ({players.length})
        </h2>
        <ul className="grid grid-cols-2 gap-2">
          {players.map((p) => (
            <li
              key={p.id}
              className={
                "rounded-md px-3 py-2 text-sm " +
                (p.id === playerId
                  ? "bg-indigo-500/20 text-indigo-200"
                  : "bg-zinc-950")
              }
            >
              {p.name}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function PlayerStage({
  room,
  question,
  myAnswer,
  playerId,
  code,
}: {
  room: Room;
  question: Question | null;
  myAnswer: Answer | undefined;
  playerId: string;
  code: string;
}) {
  if (room.phase === "lobby") {
    return (
      <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-8 text-center">
        <p className="text-zinc-400">Waiting for the host to start…</p>
      </div>
    );
  }
  if (room.phase === "ended") {
    return (
      <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-8 text-center">
        <p className="text-lg font-semibold">Quiz over!</p>
        <p className="text-zinc-400 text-sm mt-1">Thanks for playing.</p>
      </div>
    );
  }
  if (!question) {
    return (
      <div className="rounded-2xl bg-zinc-900 border border-zinc-800 p-8 text-center">
        <p className="text-zinc-400">Loading question…</p>
      </div>
    );
  }
  return (
    <QuestionView
      room={room}
      question={question}
      myAnswer={myAnswer}
      playerId={playerId}
      code={code}
    />
  );
}

function QuestionView({
  room,
  question,
  myAnswer,
  playerId,
  code,
}: {
  room: Room;
  question: Question;
  myAnswer: Answer | undefined;
  playerId: string;
  code: string;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastQuestionId = useRef<string | null>(null);

  useEffect(() => {
    if (lastQuestionId.current !== question.id) {
      setText("");
      setError(null);
      lastQuestionId.current = question.id;
    }
  }, [question.id]);

  const revealed = room.phase === "revealed";
  const submitted = !!myAnswer;
  const locked = revealed || submitted;

  async function submit(answer: string) {
    if (!answer.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${code}/answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          player_id: playerId,
          question_id: question.id,
          answer: answer.trim(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl bg-zinc-900 border border-zinc-800 p-6 space-y-5">
      <div>
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          Question
        </p>
        <h2 className="text-2xl font-semibold mt-1">{question.prompt}</h2>
      </div>

      {question.type === "choice" && question.choices ? (
        <div className="grid gap-2">
          {question.choices.map((choice) => {
            const chosen = myAnswer?.answer === choice;
            const isRight =
              revealed && choice === question.correct_answer;
            const isWrongPick = revealed && chosen && !isRight;
            return (
              <button
                key={choice}
                disabled={locked || submitting}
                onClick={() => submit(choice)}
                className={
                  "rounded-lg px-4 py-3 text-left border transition " +
                  (isRight
                    ? "bg-emerald-500/20 border-emerald-500 text-emerald-100"
                    : isWrongPick
                    ? "bg-red-500/20 border-red-500 text-red-100"
                    : chosen
                    ? "bg-indigo-500/20 border-indigo-500"
                    : "bg-zinc-950 border-zinc-800 hover:border-zinc-600 disabled:opacity-60")
                }
              >
                {choice}
              </button>
            );
          })}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
          className="space-y-3"
        >
          <input
            value={submitted ? myAnswer!.answer : text}
            onChange={(e) => setText(e.target.value)}
            disabled={locked || submitting}
            placeholder="Type your answer"
            className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-4 py-3 outline-none focus:border-indigo-500 disabled:opacity-70"
          />
          {!locked && (
            <button
              type="submit"
              disabled={submitting || !text.trim()}
              className="w-full rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 px-4 py-3 font-medium"
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
          )}
        </form>
      )}

      {submitted && !revealed && (
        <p className="text-sm text-zinc-400">
          Answer locked in. Waiting for the host to reveal…
        </p>
      )}

      {revealed && (
        <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-4 space-y-1">
          <p className="text-xs text-zinc-500 uppercase tracking-widest">
            Correct answer
          </p>
          <p className="font-medium">{question.correct_answer}</p>
          {myAnswer ? (
            <p
              className={
                "text-sm mt-2 " +
                (myAnswer.is_correct === true
                  ? "text-emerald-400"
                  : myAnswer.is_correct === false
                  ? "text-red-400"
                  : "text-zinc-400")
              }
            >
              {myAnswer.is_correct === true
                ? `Correct! +${question.points}`
                : myAnswer.is_correct === false
                ? "Not quite."
                : "Awaiting host's judgement…"}
            </p>
          ) : (
            <p className="text-sm text-zinc-500 mt-2">No answer submitted.</p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      {children}
    </main>
  );
}
