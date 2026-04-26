"use client";

import type { Answer, Player, Question } from "@/lib/types";
import { Podium } from "@/components/Podium";

export function RoundSummaryOverlay({
  roundName,
  questions,
  answers,
  players,
  onClose,
  isHost = false,
}: {
  roundName: string;
  questions: Question[];
  answers: Answer[];
  players: Player[];
  onClose?: () => void;
  isHost?: boolean;
}) {
  const roundQuestionIds = new Set(questions.map((q) => q.id));
  const scores: Record<string, number> = {};
  for (const p of players) scores[p.id] = 0;
  for (const a of answers) {
    if (
      roundQuestionIds.has(a.question_id) &&
      typeof a.points_awarded === "number"
    ) {
      scores[a.player_id] = (scores[a.player_id] ?? 0) + a.points_awarded;
    }
  }

  const label = roundName.trim() || "Uten runde";

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm animate-[round-summary_400ms_cubic-bezier(0.2,0.7,0.2,1)] overflow-y-auto"
    >
      <div className="rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 max-w-2xl w-full space-y-4 shadow-2xl">
        <header className="text-center space-y-1">
          <p className="text-xs uppercase tracking-widest text-zinc-500">
            Runde-oppsummering
          </p>
          <h2 className="text-3xl font-bold accent-text">{label}</h2>
          <p className="text-xs text-zinc-500">
            {questions.length} spørsmål
          </p>
        </header>
        <Podium players={players} scores={scores} />
        {isHost && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 px-4 py-2 text-sm font-medium"
          >
            Lukk for alle
          </button>
        )}
      </div>
    </div>
  );
}
