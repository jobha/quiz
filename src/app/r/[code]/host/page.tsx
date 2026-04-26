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

type RoomWithHostCode = Room & { host_rejoin_code: string | null };

type Params = { code: string };

export default function HostPage({ params }: { params: Promise<Params> }) {
  const { code: rawCode } = use(params);
  const code = normalizeRoomCode(rawCode);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [hostSecret, setHostSecret] = useState<string | null>(null);
  const storageKey = `quiz:host:${code}`;

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

  const [room, setRoom] = useState<RoomWithHostCode | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);

  useEffect(() => {
    const sb = supabaseBrowser();
    let cancelled = false;

    async function load() {
      const [{ data: roomData }, { data: qs }, { data: ps }, { data: as }] =
        await Promise.all([
          sb
            .from("rooms")
            .select(
              "code, phase, current_question_id, host_rejoin_code, show_scoreboard, created_at",
            )
            .eq("code", code)
            .maybeSingle(),
          sb.from("questions").select("*").eq("room_code", code).order("position"),
          sb.from("players").select("*").eq("room_code", code).order("created_at"),
          sb.from("answers").select("*").eq("room_code", code),
        ]);
      if (cancelled) return;
      setRoom((roomData as RoomWithHostCode) ?? null);
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
            setRoom(payload.new as RoomWithHostCode);
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
    if (!hostSecret) throw new Error("Mangler vertskode");
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

  async function uploadFile(file: File): Promise<string> {
    if (!hostSecret) throw new Error("Mangler vertskode");
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/rooms/${code}/upload`, {
      method: "POST",
      headers: { "x-host-secret": hostSecret },
      body: form,
    });
    if (!res.ok) throw new Error(await res.text());
    const json = (await res.json()) as { url: string };
    return json.url;
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
    const out: Record<string, number> = {};
    for (const p of players) out[p.id] = 0;
    for (const a of answers) {
      if (typeof a.points_awarded === "number") {
        out[a.player_id] = (out[a.player_id] ?? 0) + a.points_awarded;
      }
    }
    return out;
  }, [answers, players]);

  if (!room) {
    return (
      <Centered>
        <p className="text-zinc-400">Laster rom…</p>
      </Centered>
    );
  }

  if (!hostSecret) {
    return (
      <Centered>
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-bold">Trenger vertslenke</h1>
          <p className="text-zinc-400 text-sm">
            Denne siden krever den hemmelige vertskoden. Åpne lenken du fikk
            da du laget rommet (den slutter med <code>?k=…</code>), eller
            bruk &quot;Fortsett med en kode&quot; på forsiden.
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
            Quizmaster for rom
          </p>
          <h1 className="text-3xl font-bold tracking-[0.3em] font-mono">
            {code}
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Spillere blir med på{" "}
            <button
              onClick={() => navigator.clipboard.writeText(playerLink)}
              className="underline underline-offset-4 hover:text-zinc-100"
            >
              {playerLink}
            </button>
          </p>
          {room.host_rejoin_code && (
            <p className="text-sm text-zinc-400 mt-1">
              Din quizmasterkode:{" "}
              <span className="font-mono tracking-widest text-zinc-200">
                {room.host_rejoin_code}
              </span>
            </p>
          )}
        </div>
        <div className="text-right text-xs text-zinc-500">
          <p>Fase: <span className="text-zinc-300">{translatePhase(room.phase)}</span></p>
          <p>Spillere: <span className="text-zinc-300">{players.length}</span></p>
          <p>Spørsmål: <span className="text-zinc-300">{questions.length}</span></p>
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
            call={call}
            roomCode={code}
          />
        </div>

        <div className="space-y-6">
          <AddQuestionPanel
            existingCount={questions.length}
            call={call}
            uploadFile={uploadFile}
          />
          <ScoreboardPanel
            room={room}
            players={players}
            scores={scores}
            call={call}
          />
        </div>
      </div>
    </main>
  );
}

function translatePhase(phase: string): string {
  switch (phase) {
    case "lobby":
      return "venterom";
    case "asking":
      return "spør";
    case "revealed":
      return "avslørt";
    case "ended":
      return "ferdig";
    default:
      return phase;
  }
}

function CurrentQuestionPanel({
  room,
  question,
  questions,
  answers,
  players,
  call,
}: {
  room: RoomWithHostCode;
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
      setError(e instanceof Error ? e.message : "Noe gikk galt");
    } finally {
      setBusy(null);
    }
  }

  const idx = question
    ? questions.findIndex((q) => q.id === question.id)
    : -1;
  const prev = idx > 0 ? questions[idx - 1] : null;
  const next = idx >= 0 ? questions[idx + 1] : questions[0];
  const playerById = Object.fromEntries(players.map((p) => [p.id, p]));

  if (room.phase === "ended") {
    return (
      <section className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-4">
        <h2 className="font-semibold">Quizen er ferdig</h2>
        <p className="text-sm text-zinc-400">
          Vil du fortsette? Du kan hoppe tilbake til et tidligere spørsmål
          eller gå tilbake til venterommet.
        </p>
        <div className="flex flex-wrap gap-2">
          {questions.length > 0 && (
            <button
              onClick={() =>
                run("resume", () =>
                  call(`/api/rooms/${room.code}/state`, {
                    phase: "revealed",
                    current_question_id:
                      room.current_question_id ?? questions[questions.length - 1].id,
                  }),
                )
              }
              disabled={busy !== null}
              className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 px-4 py-2 text-sm font-medium"
            >
              Fortsett quizen
            </button>
          )}
          <button
            onClick={() =>
              run("lobby", () =>
                call(`/api/rooms/${room.code}/state`, {
                  phase: "lobby",
                  current_question_id: null,
                }),
              )
            }
            disabled={busy !== null}
            className="rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 px-4 py-2 text-sm font-medium"
          >
            Tilbake til venterom
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Nåværende spørsmål</h2>
        <span className="text-xs text-zinc-500">{translatePhase(room.phase)}</span>
      </div>

      {question ? (
        <>
          <div>
            <p className="text-xs text-zinc-500">
              #{idx + 1} av {questions.length}
            </p>
            <p className="text-lg font-medium mt-1">{question.prompt}</p>
            {question.image_url && (
              <img
                src={question.image_url}
                alt=""
                className="mt-2 max-h-56 w-full object-contain rounded-lg bg-zinc-950 border border-zinc-800"
              />
            )}
            <p className="text-sm text-emerald-400 mt-1">
              Svar: {question.correct_answer}
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
              Svar ({answers.length}/{players.length})
            </p>
            {answers.length === 0 ? (
              <p className="text-sm text-zinc-500">Ingen svar ennå.</p>
            ) : (
              <ul className="space-y-2">
                {answers.map((a) => (
                  <AnswerRow
                    key={a.id}
                    answer={a}
                    playerName={playerById[a.player_id]?.name ?? "?"}
                    maxPoints={question?.points ?? 1}
                    roomCode={room.code}
                    call={call}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {prev && (
              <button
                onClick={() =>
                  run("prev", () =>
                    call(`/api/rooms/${room.code}/state`, {
                      phase: "revealed",
                      current_question_id: prev.id,
                    }),
                  )
                }
                disabled={busy !== null}
                className="rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 px-3 py-2 text-sm"
              >
                ← Forrige
              </button>
            )}
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
                Avslør svar
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
                Neste spørsmål →
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
                Avslutt quiz
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">
            {questions.length === 0
              ? "Legg til et spørsmål for å starte."
              : "Klar når du er det."}
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
              Start med spørsmål 1
            </button>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  );
}

function AnswerRow({
  answer,
  playerName,
  maxPoints,
  roomCode,
  call,
}: {
  answer: Answer;
  playerName: string;
  maxPoints: number;
  roomCode: string;
  call: (path: string, body: unknown) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [pointsInput, setPointsInput] = useState<string>(
    answer.points_awarded === null || answer.points_awarded === undefined
      ? ""
      : String(answer.points_awarded),
  );

  // Keep the input synced if the row updates remotely.
  useEffect(() => {
    setPointsInput(
      answer.points_awarded === null || answer.points_awarded === undefined
        ? ""
        : String(answer.points_awarded),
    );
  }, [answer.points_awarded]);

  async function award(value: number) {
    setBusy(true);
    try {
      await call(`/api/rooms/${roomCode}/judge`, {
        answer_id: answer.id,
        points_awarded: value,
      });
    } finally {
      setBusy(false);
    }
  }

  const fullChosen = answer.points_awarded === maxPoints;
  const zeroChosen = answer.points_awarded === 0;
  const half = Math.floor(maxPoints / 2);
  const halfChosen =
    answer.points_awarded === half &&
    answer.points_awarded !== null &&
    answer.points_awarded !== maxPoints &&
    answer.points_awarded !== 0;

  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <div className="min-w-0">
        <span className="text-zinc-400">{playerName}</span>{" "}
        <span className="font-medium">{answer.answer}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          disabled={busy}
          onClick={() => award(maxPoints)}
          className={
            "px-2 py-0.5 text-xs rounded " +
            (fullChosen
              ? "bg-emerald-500 text-white"
              : "bg-zinc-800 text-zinc-300 hover:bg-emerald-500/30")
          }
          title={`Full pott (${maxPoints})`}
        >
          ✓
        </button>
        {maxPoints > 1 && (
          <button
            disabled={busy}
            onClick={() => award(half)}
            className={
              "px-2 py-0.5 text-xs rounded " +
              (halfChosen
                ? "bg-amber-500 text-zinc-900"
                : "bg-zinc-800 text-zinc-300 hover:bg-amber-500/30")
            }
            title={`Halv pott (${half})`}
          >
            ½
          </button>
        )}
        <button
          disabled={busy}
          onClick={() => award(0)}
          className={
            "px-2 py-0.5 text-xs rounded " +
            (zeroChosen
              ? "bg-red-500 text-white"
              : "bg-zinc-800 text-zinc-300 hover:bg-red-500/30")
          }
          title="Null poeng"
        >
          ✗
        </button>
        <input
          type="number"
          min={0}
          max={maxPoints}
          value={pointsInput}
          onChange={(e) => setPointsInput(e.target.value)}
          onBlur={() => {
            const n = parseInt(pointsInput, 10);
            if (Number.isFinite(n) && n !== answer.points_awarded) {
              award(Math.max(0, Math.min(maxPoints, n)));
            }
          }}
          disabled={busy}
          className="w-12 rounded bg-zinc-950 border border-zinc-800 px-1 py-0.5 text-xs font-mono text-center"
          placeholder="–"
        />
      </div>
    </li>
  );
}

function QuestionListPanel({
  questions,
  currentId,
  call,
  roomCode,
}: {
  questions: Question[];
  currentId: string | null;
  call: (path: string, body: unknown) => Promise<unknown>;
  roomCode: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function clone() {
    if (!confirm("Lage en ny quiz med de samme spørsmålene?")) return;
    setCloning(true);
    setError(null);
    try {
      const res = (await call(`/api/rooms/${roomCode}/clone`, {})) as {
        code: string;
        host_secret: string;
      };
      window.open(`/r/${res.code}/host?k=${res.host_secret}`, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Klarte ikke å klone quizen");
    } finally {
      setCloning(false);
    }
  }

  if (questions.length === 0) return null;
  return (
    <section className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Alle spørsmål</h2>
        <button
          onClick={clone}
          disabled={cloning}
          className="text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-60 px-3 py-1.5"
          title="Lag en ny quiz med kopier av alle spørsmål"
        >
          {cloning ? "Kloner…" : "📄 Lag ny quiz fra disse"}
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        Klikk på spørsmålet for å hoppe dit. Spillerne ser det med en gang.
      </p>
      <ol className="space-y-1">
        {questions.map((q, i) => {
          const isCurrent = q.id === currentId;
          const isFirst = i === 0;
          const isLast = i === questions.length - 1;
          return (
            <li
              key={q.id}
              className={
                "flex items-center gap-1 rounded px-1 py-1 text-sm " +
                (isCurrent ? "bg-indigo-500/15 text-indigo-200" : "")
              }
            >
              <button
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(q.id);
                  try {
                    await call(`/api/rooms/${roomCode}/state`, {
                      phase: "revealed",
                      current_question_id: q.id,
                    });
                  } finally {
                    setBusy(null);
                  }
                }}
                className="flex-1 text-left truncate hover:text-indigo-200 disabled:opacity-60 px-1"
              >
                <span className="text-zinc-500 mr-2">{i + 1}.</span>
                {q.prompt}
                {q.image_url && <span className="text-zinc-500 ml-1">📷</span>}
              </button>
              <span className="text-xs text-zinc-500 shrink-0 mr-1">
                {q.type === "choice" ? "MC" : "fritekst"} · {q.points}p
              </span>
              <button
                disabled={busy !== null || isFirst}
                onClick={async () => {
                  setBusy(q.id);
                  try {
                    await call(`/api/rooms/${roomCode}/questions/reorder`, {
                      id: q.id,
                      direction: "up",
                    });
                  } finally {
                    setBusy(null);
                  }
                }}
                className="text-xs px-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30"
                title="Flytt opp"
              >
                ↑
              </button>
              <button
                disabled={busy !== null || isLast}
                onClick={async () => {
                  setBusy(q.id);
                  try {
                    await call(`/api/rooms/${roomCode}/questions/reorder`, {
                      id: q.id,
                      direction: "down",
                    });
                  } finally {
                    setBusy(null);
                  }
                }}
                className="text-xs px-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30"
                title="Flytt ned"
              >
                ↓
              </button>
              <button
                disabled={busy !== null}
                onClick={async () => {
                  if (!confirm("Slette dette spørsmålet?")) return;
                  setBusy(q.id);
                  try {
                    await call(
                      `/api/rooms/${q.room_code}/questions/delete`,
                      { id: q.id },
                    );
                  } finally {
                    setBusy(null);
                  }
                }}
                className="text-xs px-1 text-zinc-500 hover:text-red-400"
                title="Slett spørsmål"
              >
                🗑
              </button>
            </li>
          );
        })}
      </ol>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  );
}

function AddQuestionPanel({
  existingCount,
  call,
  uploadFile,
}: {
  existingCount: number;
  call: (path: string, body: unknown) => Promise<unknown>;
  uploadFile: (file: File) => Promise<string>;
}) {
  const [type, setType] = useState<QuestionType>("text");
  const [prompt, setPrompt] = useState("");
  const [correct, setCorrect] = useState("");
  const [choicesText, setChoicesText] = useState("");
  const [points, setPoints] = useState(1);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    const m = window.location.pathname.match(/\/r\/([^/]+)\/host/);
    setCode(m?.[1] ?? null);
  }, []);

  function handleFile(file: File | null) {
    setImageFile(file);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  }

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
        throw new Error("Legg til minst to alternativer, ett per linje.");
      }
      if (type === "choice" && choices && !choices.includes(correct.trim())) {
        throw new Error("Riktig svar må være ett av alternativene.");
      }

      let imageUrl: string | null = null;
      if (imageFile) {
        imageUrl = await uploadFile(imageFile);
      }

      await call(`/api/rooms/${code}/questions`, {
        type,
        prompt: prompt.trim(),
        correct_answer: correct.trim(),
        choices,
        points,
        image_url: imageUrl,
      });
      setPrompt("");
      setCorrect("");
      setChoicesText("");
      setPoints(1);
      handleFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Klarte ikke å legge til spørsmål");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-3">
      <h2 className="font-semibold">Legg til spørsmål #{existingCount + 1}</h2>
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
            Fritekst
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
            Flervalg
          </button>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Spørsmålstekst"
          rows={2}
          className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-indigo-500 text-sm"
          required
        />

        <div className="space-y-2">
          <label className="block text-xs text-zinc-500">
            Bilde (valgfritt, maks 5 MB)
          </label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-200 hover:file:bg-zinc-700"
          />
          {imagePreview && (
            <img
              src={imagePreview}
              alt="forhåndsvisning"
              className="max-h-40 rounded-md border border-zinc-800"
            />
          )}
        </div>

        {type === "choice" && (
          <textarea
            value={choicesText}
            onChange={(e) => setChoicesText(e.target.value)}
            placeholder={"Alternativer, ett per linje\nOslo\nBergen\nTrondheim"}
            rows={4}
            className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-indigo-500 text-sm font-mono"
            required
          />
        )}

        <input
          value={correct}
          onChange={(e) => setCorrect(e.target.value)}
          placeholder="Riktig svar"
          className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 outline-none focus:border-indigo-500 text-sm"
          required
        />

        <div className="flex items-center gap-3">
          <label className="text-sm text-zinc-400">Poeng</label>
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
          {busy ? "Legger til…" : "Legg til spørsmål"}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </section>
  );
}

function ScoreboardPanel({
  room,
  players,
  scores,
  call,
}: {
  room: RoomWithHostCode;
  players: Player[];
  scores: Record<string, number>;
  call: (path: string, body: unknown) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const sorted = [...players].sort(
    (a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0),
  );

  async function toggle() {
    setBusy(true);
    try {
      await call(`/api/rooms/${room.code}/state`, {
        show_scoreboard: !room.show_scoreboard,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl bg-zinc-900 border border-zinc-800 p-5 space-y-4">
      <div className="space-y-2">
        <h2 className="font-semibold">Poengtavle</h2>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          aria-pressed={room.show_scoreboard}
          className="w-full flex items-center justify-between gap-3 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-zinc-700 disabled:opacity-60 px-4 py-3 text-left"
        >
          <span className="flex flex-col">
            <span className="text-sm font-medium">
              Vis poengtavle til spillerne
            </span>
            <span className="text-xs text-zinc-500">
              {room.show_scoreboard
                ? "Spillerne ser stillingen nå"
                : "Spillerne ser bare seg selv"}
            </span>
          </span>
          <span
            className={
              "relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors " +
              (room.show_scoreboard ? "bg-emerald-500" : "bg-zinc-700")
            }
          >
            <span
              className={
                "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform " +
                (room.show_scoreboard ? "translate-x-5" : "translate-x-0.5")
              }
            />
          </span>
        </button>
      </div>
      {players.length === 0 ? (
        <p className="text-sm text-zinc-500">Ingen spillere ennå.</p>
      ) : (
        <ol className="space-y-1">
          {sorted.map((p, i) => (
            <li
              key={p.id}
              className="flex items-center justify-between text-sm bg-zinc-950 rounded px-3 py-2 gap-2"
            >
              <span className="truncate">
                <span className="text-zinc-500 mr-2">{i + 1}.</span>
                {p.name}
              </span>
              <span className="flex items-center gap-3 shrink-0">
                {p.rejoin_code && (
                  <span className="font-mono text-xs tracking-widest text-zinc-500">
                    {p.rejoin_code}
                  </span>
                )}
                <span className="font-mono font-semibold">
                  {scores[p.id] ?? 0}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {players.length > 0 && (
        <p className="text-xs text-zinc-500">
          Koden ved siden av navnet er spillerens kode for å fortsette – del
          den med dem hvis de mister tilgangen.
        </p>
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
