"use client";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const REACTION_EXPIRY_MS = 3500;
const TICK_INTERVAL_MS = 500;

export type IncomingReaction = {
  id: string;
  emoji: string;
  ts: number;
  player_id: string | null;
};

// Unified hook used by both player and host pages. Single Supabase
// realtime channel; sendReaction broadcasts and also appends locally
// so the sender sees their own reaction too.
export function useRoomReactions(
  roomCode: string,
  selfPlayerId: string | null,
): {
  reactions: IncomingReaction[];
  sendReaction: (emoji: string) => void;
} {
  const [reactions, setReactions] = useState<IncomingReaction[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<
    ReturnType<typeof supabaseBrowser>["channel"]
  > | null>(null);
  const subscribedRef = useRef(false);

  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase.channel(`reactions:${roomCode}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel.on(
      "broadcast",
      { event: "react" },
      (msg: {
        payload?: {
          id?: string;
          emoji?: string;
          ts?: number;
          player_id?: string | null;
        };
      }) => {
        const payload = msg?.payload;
        if (
          !payload ||
          typeof payload.id !== "string" ||
          typeof payload.emoji !== "string"
        ) {
          return;
        }
        if (seenRef.current.has(payload.id)) return;
        seenRef.current.add(payload.id);
        const ts =
          typeof payload.ts === "number" ? payload.ts : Date.now();
        setReactions((prev) => [
          ...prev,
          {
            id: payload.id!,
            emoji: payload.emoji!,
            ts,
            player_id:
              typeof payload.player_id === "string" ? payload.player_id : null,
          },
        ]);
      },
    );

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") subscribedRef.current = true;
    });

    const interval = setInterval(() => {
      const cutoff = Date.now() - REACTION_EXPIRY_MS;
      setReactions((prev) => {
        const next = prev.filter((r) => r.ts > cutoff);
        if (next.length !== prev.length) {
          for (const r of prev) {
            if (r.ts <= cutoff) seenRef.current.delete(r.id);
          }
          return next;
        }
        return prev;
      });
    }, TICK_INTERVAL_MS);

    return () => {
      subscribedRef.current = false;
      channelRef.current = null;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [roomCode]);

  const sendReaction = useCallback(
    (emoji: string) => {
      const id = crypto.randomUUID();
      const reaction: IncomingReaction = {
        id,
        emoji,
        ts: Date.now(),
        player_id: selfPlayerId,
      };
      // Local echo so the sender sees their own reaction.
      seenRef.current.add(id);
      setReactions((prev) => [...prev, reaction]);
      const channel = channelRef.current;
      if (channel && subscribedRef.current) {
        void channel.send({
          type: "broadcast",
          event: "react",
          payload: reaction,
        });
      }
    },
    [selfPlayerId],
  );

  return { reactions, sendReaction };
}

// Backwards-compat wrappers (kept so any imports keep working).
export function useReactionSender(roomCode: string) {
  const { sendReaction } = useRoomReactions(roomCode, null);
  return useMemo(() => ({ sendReaction }), [sendReaction]);
}
export function useReactionReceiver(roomCode: string) {
  const { reactions } = useRoomReactions(roomCode, null);
  const consume = useCallback((_id: string) => {
    void _id;
  }, []);
  return { reactions, consume };
}
