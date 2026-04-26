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
import { ThemeToggle } from "@/components/ThemeToggle";
import { SortableQuestionList } from "@/components/SortableQuestionList";
import { Avatar } from "@/components/Avatar";
import { ReactionsLayer } from "@/components/ReactionsLayer";
import { ReactionsBar } from "@/components/ReactionsBar";
import { Podium } from "@/components/Podium";
import { useRoomReactions } from "@/lib/reactions";
import { useTypingListeners } from "@/lib/typing-presence";

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
  const [bonusByPlayer, setBonusByPlayer] = useState<Record<string, number>>({});

  // Reaction hooks — must run unconditionally on every render.
  const { sendReaction, reactions } = useRoomReactions(code, null);

  useEffect(() => {
    const sb = supabaseBrowser();
    let cancelled = false;

    async function load() {
      const [
        { data: roomData },
        { data: qs },
        { data: ps },
        { data: as },
        { data: bs },
      ] = await Promise.all([
        sb
          .from("rooms")
          .select(
            "code, phase, current_question_id, host_rejoin_code, show_scoreboard, show_own_score, show_history, hide_rejoin_codes, accent_color, spotlight_answer_id, created_at",
          )
          .eq("code", code)
          .maybeSingle(),
        sb.from("questions").select("*").eq("room_code", code).order("position"),
        sb.from("players").select("*").eq("room_code", code).order("created_at"),
        sb.from("answers").select("*").eq("room_code", code),
        sb.from("bonus_points").select("player_id, points").eq("room_code", code),
      ]);
      if (cancelled) return;
      setRoom((roomData as RoomWithHostCode) ?? null);
      setQuestions((qs as Question[]) ?? []);
      setPlayers((ps as Player[]) ?? []);
      setAnswers((as as Answer[]) ?? []);
      const bonusMap: Record<string, number> = {};
      for (const b of (bs ?? []) as { player_id: string; points: number }[]) {
        bonusMap[b.player_id] = (bonusMap[b.player_id] ?? 0) + b.points;
      }
      setBonusByPlayer(bonusMap);
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bonus_points", filter: `room_code=eq.${code}` },
        () => {
          // Refetch the aggregate on any bonus_points change.
          sb.from("bonus_points")
            .select("player_id, points")
            .eq("room_code", code)
            .then(({ data }) => {
              if (!data) return;
              const map: Record<string, number> = {};
              for (const b of data as { player_id: string; points: number }[]) {
                map[b.player_id] = (map[b.player_id] ?? 0) + b.points;
              }
              setBonusByPlayer(map);
            });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `room_code=eq.${code}` },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            const updated = payload.new as Player;
            setPlayers((prev) =>
              prev.map((p) => (p.id === updated.id ? updated : p)),
            );
          }
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
    for (const [pid, bonus] of Object.entries(bonusByPlayer)) {
      out[pid] = (out[pid] ?? 0) + bonus;
    }
    return out;
  }, [answers, players, bonusByPlayer]);

  if (!room) {
    return (
      <Centered>
        <p className="text-zinc-600 dark:text-zinc-400">Laster rom…</p>
      </Centered>
    );
  }

  if (!hostSecret) {
    return (
      <Centered>
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-bold">Trenger vertslenke</h1>
          <p className="text-zinc-600 dark:text-zinc-400 text-sm">
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

  const accentStyle = room?.accent_color
    ? ({ ["--accent" as never]: room.accent_color } as React.CSSProperties)
    : undefined;
  return (
    <main
      className="min-h-screen p-6 pb-24 max-w-5xl mx-auto space-y-6"
      style={accentStyle}
    >
      {room.accent_color && (
        <div
          aria-hidden
          className="fixed inset-0 -z-10 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 1200px 480px at 50% 0%, color-mix(in srgb, ${room.accent_color} 12%, transparent), transparent 70%)`,
          }}
        />
      )}
      <ReactionsLayer reactions={reactions} players={players} />
      <ThemeToggle className="fixed right-4 bottom-4 sm:top-4 sm:bottom-auto z-10" />
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-widest">
            Quizmaster for rom
          </p>
          <h1 className="text-3xl font-bold tracking-[0.3em] font-mono">
            {code}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
            Spillere blir med på{" "}
            <button
              onClick={() => navigator.clipboard.writeText(playerLink)}
              className="underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              {playerLink}
            </button>
          </p>
          {room.host_rejoin_code && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
              Din quizmasterkode:{" "}
              <span className="font-mono tracking-widest text-zinc-800 dark:text-zinc-200">
                {room.host_rejoin_code}
              </span>
            </p>
          )}
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
            scores={scores}
            call={call}
          />
          <QuestionListPanel
            questions={questions}
            currentId={room.current_question_id}
            call={call}
            roomCode={code}
            allAnswers={answers}
            playerCount={players.length}
          />
        </div>

        <div className="space-y-6">
          <AddQuestionPanel
            existingCount={questions.length}
            call={call}
            uploadFile={uploadFile}
          />
          <ScoreboardPanel
            players={players}
            scores={scores}
            questions={questions}
            answers={answers}
            bonusByPlayer={bonusByPlayer}
            roomCode={code}
            call={call}
          />
          <PlayerPreviewPanel code={code} />
        </div>
      </div>

      <SettingsPanel room={room} call={call} hostSecret={hostSecret} />

      <ReactionsBar onReact={(emoji) => sendReaction(emoji)} />
    </main>
  );
}

function PlayerPreviewPanel({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 space-y-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left"
        aria-expanded={open}
      >
        <h2 className="font-semibold">Forhåndsvisning</h2>
        <span className="text-zinc-400">{open ? "▼" : "▶"}</span>
      </button>
      {open && (
        <>
          <p className="text-xs text-zinc-500">
            Sånn ser spillerne det. Ikke knyttet til en konkret spiller –
            bli med fra en annen enhet for full opplevelse.
          </p>
          <div className="rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
            <iframe
              src={`/r/${code}?preview=1`}
              title="Spiller-forhåndsvisning"
              className="w-full h-[640px] bg-zinc-50 dark:bg-zinc-950"
            />
          </div>
        </>
      )}
    </section>
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
  scores,
  call,
}: {
  room: RoomWithHostCode;
  question: Question | null;
  questions: Question[];
  answers: Answer[];
  players: Player[];
  scores: Record<string, number>;
  call: (path: string, body: unknown) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { typingPlayerIds } = useTypingListeners(room.code);
  const playerById2 = Object.fromEntries(players.map((p) => [p.id, p]));
  const typingNames = typingPlayerIds
    .map((id) => playerById2[id]?.name)
    .filter((x): x is string => !!x);

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
      <div className="space-y-4">
        <Podium players={players} scores={scores} />
        <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 space-y-4">
        <h2 className="font-semibold">Quizen er ferdig</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
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
              className="rounded-lg accent-bg disabled:opacity-60 px-4 py-2 text-sm font-medium"
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
            className="rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-60 px-4 py-2 text-sm font-medium"
          >
            Tilbake til venterom
          </button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        </section>
      </div>
    );
  }

  const isRevealed = !!question?.revealed;
  return (
    <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Nåværende spørsmål</h2>
        <span className="text-xs text-zinc-500">
          {question
            ? isRevealed
              ? "avslørt"
              : "samler svar"
            : "venter"}
        </span>
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
                className="mt-2 max-h-56 w-full object-contain rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
              />
            )}
            <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-1">
              Svar: {question.correct_answer}
            </p>
            {question.type === "choice" && question.choices && (
              <ul className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 list-disc pl-5">
                {question.choices.map((c) => (
                  <li
                    key={c}
                    className={c === question.correct_answer ? "text-emerald-600 dark:text-emerald-400" : ""}
                  >
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 p-3">
            <div className="flex items-center justify-between mb-2 gap-2">
              <p className="text-xs text-zinc-500 uppercase tracking-widest">
                Svar ({answers.length}/{players.length})
              </p>
              {!isRevealed && typingNames.length > 0 && (
                <p className="text-xs text-zinc-500">
                  ✏️{" "}
                  {typingNames.length <= 3
                    ? typingNames.join(", ") + " skriver…"
                    : `${typingNames.length} skriver…`}
                </p>
              )}
            </div>
            {answers.length === 0 ? (
              <p className="text-sm text-zinc-500">Ingen svar ennå.</p>
            ) : (
              <ul className="space-y-2">
                {answers.map((a) => (
                  <AnswerRow
                    key={a.id}
                    answer={a}
                    player={playerById[a.player_id]}
                    maxPoints={question?.points ?? 1}
                    roomCode={room.code}
                    call={call}
                    spotlit={room.spotlight_answer_id === a.id}
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
                      current_question_id: prev.id,
                    }),
                  )
                }
                disabled={busy !== null}
                className="rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-60 px-3 py-2 text-sm"
              >
                ← Forrige
              </button>
            )}
            {!isRevealed ? (
              <button
                onClick={() =>
                  run("reveal", () =>
                    call(`/api/rooms/${room.code}/questions/reveal`, {
                      id: question.id,
                      revealed: true,
                    }),
                  )
                }
                disabled={busy !== null}
                className="rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-60 px-4 py-2 text-sm font-medium text-zinc-950"
              >
                Avslør svar
              </button>
            ) : (
              <button
                onClick={() =>
                  run("unreveal", () =>
                    call(`/api/rooms/${room.code}/questions/reveal`, {
                      id: question.id,
                      revealed: false,
                    }),
                  )
                }
                disabled={busy !== null}
                className="rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-60 px-3 py-2 text-sm"
                title="Skjul svaret igjen og la spillerne svare videre."
              >
                Skjul svar igjen
              </button>
            )}
            {next && (
              <button
                onClick={() =>
                  run("next", () =>
                    call(`/api/rooms/${room.code}/state`, {
                      current_question_id: next.id,
                    }),
                  )
                }
                disabled={busy !== null}
                className="rounded-lg accent-bg disabled:opacity-60 px-4 py-2 text-sm font-medium text-white"
              >
                {isRevealed ? "Neste spørsmål →" : "Hopp uten å avsløre →"}
              </button>
            )}
            {!next && (
              <button
                onClick={() =>
                  run("end", () =>
                    call(`/api/rooms/${room.code}/state`, { phase: "ended" }),
                  )
                }
                disabled={busy !== null}
                className="rounded-lg bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-600 disabled:opacity-60 px-4 py-2 text-sm font-medium"
              >
                Avslutt quiz
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
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
              className="rounded-lg accent-bg disabled:opacity-60 px-4 py-2 text-sm font-medium"
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
  player,
  maxPoints,
  roomCode,
  call,
  spotlit,
}: {
  answer: Answer;
  player: Player | undefined;
  maxPoints: number;
  roomCode: string;
  call: (path: string, body: unknown) => Promise<unknown>;
  spotlit: boolean;
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
  const half = maxPoints / 2;
  const halfChosen =
    answer.points_awarded === half &&
    answer.points_awarded !== null &&
    answer.points_awarded !== maxPoints &&
    answer.points_awarded !== 0;

  async function spotlight(next: boolean) {
    setBusy(true);
    try {
      await call(`/api/rooms/${roomCode}/spotlight`, {
        answer_id: next ? answer.id : null,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <div className="min-w-0 flex items-center gap-2">
        {player && (
          <Avatar
            emoji={player.avatar_emoji}
            color={player.avatar_color}
            name={player.name}
            size="sm"
          />
        )}
        <span className="text-zinc-600 dark:text-zinc-400">
          {player?.name ?? "?"}
        </span>{" "}
        <span className="font-medium">{answer.answer}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          disabled={busy}
          onClick={() => spotlight(!spotlit)}
          className={
            "px-2 py-0.5 text-xs rounded " +
            (spotlit
              ? "bg-amber-500 text-zinc-900"
              : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-amber-500/30")
          }
          title={spotlit ? "Slå av lyskasteren" : "Vis dette svaret stort på alle skjermer"}
        >
          🔍
        </button>
        <button
          disabled={busy}
          onClick={() => award(maxPoints)}
          className={
            "px-2 py-0.5 text-xs rounded " +
            (fullChosen
              ? "bg-emerald-500 text-white"
              : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-emerald-500/30")
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
                : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-amber-500/30")
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
              : "bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-red-500/30")
          }
          title="Null poeng"
        >
          ✗
        </button>
        <input
          type="number"
          min={0}
          step={0.5}
          value={pointsInput}
          onChange={(e) => setPointsInput(e.target.value)}
          onBlur={() => {
            const n = parseFloat(pointsInput);
            if (Number.isFinite(n) && n !== answer.points_awarded) {
              award(Math.max(0, Math.min(999, n)));
            }
          }}
          disabled={busy}
          className="w-14 rounded bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-1 py-0.5 text-xs font-mono text-center"
          placeholder="–"
          title="Du kan gi ethvert antall poeng – også over spørsmålets standardverdi"
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
  allAnswers,
  playerCount,
}: {
  questions: Question[];
  currentId: string | null;
  call: (path: string, body: unknown) => Promise<unknown>;
  roomCode: string;
  allAnswers: Answer[];
  playerCount: number;
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

  const [editingId, setEditingId] = useState<string | null>(null);

  // Group questions by round_name (treating null/empty as "Uten runde").
  // Each group keeps its questions in their existing position order. The
  // group order is determined by the first appearance of each round in
  // the position-sorted list.
  const groupedQuestions = useMemo(() => {
    const order: string[] = [];
    const groups: Record<string, Question[]> = {};
    for (const q of questions) {
      const key = q.round_name?.trim() || "";
      if (!(key in groups)) {
        groups[key] = [];
        order.push(key);
      }
      groups[key].push(q);
    }
    return order.map((key) => ({ name: key, items: groups[key] }));
  }, [questions]);

  async function persistGroupOrder(roundName: string, orderedIdsInGroup: string[]) {
    // Compose a global order: walk groups; for the affected round, swap
    // in the new ordering; everything else stays in current order.
    const fullOrder: string[] = [];
    for (const g of groupedQuestions) {
      if (g.name === roundName) {
        fullOrder.push(...orderedIdsInGroup);
      } else {
        fullOrder.push(...g.items.map((q) => q.id));
      }
    }
    setBusy("order");
    try {
      await call(`/api/rooms/${roomCode}/questions/order`, {
        order: fullOrder,
      });
    } finally {
      setBusy(null);
    }
  }

  if (questions.length === 0) return null;
  return (
    <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Alle spørsmål</h2>
        <button
          onClick={clone}
          disabled={cloning}
          className="text-xs rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-60 px-3 py-1.5"
          title="Lag en ny quiz med kopier av alle spørsmål"
        >
          {cloning ? "Kloner…" : "📄 Lag ny quiz fra disse"}
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        Dra ⋮⋮ for å endre rekkefølge. Klikk på spørsmålet for å hoppe dit
        – spillerne ser det med en gang.
      </p>
      {groupedQuestions.map((group) => (
        <div key={group.name || "_none"} className="space-y-1">
          <RoundHeader
            name={group.name}
            questionIds={group.items.map((q) => q.id)}
            roomCode={roomCode}
            call={call}
          />
          <SortableQuestionList
            questions={group.items.map((q) => {
              const globalIndex = questions.findIndex((x) => x.id === q.id);
              return {
                id: q.id,
                position: q.position,
                render: () => (
                  <QuestionListRow
                    q={q}
                    index={globalIndex}
                    isCurrent={q.id === currentId}
                    isEditing={editingId === q.id}
                    answerCount={
                      allAnswers.filter((a) => a.question_id === q.id).length
                    }
                    playerCount={playerCount}
                    onJump={async () => {
                      setBusy(q.id);
                      try {
                        await call(`/api/rooms/${roomCode}/state`, {
                          current_question_id: q.id,
                        });
                      } finally {
                        setBusy(null);
                      }
                    }}
                    onDelete={async () => {
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
                    onEdit={() =>
                      setEditingId(editingId === q.id ? null : q.id)
                    }
                    onSaved={() => setEditingId(null)}
                    call={call}
                    busy={busy !== null}
                  />
                ),
              };
            })}
            onReorder={(orderedIds) =>
              persistGroupOrder(group.name, orderedIds)
            }
          />
        </div>
      ))}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  );
}

function QuestionListRow({
  q,
  index,
  isCurrent,
  isEditing,
  answerCount,
  playerCount,
  onJump,
  onDelete,
  onEdit,
  onSaved,
  call,
  busy,
}: {
  q: Question;
  index: number;
  isCurrent: boolean;
  isEditing: boolean;
  answerCount: number;
  playerCount: number;
  onJump: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onEdit: () => void;
  onSaved: () => void;
  call: (path: string, body: unknown) => Promise<unknown>;
  busy: boolean;
}) {
  const typeLabel =
    q.type === "choice"
      ? "MC"
      : q.type === "numeric"
      ? "tall"
      : q.type === "multi"
      ? "flere"
      : "fritekst";
  return (
    <div className="flex flex-col gap-1">
      <div
        className={
          "flex items-center gap-1 rounded px-1 py-1 text-sm " +
          (isCurrent ? "accent-bg-faded accent-text" : "")
        }
      >
        <button
          disabled={busy}
          onClick={onJump}
          className="flex-1 text-left truncate hover:opacity-80 disabled:opacity-60 px-1"
        >
          <span className="text-zinc-500 mr-2">{index + 1}.</span>
          {q.prompt}
          {q.image_url && <span className="text-zinc-500 ml-1">📷</span>}
          {q.audio_url && <span className="text-zinc-500 ml-1">🔊</span>}
        </button>
        <span
          className={
            "text-xs shrink-0 mr-1 font-mono w-10 text-right tabular-nums " +
            (answerCount === 0
              ? "text-zinc-500"
              : answerCount === playerCount
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-amber-600 dark:text-amber-400")
          }
          title="Antall svar / antall spillere"
        >
          {answerCount}/{playerCount}
        </span>
        <span
          className={
            "text-xs shrink-0 mr-1 w-4 text-center " +
            (q.revealed
              ? "text-emerald-600 dark:text-emerald-400"
              : answerCount > 0
              ? "text-amber-600 dark:text-amber-400"
              : "text-zinc-400")
          }
          title={
            q.revealed
              ? "Avslørt"
              : answerCount > 0
              ? "Pågår"
              : "Ikke startet"
          }
        >
          {q.revealed ? "✓" : answerCount > 0 ? "…" : ""}
        </span>
        <span className="text-xs text-zinc-500 shrink-0 mr-1 w-20 text-right tabular-nums">
          {typeLabel} · {q.points}p
        </span>
        <button
          disabled={busy}
          onClick={onEdit}
          className={
            "text-xs px-1 disabled:opacity-30 " +
            (isEditing
              ? "text-indigo-600 dark:text-indigo-300"
              : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100")
          }
          title="Rediger"
        >
          ✎
        </button>
        <button
          disabled={busy}
          onClick={onDelete}
          className="text-xs px-1 text-zinc-600 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-30"
          title="Slett spørsmål"
        >
          ✗
        </button>
      </div>
      {isEditing && (
        <EditQuestionForm question={q} call={call} onSaved={onSaved} onCancel={onSaved} />
      )}
    </div>
  );
}

function EditQuestionForm({
  question,
  call,
  onSaved,
  onCancel,
}: {
  question: Question;
  call: (path: string, body: unknown) => Promise<unknown>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState(question.prompt);
  const [type, setType] = useState<QuestionType>(question.type);
  const [correct, setCorrect] = useState(question.correct_answer);
  const [choicesText, setChoicesText] = useState(
    question.choices?.join("\n") ?? "",
  );
  const [correctAnswers, setCorrectAnswers] = useState(
    question.correct_answers?.join("\n") ?? "",
  );
  const [tolerance, setTolerance] = useState(
    question.tolerance == null ? "0" : String(question.tolerance),
  );
  const [points, setPoints] = useState(question.points);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let choices: string[] | null = null;
      let correctAnswersArr: string[] | null = null;
      const trimmedCorrect = correct.trim();

      if (type === "choice") {
        choices = choicesText
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (choices.length < 2) {
          throw new Error("Trenger minst to alternativer.");
        }
        if (!choices.includes(trimmedCorrect)) {
          throw new Error("Riktig svar må være ett av alternativene.");
        }
      } else if (type === "multi") {
        correctAnswersArr = correctAnswers
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (correctAnswersArr.length < 1) {
          throw new Error("Legg til minst ett gyldig svar.");
        }
      } else if (type === "numeric") {
        if (!Number.isFinite(parseFloat(trimmedCorrect))) {
          throw new Error("Riktig svar må være et tall.");
        }
      }

      const tolNum = parseFloat(tolerance);

      await call(`/api/rooms/${question.room_code}/questions/edit`, {
        id: question.id,
        prompt: prompt.trim(),
        type,
        correct_answer:
          type === "multi" && correctAnswersArr
            ? correctAnswersArr[0]
            : trimmedCorrect,
        correct_answers: correctAnswersArr,
        tolerance:
          type === "numeric" && Number.isFinite(tolNum) ? tolNum : null,
        choices,
        points,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Klarte ikke å lagre");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={save}
      className="ml-6 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 p-3 space-y-2"
    >
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={2}
        className="w-full rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-sm"
        required
      />
      <div className="flex flex-wrap gap-1">
        {(
          [
            ["text", "Fritekst"],
            ["choice", "Flervalg"],
            ["numeric", "Tall"],
            ["multi", "Flere svar"],
          ] as [QuestionType, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className={
              "text-xs rounded-full px-2 py-0.5 border " +
              (type === t
                ? "accent-bg-faded accent-border accent-text"
                : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400")
            }
          >
            {label}
          </button>
        ))}
      </div>
      {type === "choice" && (
        <textarea
          value={choicesText}
          onChange={(e) => setChoicesText(e.target.value)}
          rows={3}
          placeholder="Alternativer, ett per linje"
          className="w-full rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-xs font-mono"
        />
      )}
      {type === "multi" ? (
        <textarea
          value={correctAnswers}
          onChange={(e) => setCorrectAnswers(e.target.value)}
          rows={3}
          placeholder="Godtatte svar, ett per linje"
          className="w-full rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-xs font-mono"
        />
      ) : (
        <input
          value={correct}
          onChange={(e) => setCorrect(e.target.value)}
          type={type === "numeric" ? "number" : "text"}
          step={type === "numeric" ? "any" : undefined}
          placeholder="Riktig svar"
          className="w-full rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-sm"
        />
      )}
      {type === "numeric" && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-500">Toleranse ±</label>
          <input
            type="number"
            min={0}
            step="any"
            value={tolerance}
            onChange={(e) => setTolerance(e.target.value)}
            className="w-20 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-sm"
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className="text-xs text-zinc-500">Poeng</label>
        <input
          type="number"
          min={0.5}
          max={100}
          step={0.5}
          value={points}
          onChange={(e) => setPoints(Number(e.target.value))}
          className="w-20 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-sm"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="text-sm rounded-lg accent-bg disabled:opacity-60 px-3 py-1 text-white"
        >
          {busy ? "Lagrer…" : "Lagre"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-sm rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 disabled:opacity-60 px-3 py-1"
        >
          Avbryt
        </button>
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    </form>
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
  const [correctAnswers, setCorrectAnswers] = useState(""); // for multi
  const [tolerance, setTolerance] = useState("0"); // for numeric
  const [choicesText, setChoicesText] = useState("");
  const [points, setPoints] = useState(1);
  const [roundName, setRoundName] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    const m = window.location.pathname.match(/\/r\/([^/]+)\/host/);
    setCode(m?.[1] ?? null);
  }, []);

  function handleImage(file: File | null) {
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
      let choices: string[] | null = null;
      let correctAnswersArr: string[] | null = null;
      const trimmedCorrect = correct.trim();

      if (type === "choice") {
        choices = choicesText
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (choices.length < 2) {
          throw new Error("Legg til minst to alternativer, ett per linje.");
        }
        if (!choices.includes(trimmedCorrect)) {
          throw new Error("Riktig svar må være ett av alternativene.");
        }
      } else if (type === "multi") {
        correctAnswersArr = correctAnswers
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (correctAnswersArr.length < 1) {
          throw new Error("Legg til minst ett gyldig svar (ett per linje).");
        }
      } else if (type === "numeric") {
        const n = parseFloat(trimmedCorrect);
        if (!Number.isFinite(n)) {
          throw new Error("Riktig svar må være et tall.");
        }
      }

      let imageUrl: string | null = null;
      if (imageFile) imageUrl = await uploadFile(imageFile);
      let audioUrl: string | null = null;
      if (audioFile) audioUrl = await uploadFile(audioFile);

      const tolNum = parseFloat(tolerance);

      await call(`/api/rooms/${code}/questions`, {
        type,
        prompt: prompt.trim(),
        correct_answer:
          type === "multi" && correctAnswersArr
            ? correctAnswersArr[0]
            : trimmedCorrect,
        correct_answers: correctAnswersArr,
        tolerance: type === "numeric" && Number.isFinite(tolNum) ? tolNum : null,
        choices,
        points,
        image_url: imageUrl,
        audio_url: audioUrl,
        round_name: roundName.trim() || null,
      });
      setPrompt("");
      setCorrect("");
      setCorrectAnswers("");
      setTolerance("0");
      setChoicesText("");
      setPoints(1);
      // Keep roundName so the host can chain questions in the same round.
      handleImage(null);
      setAudioFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Klarte ikke å legge til spørsmål");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 space-y-3">
      <h2 className="font-semibold">Legg til spørsmål #{existingCount + 1}</h2>
      <form onSubmit={add} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["text", "Fritekst"],
              ["choice", "Flervalg"],
              ["numeric", "Tall"],
              ["multi", "Flere svar"],
            ] as [QuestionType, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={
                "rounded-lg px-3 py-2 text-sm border " +
                (type === t
                  ? "accent-bg-faded accent-border accent-text"
                  : "bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400")
              }
            >
              {label}
            </button>
          ))}
        </div>

        <input
          value={roundName}
          onChange={(e) => setRoundName(e.target.value)}
          placeholder="Runde (valgfritt – f.eks. «Norsk pop»)"
          maxLength={80}
          className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 outline-none focus:border-indigo-500 text-sm"
        />

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Spørsmålstekst"
          rows={2}
          className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 outline-none focus:border-indigo-500 text-sm"
          required
        />

        <div className="space-y-2">
          <label className="block text-xs text-zinc-500">
            Bilde (valgfritt, maks 10 MB)
          </label>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-md bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 px-3 py-1.5 text-sm whitespace-nowrap">
              {imageFile ? "Bytt bilde" : "Velg bilde"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(e) => handleImage(e.target.files?.[0] ?? null)}
                className="hidden"
              />
            </label>
            {imageFile && (
              <>
                <span className="text-xs text-zinc-600 dark:text-zinc-400 truncate flex-1">
                  {imageFile.name}
                </span>
                <button
                  type="button"
                  onClick={() => handleImage(null)}
                  className="text-xs text-zinc-500 hover:text-red-400 shrink-0"
                >
                  Fjern
                </button>
              </>
            )}
          </div>
          {imagePreview && (
            <img
              src={imagePreview}
              alt="forhåndsvisning"
              className="max-h-40 rounded-md border border-zinc-200 dark:border-zinc-800"
            />
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-xs text-zinc-500">
            Lyd (valgfritt, maks 10 MB)
          </label>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-md bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 px-3 py-1.5 text-sm whitespace-nowrap">
              {audioFile ? "Bytt lyd" : "Velg lyd"}
              <input
                type="file"
                accept="audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/ogg,audio/x-m4a,audio/m4a"
                onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
                className="hidden"
              />
            </label>
            {audioFile && (
              <>
                <span className="text-xs text-zinc-600 dark:text-zinc-400 truncate flex-1">
                  {audioFile.name}
                </span>
                <button
                  type="button"
                  onClick={() => setAudioFile(null)}
                  className="text-xs text-zinc-500 hover:text-red-400 shrink-0"
                >
                  Fjern
                </button>
              </>
            )}
          </div>
        </div>

        {type === "choice" && (
          <textarea
            value={choicesText}
            onChange={(e) => setChoicesText(e.target.value)}
            placeholder={"Alternativer, ett per linje\nOslo\nBergen\nTrondheim"}
            rows={4}
            className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 outline-none focus:border-indigo-500 text-sm font-mono"
            required
          />
        )}

        {type === "multi" ? (
          <textarea
            value={correctAnswers}
            onChange={(e) => setCorrectAnswers(e.target.value)}
            placeholder={"Godtatte svar, ett per linje\nLake Superior\nLake Huron\nLake Michigan\nLake Erie\nLake Ontario"}
            rows={4}
            className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 outline-none focus:border-indigo-500 text-sm font-mono"
            required
          />
        ) : (
          <input
            value={correct}
            onChange={(e) => setCorrect(e.target.value)}
            placeholder={
              type === "numeric" ? "Riktig svar (tall)" : "Riktig svar"
            }
            type={type === "numeric" ? "number" : "text"}
            step={type === "numeric" ? "any" : undefined}
            className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 outline-none focus:border-indigo-500 text-sm"
            required
          />
        )}

        {type === "numeric" && (
          <div className="flex items-center gap-3">
            <label className="text-sm text-zinc-600 dark:text-zinc-400">
              Toleranse ±
            </label>
            <input
              type="number"
              min={0}
              step="any"
              value={tolerance}
              onChange={(e) => setTolerance(e.target.value)}
              className="w-24 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 outline-none focus:border-indigo-500 text-sm"
            />
            <span className="text-xs text-zinc-500">
              Svar innenfor dette får full pott
            </span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <label className="text-sm text-zinc-600 dark:text-zinc-400">Poeng</label>
          <input
            type="number"
            min={0.5}
            max={100}
            step={0.5}
            value={points}
            onChange={(e) => setPoints(Number(e.target.value))}
            className="w-24 rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 outline-none focus:border-indigo-500 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg accent-bg disabled:opacity-60 px-4 py-2 text-sm font-medium"
        >
          {busy ? "Legger til…" : "Legg til spørsmål"}
        </button>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </form>
    </section>
  );
}

function ScoreboardPanel({
  players,
  scores,
  questions,
  answers,
  bonusByPlayer,
  roomCode,
  call,
}: {
  players: Player[];
  scores: Record<string, number>;
  questions: Question[];
  answers: Answer[];
  bonusByPlayer: Record<string, number>;
  roomCode: string;
  call: (path: string, body: unknown) => Promise<unknown>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sorted = [...players].sort(
    (a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0),
  );

  return (
    <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 space-y-3">
      <h2 className="font-semibold">Poengtavle</h2>
      {players.length === 0 ? (
        <p className="text-sm text-zinc-500">Ingen spillere ennå.</p>
      ) : (
        <ol className="space-y-1">
          {sorted.map((p, i) => {
            const expanded = expandedId === p.id;
            const playerAnswers = answers.filter(
              (a) => a.player_id === p.id,
            );
            return (
              <li key={p.id} className="space-y-1">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId(expanded ? null : p.id)
                  }
                  className={
                    "w-full flex items-center justify-between text-sm rounded px-3 py-2 gap-2 text-left " +
                    (expanded
                      ? "accent-bg-faded"
                      : "bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-800/80")
                  }
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-zinc-500 w-5 text-right shrink-0">
                      {i + 1}.
                    </span>
                    <Avatar
                      emoji={p.avatar_emoji}
                      color={p.avatar_color}
                      name={p.name}
                      size="sm"
                    />
                    <span className="truncate">{p.name}</span>
                  </span>
                  <span className="flex items-center gap-3 shrink-0">
                    {p.rejoin_code && (
                      <span className="font-mono text-xs tracking-widest text-zinc-500">
                        {p.rejoin_code}
                      </span>
                    )}
                    <span className="font-mono font-semibold w-12 text-right tabular-nums">
                      {scores[p.id] ?? 0}
                    </span>
                  </span>
                </button>
                {expanded && (
                  <div className="ml-3 pl-3 border-l border-zinc-200 dark:border-zinc-800 space-y-1 pb-2">
                    {questions.length === 0 ? (
                      <p className="text-xs text-zinc-500 py-1">
                        Ingen spørsmål ennå.
                      </p>
                    ) : (
                      questions.map((q, qi) => {
                        const a = playerAnswers.find(
                          (x) => x.question_id === q.id,
                        );
                        return (
                          <PlayerAnswerRow
                            key={q.id}
                            question={q}
                            qIndex={qi}
                            answer={a}
                            roomCode={roomCode}
                            call={call}
                          />
                        );
                      })
                    )}
                    <BonusPointsRow
                      playerId={p.id}
                      bonusTotal={bonusByPlayer[p.id] ?? 0}
                      roomCode={roomCode}
                      call={call}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {players.length > 0 && (
        <p className="text-xs text-zinc-500">
          Klikk på en spiller for å se og endre poeng per spørsmål.
        </p>
      )}
    </section>
  );
}

function PlayerAnswerRow({
  question,
  qIndex,
  answer,
  roomCode,
  call,
}: {
  question: Question;
  qIndex: number;
  answer: Answer | undefined;
  roomCode: string;
  call: (path: string, body: unknown) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [pointsInput, setPointsInput] = useState<string>(
    answer?.points_awarded == null ? "" : String(answer.points_awarded),
  );

  useEffect(() => {
    setPointsInput(
      answer?.points_awarded == null ? "" : String(answer.points_awarded),
    );
  }, [answer?.points_awarded]);

  async function award(value: number) {
    if (!answer) return;
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

  return (
    <div className="flex items-center gap-2 text-xs py-1">
      <span className="text-zinc-500 shrink-0 w-5 text-right">{qIndex + 1}.</span>
      <span className="flex-1 min-w-0 truncate">
        {answer ? (
          <span className="text-zinc-800 dark:text-zinc-200">
            {answer.answer}
          </span>
        ) : (
          <span className="text-zinc-500 italic">Ingen svar</span>
        )}
      </span>
      {answer ? (
        <input
          type="number"
          min={0}
          step={0.5}
          value={pointsInput}
          onChange={(e) => setPointsInput(e.target.value)}
          onBlur={() => {
            const n = parseFloat(pointsInput);
            if (Number.isFinite(n) && n !== answer.points_awarded) {
              award(Math.max(0, Math.min(999, n)));
            }
          }}
          disabled={busy}
          className="w-14 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-1 py-0.5 text-xs font-mono text-center"
          placeholder="–"
        />
      ) : (
        <span className="font-mono text-zinc-500 w-14 text-center">—</span>
      )}
      <span className="text-zinc-500 w-12 text-right">
        / {question.points}
      </span>
    </div>
  );
}

function RoundHeader({
  name,
  questionIds,
  roomCode,
  call,
}: {
  name: string;
  questionIds: string[];
  roomCode: string;
  call: (path: string, body: unknown) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const newName = draft.trim();
      // Update every question in this group to the new round_name.
      // Empty string clears (so "Uten runde" becomes named, or a named
      // round can be reset to no-round).
      await Promise.all(
        questionIds.map((id) =>
          call(`/api/rooms/${roomCode}/questions/edit`, {
            id,
            round_name: newName || null,
          }),
        ),
      );
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Klarte ikke å lagre");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 mt-2">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          maxLength={80}
          placeholder="Rundenavn (tomt = ingen)"
          className="flex-1 rounded bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="text-xs rounded accent-bg disabled:opacity-60 px-2 py-1"
        >
          {busy ? "…" : "Lagre"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setDraft(name);
            setEditing(false);
          }}
          className="text-xs rounded bg-zinc-200 dark:bg-zinc-800 px-2 py-1"
        >
          Avbryt
        </button>
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
      className="group flex items-center gap-2 text-xs uppercase tracking-widest text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 mt-2"
      title="Klikk for å endre rundenavn for alle spørsmålene under"
    >
      <span>{name || "Uten runde"}</span>
      <span className="opacity-0 group-hover:opacity-100 transition-opacity">
        ✎
      </span>
    </button>
  );
}

function BonusPointsRow({
  playerId,
  bonusTotal,
  roomCode,
  call,
}: {
  playerId: string;
  bonusTotal: number;
  roomCode: string;
  call: (path: string, body: unknown) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [points, setPoints] = useState("1");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add() {
    const n = parseFloat(points);
    if (!Number.isFinite(n) || n === 0) return;
    setBusy(true);
    setError(null);
    try {
      await call(`/api/rooms/${roomCode}/bonus`, {
        player_id: playerId,
        points: n,
        reason: reason.trim() || null,
      });
      setReason("");
      setPoints("1");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Klarte ikke å gi bonus");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-xs py-1 space-y-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full hover:opacity-80"
      >
        <span className="text-zinc-500">+ Bonus</span>
        <span className="font-mono text-zinc-500">
          {bonusTotal !== 0 ? (bonusTotal > 0 ? `+${bonusTotal}` : bonusTotal) : "—"}
        </span>
      </button>
      {open && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            step={0.5}
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className="w-16 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-1 py-0.5 text-xs font-mono text-center"
          />
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="grunn (valgfritt)"
            className="flex-1 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 px-2 py-0.5 text-xs"
          />
          <button
            type="button"
            disabled={busy}
            onClick={add}
            className="rounded accent-bg disabled:opacity-60 px-2 py-0.5 text-xs"
          >
            Gi
          </button>
        </div>
      )}
      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}

function SettingsPanel({
  room,
  call,
  hostSecret,
}: {
  room: RoomWithHostCode;
  call: (path: string, body: unknown) => Promise<unknown>;
  hostSecret: string;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [importBusy, setImportBusy] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  async function setFlag(
    field:
      | "show_scoreboard"
      | "show_own_score"
      | "show_history"
      | "hide_rejoin_codes",
    value: boolean,
  ) {
    setBusy(true);
    try {
      await call(`/api/rooms/${room.code}/state`, { [field]: value });
    } finally {
      setBusy(false);
    }
  }

  async function setAccent(color: string | null) {
    setBusy(true);
    try {
      await call(`/api/rooms/${room.code}/state`, { accent_color: color });
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!importText.trim()) return;
    setImportBusy(true);
    setImportError(null);
    setImportMsg(null);
    try {
      const res = await fetch(
        `/api/rooms/${room.code}/questions/import`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-host-secret": hostSecret,
          },
          body: JSON.stringify({ format: "json", data: importText }),
        },
      );
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { inserted: number };
      setImportMsg(`La til ${json.inserted} spørsmål.`);
      setImportText("");
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Importen feilet");
    } finally {
      setImportBusy(false);
    }
  }

  function exportJson() {
    const url = `/api/rooms/${room.code}/questions/export`;
    fetch(url, { headers: { "x-host-secret": hostSecret } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `quiz-${room.code}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  const PRESET_COLORS = [
    null,
    "#6366f1",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#ec4899",
    "#8b5cf6",
    "#06b6d4",
  ];

  return (
    <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-5 space-y-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left"
        aria-expanded={open}
      >
        <h2 className="font-semibold">Innstillinger</h2>
        <span className="text-zinc-400">{open ? "▼" : "▶"}</span>
      </button>
      {open && (
        <div className="space-y-5">
          <div className="space-y-2">
            <h3 className="text-xs uppercase tracking-widest text-zinc-500">
              Synlighet
            </h3>
            <SwitchRow
              label="Vis hele poengtavlen"
              subtitle={
                room.show_scoreboard
                  ? "Spillerne ser stillingen til alle nå"
                  : "Spillerne ser ikke andres poeng"
              }
              checked={room.show_scoreboard}
              disabled={busy}
              onChange={(v) => setFlag("show_scoreboard", v)}
            />
            <SwitchRow
              label="Vis egne poeng"
              subtitle={
                room.show_own_score
                  ? "Spillerne ser sin egen poengsum"
                  : "Spillerne ser ingen poeng – kun spørsmål og svar"
              }
              checked={room.show_own_score}
              disabled={busy}
              onChange={(v) => setFlag("show_own_score", v)}
            />
            <SwitchRow
              label="Vis historikk"
              subtitle={
                room.show_history
                  ? "Spillerne ser tidligere spørsmål, sine svar og poeng"
                  : "Spillerne ser kun det aktive spørsmålet"
              }
              checked={room.show_history}
              disabled={busy}
              onChange={(v) => setFlag("show_history", v)}
            />
            <SwitchRow
              label="Skjul fortsettkoder"
              subtitle={
                room.hide_rejoin_codes
                  ? "Bare quizmasteren ser kodene"
                  : "Alle spillere ser hverandres koder"
              }
              checked={room.hide_rejoin_codes}
              disabled={busy}
              onChange={(v) => setFlag("hide_rejoin_codes", v)}
            />
          </div>

          <div className="space-y-2">
            <h3 className="text-xs uppercase tracking-widest text-zinc-500">
              Aksentfarge
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {PRESET_COLORS.map((color, i) => {
                const active = (room.accent_color ?? null) === color;
                return (
                  <button
                    key={color ?? "default"}
                    type="button"
                    disabled={busy}
                    onClick={() => setAccent(color)}
                    className={
                      "w-7 h-7 rounded-full border-2 transition " +
                      (active
                        ? "border-zinc-900 dark:border-zinc-100 scale-110"
                        : "border-zinc-300 dark:border-zinc-700 hover:scale-105")
                    }
                    style={
                      color
                        ? { backgroundColor: color }
                        : { background: "repeating-linear-gradient(45deg,#a1a1aa,#a1a1aa 4px,#e4e4e7 4px,#e4e4e7 8px)" }
                    }
                    title={color ?? "Standard"}
                    aria-label={color ? `Sett aksent ${color}` : "Standard farge"}
                  >
                    {i === 0 && (
                      <span className="text-[10px] text-zinc-700 dark:text-zinc-300">
                        ✕
                      </span>
                    )}
                  </button>
                );
              })}
              <input
                type="color"
                value={room.accent_color ?? "#6366f1"}
                onChange={(e) => setAccent(e.target.value)}
                disabled={busy}
                className="w-7 h-7 rounded-full cursor-pointer bg-transparent border-0"
                title="Velg egen farge"
              />
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xs uppercase tracking-widest text-zinc-500">
              Import / eksport
            </h3>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={exportJson}
                className="px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              >
                Last ned alle som JSON
              </button>
            </div>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='[{"type":"text","prompt":"Hovedstad i Norge?","correct_answer":"Oslo","points":1}]'
              rows={5}
              className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 outline-none focus:border-indigo-500 text-xs font-mono"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={runImport}
                disabled={importBusy || !importText.trim()}
                className="rounded-lg accent-bg disabled:opacity-60 px-4 py-2 text-sm font-medium text-white"
              >
                {importBusy ? "Importerer…" : "Importer"}
              </button>
              {importMsg && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400">
                  {importMsg}
                </span>
              )}
              {importError && (
                <span className="text-xs text-red-500 dark:text-red-400">
                  {importError}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              Lim inn JSON-array. Hvert objekt:{" "}
              <code>type, prompt, correct_answer, points</code> + valgfritt{" "}
              <code>choices</code>, <code>correct_answers</code>,{" "}
              <code>tolerance</code>, <code>image_url</code>,{" "}
              <code>audio_url</code>.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function SwitchRow({
  label,
  subtitle,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  subtitle: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 disabled:opacity-60 px-4 py-3 text-left"
    >
      <span className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-zinc-500">{subtitle}</span>
      </span>
      <span
        className={
          "relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors " +
          (checked ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700")
        }
      >
        <span
          className={
            "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform " +
            (checked ? "translate-x-5" : "translate-x-0.5")
          }
        />
      </span>
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      {children}
    </main>
  );
}
