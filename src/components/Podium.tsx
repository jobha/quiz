"use client";
import { Avatar } from "@/components/Avatar";

type Player = {
  id: string;
  name: string;
  avatar_emoji: string | null;
  avatar_color: string | null;
};

type RankedPlayer = Player & { score: number; rank: number };

const STEP_HEIGHTS: Record<number, string> = {
  1: "h-32",
  2: "h-24",
  3: "h-16",
};

const RANK_LABELS: Record<number, string> = {
  1: "🥇 1.",
  2: "🥈 2.",
  3: "🥉 3.",
};

function rankPlayers(
  players: Player[],
  scores: Record<string, number>
): RankedPlayer[] {
  const withScores = players.map((p) => ({
    ...p,
    score: scores[p.id] ?? 0,
  }));
  withScores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });

  let lastScore: number | null = null;
  let lastRank = 0;
  return withScores.map((p, i) => {
    let rank: number;
    if (lastScore !== null && p.score === lastScore) {
      rank = lastRank;
    } else {
      rank = i + 1;
      lastRank = rank;
      lastScore = p.score;
    }
    return { ...p, rank };
  });
}

function PodiumColumn({
  player,
  place,
}: {
  player: RankedPlayer | undefined;
  place: 1 | 2 | 3;
}) {
  const stepHeight = STEP_HEIGHTS[place] ?? "h-16";
  return (
    <div className="flex flex-col items-center justify-end gap-3 flex-1 min-w-0">
      {player ? (
        <>
          <Avatar
            emoji={player.avatar_emoji}
            color={player.avatar_color}
            name={player.name}
            size="xl"
          />
          <div className="text-sm font-medium truncate max-w-full text-center">
            {player.name}
          </div>
          <div className="text-2xl font-mono font-bold tabular-nums">
            {player.score}
          </div>
        </>
      ) : (
        <div className="text-zinc-400 text-sm">—</div>
      )}
      <div
        className={`${stepHeight} w-full accent-bg-faded border-t border-zinc-200 dark:border-zinc-700 rounded-t-md flex items-start justify-center pt-2`}
      >
        <span className="text-sm font-semibold">
          {RANK_LABELS[player?.rank ?? place] ?? `${place}.`}
        </span>
      </div>
    </div>
  );
}

export function Podium({
  players,
  scores,
}: {
  players: Player[];
  scores: Record<string, number>;
}) {
  const wrapperClass =
    "rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6";

  if (players.length === 0) {
    return (
      <section className={wrapperClass}>
        <h2 className="text-2xl font-bold text-center mb-6">Vinner!</h2>
        <p className="text-center text-zinc-500">Ingen spillere</p>
      </section>
    );
  }

  const ranked = rankPlayers(players, scores);
  const top3 = ranked.slice(0, 3);
  const rest = ranked.slice(3);

  const first = top3.find((p) => p.rank === 1);
  // For 2nd & 3rd we still want to display in 2nd/3rd columns — pick the
  // top3 entries that aren't the first-place one, in the order they appear.
  const others = top3.filter((p) => p !== first);
  const second = others[0];
  const third = others[1];

  return (
    <section className={wrapperClass}>
      <h2 className="text-2xl font-bold text-center mb-6">Vinner!</h2>

      <div className="flex items-end gap-3">
        <PodiumColumn player={second} place={2} />
        <PodiumColumn player={first} place={1} />
        <PodiumColumn player={third} place={3} />
      </div>

      {rest.length > 0 ? (
        <ul className="mt-6 space-y-2">
          {rest.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 text-sm rounded-lg px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-zinc-500 font-mono w-8 tabular-nums">
                  {p.rank}.
                </span>
                <Avatar
                  emoji={p.avatar_emoji}
                  color={p.avatar_color}
                  name={p.name}
                  size="sm"
                />
                <span className="truncate">{p.name}</span>
              </div>
              <span className="font-mono tabular-nums font-semibold">
                {p.score}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
