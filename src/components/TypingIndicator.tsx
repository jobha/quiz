"use client";
import { useTypingListeners } from "@/lib/typing-presence";

export function TypingIndicator({
  roomCode,
  selfId,
  players,
}: {
  roomCode: string;
  selfId: string | null;
  players: { id: string; name: string }[];
}) {
  const { typingPlayerIds } = useTypingListeners(roomCode);
  const others = typingPlayerIds.filter((id) => id !== selfId);
  if (others.length === 0) return null;

  if (others.length >= 4) {
    return (
      <p className="text-xs text-zinc-500">
        ✏️ {others.length} spillere skriver…
      </p>
    );
  }

  const names = others.map(
    (id) => players.find((p) => p.id === id)?.name ?? "…"
  );

  let phrase: string;
  if (names.length === 1) {
    phrase = names[0];
  } else if (names.length === 2) {
    phrase = `${names[0]} og ${names[1]}`;
  } else {
    phrase = `${names.slice(0, -1).join(", ")} og ${names[names.length - 1]}`;
  }

  return <p className="text-xs text-zinc-500">✏️ {phrase} skriver…</p>;
}
