"use client";

import { useEffect, useMemo, useState, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { normalizeRoomCode } from "@/lib/room-code";
import type {
  Answer,
  Player,
  Question,
  QuestionType,
  Room,
} from "@/lib/types";

type Params = { code: string };

export default function HostPage({ params }: { params: Promise<Params> }) {
  const { code: rawCode } = use(params);
  const code = normalizeRoomCode(rawCode);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [hostSecret, setHostSecret] = useState<string | null>(null);
  const storageKey = `quiz:host:${code}`;

  // Restore secret from URL or localStorage; persist for next visit.
  useEffect(() => {
    const fromUrl = searchParams.get("k");
    if (fromUrl) {
      localStorage.setItem(storageKey, fromUrl);
      setHostSecret(fromUrl);
      return;
    }
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      setHostSecret(stored);
      router.replace(`/r/${code}/host?k=${stored}`);
    } else {
      setHostSecret(null);
    }
  }, [code, router, searchParams, storageKey]);

  const [room, setRoom] = useState<Room | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);

  // Load + subscribe to all room data.
  useEffect(() => {
    const sb = supabaseBrowser();
    let cancelled = false;

    async function load() {
      const [{ data: roomData }, { data: qs }, { data: ps }, { data: as }] =
        await Promise.all([
          sb
            .from("rooms")
            .select("code, phase, current_question_id, created_at")
            .eq("code", code)
            .maybeSingle(),
          sb.from("questions").select("*").eq("room_code", code).order("position"),
          sb.from("players").select("*").eq("room_code", code).order("created_at"),
          sb.from("answers").select("*").eq("room_code", code),
        ]);
      if (cancelled) return;
      setRoom((roomData as Room) ?? null);
      setQuestions((qs as Question[]) ?? []);
      setPlayers((ps as Player[]) ?? []);
      setAnswers((as as Answer[]) ?? []);
    }
    load();

    const channel = sb
      .channel(`host:${code}`)
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
        { event: "*", schema: "public", table: "questions", filter: `room_code=eq.${code}` },
        (payload) => {
          setQuestions((prev) => {
            if (payload.eventType === "INSERT") {
              return [...prev, payload.new as Question].sort(
                (a, b) => a.position - b.position,
              );
            }
            if (payload.eventType === "UPDATE") {
              return prev
                .map((q) =>
                  q.id === (payload.new as Question).id
                    ? (payload.new as Question)
                    : q,
                )
                .sort((a, b) => a.position - b.position);
            }
            if (payload.eventType === "DELETE") {
              const removed = payload.old as { id: string };
              return prev.filter((q) => q.id !== removed.id);
            }
            return prev;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `room_code=eq.${code}` },
        (payload) => {
          setPlayers((prev) => {
            if (payload.eventType === "INSERT")
              return [...prev, payload.new as Player];
            if (payload.eventType === "DELETE") {
              const removed = payload.old as { id: string };
              return prev.filter((p) => p.id !== removed.id);
            }
            return prev;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "answers", filter: `room_code=eq.${code}` },
        (payload) => {
          setAnswers((prev) => {
            if (payload.eventType === "INSERT")
              return [...prev, payload.new as Answer];
            if (payload.eventType === "UPDATE")
              return prev.map((a) =>
                a.id === (payload.new as Answer).id
                  ? (payload.new as Answer)
                  : a,
              );
            if (payload.eventType === "DELETE") {
              const removed = payload.old as { id: string };
              return prev.filter((a) => a.id !== removed.id);
            }
            return prev;
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [code]);

  async function call(path: string, body: unknown) {
    if (!hostSecret) throw new Error("No host secret");
    const res = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-host-secret": hostSecret,
      },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  const currentQuestion = useMemo(
    () => questions.find((q) => q.id === room?.current_question_id) ?? null,
    [questions, room?.current_question_id],
  );

  const currentAnswers = useMemo(
    () =>
      currentQuestion
        ? answers.filter((a) => a.question_id === currentQuestion.id)
        : [],
    [answers, currentQuestion],
  );

  const scores = useMemo(() => {
    const byQ: Record<string, Question> = {};
    for (const q of questions) byQ[q.id] = q;
    const out: Record<string, number> = {};
    for (const p of players) out[p.id] = 0;
    for (const a of answers) {
      if (a.is_correct) {
        out[a.player_id] = (out[a.player_id] ?? 0) + (byQ[a.question_id]?.points ?? 1);
      }
    }
    return out;
  }, [answers, players, questions]);

  if (!room) {
    return (
      <Centered>
        <p className="text-zinc-400">Loading room…</p>
      </Centered>
    );
  }

  if (!hostSecret) {
    return (
      <Centered>
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-bold">Host link required</h1>
          <p className="text-zinc-400 text-sm">
            This page needs the secret host key. Open the original link you
            were given when you created the room (it has <code>?k=…</code> at
            the end).
          </p>
        </div>
      </Centered>
    );
  }

  const playerLink = typeof window !== "undefined"
    ? `${window.location.origin}/r/${code}`
    : `/r/${code}`;

  return (
    <main className="min-h-screen p-6 max-w-5xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-widest">
            Hosting room
          </p>
          <h1 className="text-3xl font-bold tracking-[0.3em] font-mono">
            {code}
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Players join at{" "}
            <button
              onClick={() => navigator.clipboard.writeText(playerLink)}
              className="underline underline-offset-4 hover:text-zinc-100"
            >
              {playerLink}
            </button>
          </p>
        </div>
        <div className="text-right text-xs text-zinc-500">
          <p>Phase: <span className="text-zinc-300">{room.phase}</span></p>
          <p>Players: <span className="text-zinc-300">{players.length}</span></p>
          <p>Questions: <span className="text-zinc-300">{questions.length}</span></p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <CurrentQuestionPanel
            room={room}
            question={currentQuestion}
            questions={questions}
            answers={currentAnswers}
            players={players}
            call={call}
          />
          <QuestionListPanel
            questions={questions}
            currentId={room.current_question_id}
            phase={room.phase}
            call={call}
          />
        </div>

        <div className="space-y-6">
          <AddQuestionPanel
            existingCount={questions.length}
            call={call}
          />
          <ScoreboardPanel players={players} scores={scores} />
        </div>
      </div>
    </main>
  );
}

function CurrentQuestionPanel({
  room,
  question,
  questions,
  answers,
  players,
  call,
}: {
  room: Room;
  question: Question | null;
  questions: Question[];
  answers: Answer[];
  players: Player[];
  call: (path: string, body: unknown) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const idx = question
    ? questions.findIndex((q) => q.id === question.id)
    : -1;
  const next = idx >= 0 ? questions[idx + 1] : questions[0];
  const playerById = Object.fromEntries(players.map((p) => [p.id, p]));

  return (
    <section className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Current question</h2>
        <span className="text-xs text-zinc-500">{room.phase}</span>
      </div>

      {question ? (
        <>
          <div>
            <p className="text-xs text-zinc-500">
              #{idx + 1} of {questions.length}
            </p>
            <p className="text-lg font-medium mt-1">{question.prompt}</p>
            <p className="text-sm text-emerald-400 mt-1">
              Answer: {question.correct_answer}
            </p>
            {question.type === "choice" && question.choices && (
              <ul className="mt-2 text-sm text-zinc-400 list-disc pl-5">
                {question.choices.map((c) => (
                  <li
                    key={c}
                    className={c === question.correct_answer ? "text-emerald-400" : ""}
                  >
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-3">
            <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2">
              Answers ({answers.length}/{players.length})
            </p>
            {answers.length === 0 ? (
              <p className="text-sm text-zinc-500">No answers yet.</p>
            ) : (
              <ul className="space-y-1">
                {answers.map((a) => {
                  const player = playerById[a.player_id];
                  return (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <div className="min-w-0">
                        <span className="text-zinc-400">
                          {player?.name ?? "?"}
                        </span>{" "}
                        <span className="font-medium">{a.answer}</span>
                      </div>
                      {room.phase === "revealed" && (
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={() =>
                              run("judge", () =>
                                call(`/api/rooms/${room.code}/judge`, {
                                  answer_id: a.id,
                                  is_correct: true,
                                }),
                              )
                            }
                            className={
                              "px-2 py-0.5 text-xs rounded " +
                              (a.is_correct === true
                                ? "bg-emerald-500 text-white"
                                : "bg-zinc-800 text-zinc-300 hover:bg-emerald-500/30")
                            }
                          >
                            ✓
                          </button>
                          <button
                            onClick={() =>
                              run("judge", () =>
                                call(`/api/rooms/${room.code}/judge`, {
                                  answer_id: a.id,
                                  is_correct: false,
                                }),
                              )
                            }
                            className={
                              "px-2 py-0.5 text-xs rounded " +
                              (a.is_correct === false
                                ? "bg-red-500 text-white"
                                : "bg-zinc-800 text-zinc-300 hover:bg-red-500/30")
                            }
                          >
                            ✗
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {room.phase === "asking" && (
              <button
                onClick={() =>
                  run("reveal", () =>
                    call(`/api/rooms/${room.code}/state`, { phase: "revealed" }),
                  )
                }
                disabled={busy !== null}
                className="rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-60 px-4 py-2 text-sm font-medium text-zinc-950"
              >
                Reveal answer
              </button>
            )}
            {room.phase === "revealed" && next && (
              <button
                onClick={() =>
                  run("next", () =>
                    call(`/api/rooms/${room.code}/state`, {
                      phase: "asking",
                      current_question_id: next.id,
                    }),
                  )
                }
                disabled={busy !== null}
                className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 px-4 py-2 text-sm font-medium"
              >
                Next question →
              </button>
            )}
            {room.phase === "revealed" && !next && (
              <button
                onClick={() =>
                  run("end", () =>
                    call(`/api/rooms/${room.code}/state`, { phase: "ended" }),
                  )
                }
                disabled={busy !== null}
                className="rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-60 px-4 py-2 text-sm font-medium"
              >
                End quiz
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">
            {questions.length === 0
              ? "Add a question to get started."
              : "Ready when you are."}
          </p>
          {questions.length > 0 && (
            <button
              onClick={() =>
                run("start", () =>
                  call(`/api/rooms/${room.code}/state`, {
                    phase: "asking",
                    current_question_id: questions[0].id,
                  }),
                )
              }
              disabled={busy !== null}
              className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 px-4 py-2 text-sm font-medium"
            >
              Start with question 1
            </button>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  );
}

function QuestionListPanel({
  questions,
  currentId,
  phase,
  call,
}: {
  questions: Question[];
  currentId: string | null;
  phase: string;
  call: (path: string, body: unknown) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  if (questions.length === 0) return null;
  return (
    <section className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-3">
      <h2 className="font-semibold">All questions</h2>
      <ol className="space-y-1">
        {questions.map((q, i) => {
          const isCurrent = q.id === currentId;
          return (
            <li
              key={q.id}
              className={
                "flex items-center justify-between gap-2 rounded px-2 py-1 text-sm " +
                (isCurrent ? "bg-indigo-500/15 text-indigo-200" : "")
              }
            >
              <span className="truncate">
                <span className="text-zinc-500 mr-2">{i + 1}.</span>
                {q.prompt}
              </span>
              <span className="text-xs text-zinc-500 shrink-0">
                {q.type === "choice" ? "MC" : "free"} · {q.points}p
              </span>
              {phase === "lobby" && !isCurrent && (
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (!confirm("Delete this question?")) return;
                    setBusy(true);
                    try {
                      await call(
                        `/api/rooms/${q.room_code}/questions/delete`,
                        { id: q.id },
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="text-xs text-zinc-500 hover:text-red-400"
                >
                  delete
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function AddQuestionPanel({
  existingCount,
  call,
}: {
  existingCount: number;
  call: (path: string, body: unknown) => Promise<unknown>;
}) {
  const [type, setType] = useState<QuestionType>("text");
  const [prompt, setPrompt] = useState("");
  const [correct, setCorrect] = useState("");
  const [choicesText, setChoicesText] = useState("");
  const [points, setPoints] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    const m = window.location.pathname.match(/\/r\/([^/]+)\/host/);
    setCode(m?.[1] ?? null);
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      const choices =
        type === "choice"
          ? choicesText
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean)
          : null;
      if (type === "choice" && (!choices || choices.length < 2)) {
        throw new Error("Add at least two choices, one per line.");
      }
      if (type === "choice" && choices && !choices.includes(correct.trim())) {
        throw new Error("The correct answer must match one of the choices.");
      }
      await call(`/api/rooms/${code}/questions`, {
        type,
        prompt: prompt.trim(),
        correct_answer: correct.trim(),
        choices,
        points,
      });
      setPrompt("");
      setCorrect("");
      setChoicesText("");
      setPoints(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add question");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-3">
      <h2 className="font-semibold">Add question #{existingCount + 1}</h2>
      <form onSubmit={add} className="space-y-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setType("text")}
            className={
              "flex-1 rounded-lg px-3 py-2 text-sm border " +
              (type === "text"
                ? "bg-indigo-500/20 border-indigo-500 text-indigo-100"
                : "bg-zinc-950 border-zinc-800 text-zinc-400")
            }
          >
            Free text
          </button>
          <button
            type="button"
            onClick={() => setType("choice")}
            className={
              "flex-1 rounded-lg px-3 py-2 text-sm border " +
              (type === "choice"
                ? "bg-indigo-500/20 border-indigo-500 text-indigo-100"
                : "bg-zinc-950 border-zinc-800 text-zinc-400")
            }
          >
            Multiple choice
          </button>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Question prompt"
          rows={2}
          className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-indigo-500 text-sm"
          required
        />

        {type === "choice" && (
          <textarea
            value={choicesText}
            onChange={(e) => setChoicesText(e.target.value)}
            placeholder={"Choices, one per line\nParis\nLondon\nBerlin"}
            rows={4}
            className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-indigo-500 text-sm font-mono"
            required
          />
        )}

        <input
          value={correct}
          onChange={(e) => setCorrect(e.target.value)}
          placeholder="Correct answer"
          className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-indigo-500 text-sm"
          required
        />

        <div className="flex items-center gap-3">
          <label className="text-sm text-zinc-400">Points</label>
          <input
            type="number"
            min={1}
            max={10}
            value={points}
            onChange={(e) => setPoints(Number(e.target.value))}
            className="w-20 rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-indigo-500 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 px-4 py-2 text-sm font-medium"
        >
          {busy ? "Adding…" : "Add question"}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </section>
  );
}

function ScoreboardPanel({
  players,
  scores,
}: {
  players: Player[];
  scores: Record<string, number>;
}) {
  const sorted = [...players].sort(
    (a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0),
  );
  return (
    <section className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-3">
      <h2 className="font-semibold">Scoreboard</h2>
      {players.length === 0 ? (
        <p className="text-sm text-zinc-500">No players yet.</p>
      ) : (
        <ol className="space-y-1">
          {sorted.map((p, i) => (
            <li
              key={p.id}
              className="flex items-center justify-between text-sm bg-zinc-950 rounded px-3 py-2"
            >
              <span>
                <span className="text-zinc-500 mr-2">{i + 1}.</span>
                {p.name}
              </span>
              <span className="font-mono font-semibold">
                {scores[p.id] ?? 0}
              </span>
            </li>
          ))}
        </ol>
      )}
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
