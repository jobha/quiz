"use client";

import { useEffect, useMemo, useRef, useState, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { normalizeRoomCode } from "@/lib/room-code";
import type { Answer, Player, Question, Room } from "@/lib/types";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Confetti } from "@/components/Confetti";
import { AudioClue } from "@/components/AudioClue";
import { useTypingBroadcast } from "@/lib/typing-presence";

type Params = { code: string };

export default function PlayerPage({ params }: { params: Promise<Params> }) {
  const { code: rawCode } = use(params);
  const code = normalizeRoomCode(rawCode);
  const router = useRouter();
  const searchParams = useSearchParams();
  const playerIdFromUrl = searchParams.get("p");
  const previewMode = searchParams.get("preview") === "1";

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [room, setRoom] = useState<Room | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [myAnswers, setMyAnswers] = useState<Record<string, Answer>>({});
  const [allAnswers, setAllAnswers] = useState<Answer[]>([]);
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);

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
        .select(
          "code, phase, current_question_id, show_scoreboard, show_own_score, show_history, hide_rejoin_codes, accent_color, created_at",
        )
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

  // For the player-facing scoreboard: load all answers and stay in sync.
  // Cheap because the room is small.
  useEffect(() => {
    if (!room?.show_scoreboard) {
      setAllAnswers([]);
      return;
    }
    const sb = supabaseBrowser();
    let cancelled = false;

    async function load() {
      const { data: ans } = await sb
        .from("answers")
        .select("*")
        .eq("room_code", code);
      if (cancelled) return;
      if (ans) setAllAnswers(ans as Answer[]);
    }
    load();

    const channel = sb
      .channel(`scoreboard:${code}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "answers", filter: `room_code=eq.${code}` },
        (payload) => {
          setAllAnswers((prev) => {
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
  }, [code, room?.show_scoreboard]);

  // Load all questions for history view, when enabled.
  useEffect(() => {
    if (!room?.show_history) {
      setAllQuestions([]);
      return;
    }
    const sb = supabaseBrowser();
    let cancelled = false;
    async function load() {
      const { data } = await sb
        .from("questions")
        .select("*")
        .eq("room_code", code)
        .order("position");
      if (!cancelled && data) setAllQuestions(data as Question[]);
    }
    load();
    const channel = sb
      .channel(`history:${code}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "questions", filter: `room_code=eq.${code}` },
        (payload) => {
          setAllQuestions((prev) => {
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
      .subscribe();
    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [code, room?.show_history]);

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
      setJoinError(e instanceof Error ? e.message : "Klarte ikke å bli med");
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
      if (typeof a.points_awarded === "number") s += a.points_awarded;
    }
    return s;
  }, [myAnswers]);

  const allScores = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of players) out[p.id] = 0;
    for (const a of allAnswers) {
      if (typeof a.points_awarded === "number") {
        out[a.player_id] = (out[a.player_id] ?? 0) + a.points_awarded;
      }
    }
    return out;
  }, [allAnswers, players]);

  if (!room) {
    return (
      <Centered>
        <p className="text-zinc-600 dark:text-zinc-400">Leter etter rom {code}…</p>
      </Centered>
    );
  }

  if (!previewMode && (!playerId || !me)) {
    return (
      <Centered>
        <div className="w-full max-w-md space-y-6">
          <header className="text-center">
            <p className="text-zinc-600 dark:text-zinc-400 text-sm">Blir med i rom</p>
            <h1 className="text-3xl font-bold tracking-[0.3em] font-mono">
              {code}
            </h1>
          </header>
          <form
            onSubmit={joinRoom}
            className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 space-y-4"
          >
            <label className="block text-sm text-zinc-600 dark:text-zinc-400">Ditt navn</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="f.eks. Jonas"
              maxLength={40}
              className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-4 py-3 outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={joining || !name.trim()}
              className="w-full rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 px-4 py-3 font-medium"
            >
              {joining ? "Blir med…" : "Bli med"}
            </button>
            {joinError && (
              <p className="text-sm text-red-400">{joinError}</p>
            )}
          </form>
        </div>
      </Centered>
    );
  }

  const accentStyle = room.accent_color
    ? ({ ["--accent" as never]: room.accent_color } as React.CSSProperties)
    : undefined;
  return (
    <main
      className="min-h-screen p-6 pb-24 max-w-2xl mx-auto space-y-6"
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
      {!previewMode && <Confetti trigger={room.phase === "ended"} />}
      {!previewMode && (
        <ThemeToggle className="fixed right-4 bottom-4 sm:top-4 sm:bottom-auto z-10" />
      )}
      {previewMode && (
        <div className="rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-800 dark:text-amber-200 px-3 py-2 text-xs">
          🔍 Forhåndsvisning – sånn ser spillerne det. Endringer her lagres ikke.
        </div>
      )}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-widest">
            Rom {code}
          </p>
          <p className="text-lg font-semibold">
            {previewMode ? "Eksempel-spiller" : me!.name}
          </p>
          {!previewMode && me!.rejoin_code && (
            <p className="text-xs text-zinc-500 mt-1">
              Din kode for å fortsette:{" "}
              <span className="font-mono tracking-widest text-zinc-700 dark:text-zinc-300">
                {me!.rejoin_code}
              </span>
            </p>
          )}
        </div>
        {room.show_own_score && !previewMode && (
          <div className="text-right">
            <p className="text-xs text-zinc-500 uppercase tracking-widest">
              Poeng
            </p>
            <p className="text-2xl font-bold leading-none">{myScore}</p>
          </div>
        )}
      </header>

      <PlayerStage
        room={room}
        question={question}
        myAnswer={
          !previewMode && question ? myAnswers[question.id] : undefined
        }
        playerId={playerId ?? "preview"}
        code={code}
        previewMode={previewMode}
      />

      {room.show_history && (
        <HistoryPanel
          questions={allQuestions}
          currentQuestionId={room.current_question_id}
          myAnswers={myAnswers}
          showOwnScore={room.show_own_score}
        />
      )}

      {room.show_scoreboard ? (
        <ScoreboardForPlayers
          players={players}
          scores={allScores}
          myId={playerId ?? ""}
          hideCodes={room.hide_rejoin_codes}
        />
      ) : (
        <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4">
          <h2 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 mb-3">
            Spillere ({players.length})
          </h2>
          <ul className="space-y-1">
            {players.map((p) => (
              <li
                key={p.id}
                className={
                  "flex items-center justify-between rounded-md px-3 py-2 text-sm gap-2 " +
                  (p.id === playerId
                    ? "accent-bg-faded accent-text"
                    : "bg-zinc-50 dark:bg-zinc-950")
                }
              >
                <span className="truncate">{p.name}</span>
                {!room.hide_rejoin_codes && p.rejoin_code && (
                  <span className="font-mono text-xs tracking-widest text-zinc-500 shrink-0">
                    {p.rejoin_code}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!room.hide_rejoin_codes && (
            <p className="text-xs text-zinc-500 mt-3">
              Koden ved siden av navnet er spillerens kode for å fortsette –
              del den hvis noen blir kastet ut.
            </p>
          )}
        </section>
      )}
    </main>
  );
}

function ScoreboardForPlayers({
  players,
  scores,
  myId,
  hideCodes,
}: {
  players: Player[];
  scores: Record<string, number>;
  myId: string;
  hideCodes: boolean;
}) {
  const sorted = [...players].sort(
    (a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0),
  );
  return (
    <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4">
      <h2 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400 mb-3">Poengtavle</h2>
      <ol className="space-y-1">
        {sorted.map((p, i) => (
          <li
            key={p.id}
            className={
              "flex items-center justify-between text-sm rounded px-3 py-2 gap-2 " +
              (p.id === myId
                ? "accent-bg-faded accent-text"
                : "bg-zinc-50 dark:bg-zinc-950")
            }
          >
            <span className="truncate">
              <span className="text-zinc-500 mr-2">{i + 1}.</span>
              {p.name}
            </span>
            <span className="flex items-center gap-3 shrink-0">
              {!hideCodes && p.rejoin_code && (
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
    </section>
  );
}

function PlayerStage({
  room,
  question,
  myAnswer,
  playerId,
  code,
  previewMode,
}: {
  room: Room;
  question: Question | null;
  myAnswer: Answer | undefined;
  playerId: string;
  code: string;
  previewMode: boolean;
}) {
  if (room.phase === "lobby") {
    return (
      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 text-center">
        <p className="text-zinc-600 dark:text-zinc-400">Venter på at quizmasteren starter…</p>
      </div>
    );
  }
  if (room.phase === "ended") {
    return (
      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 text-center">
        <p className="text-lg font-semibold">Quizen er ferdig!</p>
        <p className="text-zinc-600 dark:text-zinc-400 text-sm mt-1">Takk for at du spilte.</p>
      </div>
    );
  }
  if (!question) {
    return (
      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 text-center">
        <p className="text-zinc-600 dark:text-zinc-400">Laster spørsmål…</p>
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
      previewMode={previewMode}
    />
  );
}

function QuestionView({
  room,
  question,
  myAnswer,
  playerId,
  code,
  previewMode,
}: {
  room: Room;
  question: Question;
  myAnswer: Answer | undefined;
  playerId: string;
  code: string;
  previewMode: boolean;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastQuestionId = useRef<string | null>(null);
  const { signalTyping } = useTypingBroadcast(code, playerId);

  // Reset draft when question changes; preload draft from existing answer.
  useEffect(() => {
    if (lastQuestionId.current !== question.id) {
      setText(myAnswer?.answer ?? "");
      setError(null);
      lastQuestionId.current = question.id;
    }
  }, [question.id, myAnswer?.answer]);

  const revealed = room.phase === "revealed";
  const locked = revealed; // can change answer until revealed
  const submitted = !!myAnswer;

  async function submit(answer: string) {
    if (!answer.trim() || previewMode) return;
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
      setError(e instanceof Error ? e.message : "Klarte ikke å sende");
    } finally {
      setSubmitting(false);
    }
  }

  const correctAnswerDisplay =
    question.type === "multi" && question.correct_answers
      ? question.correct_answers.join(", ")
      : question.type === "numeric" && question.tolerance
      ? `${question.correct_answer} (±${question.tolerance})`
      : question.correct_answer;

  return (
    <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 space-y-5">
      <div>
        <p className="text-xs uppercase tracking-widest text-zinc-500">
          Spørsmål
        </p>
        <h2 className="text-2xl font-semibold mt-1">{question.prompt}</h2>
        {question.image_url && (
          <img
            src={question.image_url}
            alt=""
            className="mt-3 max-h-72 w-full object-contain rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800"
          />
        )}
        {question.audio_url && (
          <div className="mt-3">
            <AudioClue src={question.audio_url} />
          </div>
        )}
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
                    ? "bg-emerald-500/20 border-emerald-500 text-emerald-700 dark:text-emerald-100"
                    : isWrongPick
                    ? "bg-red-500/20 border-red-500 text-red-700 dark:text-red-100"
                    : chosen
                    ? "accent-bg-faded accent-border"
                    : "bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600 disabled:opacity-60")
                }
              >
                {choice}
              </button>
            );
          })}
        </div>
      ) : question.type === "multi" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
          className="space-y-3"
        >
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              signalTyping();
            }}
            disabled={locked || submitting}
            rows={4}
            placeholder="Ett svar per linje"
            className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-4 py-3 outline-none focus:border-indigo-500 disabled:opacity-70 font-mono text-sm"
          />
          {!locked && (
            <button
              type="submit"
              disabled={submitting || !text.trim()}
              className="w-full rounded-lg accent-bg disabled:opacity-60 px-4 py-3 font-medium"
            >
              {submitting ? "Sender…" : submitted ? "Oppdater svar" : "Send"}
            </button>
          )}
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
          className="space-y-3"
        >
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              signalTyping();
            }}
            disabled={locked || submitting}
            type={question.type === "numeric" ? "number" : "text"}
            step={question.type === "numeric" ? "any" : undefined}
            placeholder={
              question.type === "numeric" ? "Skriv et tall" : "Skriv svaret ditt"
            }
            className="w-full rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-4 py-3 outline-none focus:border-indigo-500 disabled:opacity-70"
          />
          {!locked && (
            <button
              type="submit"
              disabled={submitting || !text.trim()}
              className="w-full rounded-lg accent-bg disabled:opacity-60 px-4 py-3 font-medium"
            >
              {submitting ? "Sender…" : submitted ? "Oppdater svar" : "Send"}
            </button>
          )}
        </form>
      )}

      {submitted && !revealed && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Svaret er sendt. Du kan endre det helt frem til quizmasteren
          avslører.
        </p>
      )}

      {revealed && (
        <div
          key={question.id}
          className="reveal-card rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 p-4 space-y-1"
        >
          <p className="text-xs text-zinc-500 uppercase tracking-widest">
            Riktig svar
          </p>
          <p className="font-medium">{correctAnswerDisplay}</p>
          {myAnswer ? (
            <ResultLine answer={myAnswer} maxPoints={question.points} />
          ) : (
            <p className="text-sm text-zinc-500 mt-2">Ingen svar sendt.</p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </section>
  );
}

function HistoryPanel({
  questions,
  currentQuestionId,
  myAnswers,
  showOwnScore,
}: {
  questions: Question[];
  currentQuestionId: string | null;
  myAnswers: Record<string, Answer>;
  showOwnScore: boolean;
}) {
  const currentIdx = currentQuestionId
    ? questions.findIndex((q) => q.id === currentQuestionId)
    : -1;
  const visible =
    currentIdx >= 0 ? questions.slice(0, currentIdx + 1) : questions;
  if (visible.length === 0) return null;
  return (
    <section className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 space-y-3">
      <h2 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
        Spørsmål så langt
      </h2>
      <ol className="space-y-2">
        {visible.map((q, i) => {
          const a = myAnswers[q.id];
          const pa = a?.points_awarded;
          const status =
            pa === undefined || pa === null
              ? "pending"
              : pa === 0
              ? "wrong"
              : pa === q.points
              ? "right"
              : "partial";
          return (
            <li
              key={q.id}
              className="rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 px-3 py-2 text-sm space-y-1"
            >
              <div className="flex items-start justify-between gap-2">
                <span>
                  <span className="text-zinc-500 mr-2">{i + 1}.</span>
                  {q.prompt}
                </span>
                {showOwnScore && a && (
                  <span
                    className={
                      "font-mono text-xs shrink-0 " +
                      (status === "right"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : status === "wrong"
                        ? "text-red-500 dark:text-red-400"
                        : status === "partial"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-zinc-500")
                    }
                  >
                    {status === "pending" ? "–" : `+${pa}`}
                  </span>
                )}
              </div>
              <div className="text-xs text-zinc-600 dark:text-zinc-400">
                {a ? (
                  <>
                    Ditt svar:{" "}
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {a.answer}
                    </span>
                  </>
                ) : (
                  <span className="text-zinc-500 italic">Ingen svar</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ResultLine({
  answer,
  maxPoints,
}: {
  answer: Answer;
  maxPoints: number;
}) {
  const pa = answer.points_awarded;
  if (pa === null || pa === undefined) {
    return (
      <p className="result-line text-sm mt-2 text-zinc-600 dark:text-zinc-400">
        Venter på dom fra quizmasteren…
      </p>
    );
  }
  if (pa === 0) {
    return (
      <p className="result-line text-sm mt-2 text-red-500 dark:text-red-400">
        Ikke helt.
      </p>
    );
  }
  if (pa === maxPoints) {
    return (
      <p className="result-line text-sm mt-2 text-emerald-600 dark:text-emerald-400">
        Riktig! +{pa}
      </p>
    );
  }
  return (
    <p className="result-line text-sm mt-2 text-amber-600 dark:text-amber-300">
      Delvis riktig! +{pa}
    </p>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      {children}
    </main>
  );
}
