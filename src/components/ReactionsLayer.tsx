"use client";
import { useEffect } from "react";
import { Avatar } from "@/components/Avatar";

const STYLE_ID = "reactions-layer-keyframes";
const KEYFRAMES = `
@keyframes reactions-float-up {
  0% {
    opacity: 0;
    transform: translate(-50%, 0) rotate(0deg);
  }
  10% {
    opacity: 1;
  }
  50% {
    transform: translate(calc(-50% + 14px), -150px) rotate(8deg);
  }
  100% {
    opacity: 0;
    transform: translate(calc(-50% - 10px), -300px) rotate(-6deg);
  }
}
.reactions-layer-emoji {
  animation: reactions-float-up 3s ease-out forwards;
  will-change: transform, opacity;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.35));
}
`;

function ensureStyleInjected() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

function hashLeft(id: string): number {
  let sum = 0;
  for (let i = 0; i < id.length; i++) {
    sum = (sum + id.charCodeAt(i)) % 1000;
  }
  return 10 + (sum % 81);
}

type LayerReaction = {
  id: string;
  emoji: string;
  ts: number;
  player_id: string | null;
};

type LayerPlayer = {
  id: string;
  name: string;
  avatar_emoji: string | null;
  avatar_color: string | null;
};

export function ReactionsLayer({
  reactions,
  players,
}: {
  reactions: LayerReaction[];
  players?: LayerPlayer[];
}) {
  useEffect(() => {
    ensureStyleInjected();
  }, []);

  const playerMap: Record<string, LayerPlayer> = {};
  for (const p of players ?? []) playerMap[p.id] = p;

  return (
    <div
      className="pointer-events-none"
      style={{ position: "fixed", inset: 0, zIndex: 30 }}
      aria-hidden
    >
      {reactions.map((r) => {
        const left = hashLeft(r.id);
        const sender = r.player_id ? playerMap[r.player_id] : null;
        return (
          <span
            key={r.id}
            className="reactions-layer-emoji"
            style={{
              position: "absolute",
              left: `${left}%`,
              bottom: "20%",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {sender && (
              <Avatar
                emoji={sender.avatar_emoji}
                color={sender.avatar_color}
                name={sender.name}
                size="sm"
              />
            )}
            <span className="text-4xl">{r.emoji}</span>
          </span>
        );
      })}
    </div>
  );
}
