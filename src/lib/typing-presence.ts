"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const TYPING_DEBOUNCE_MS = 1500;
const TYPING_EXPIRY_MS = 3000;
const TICK_INTERVAL_MS = 500;

export function useTypingBroadcast(
  roomCode: string,
  playerId: string | null
): { signalTyping: () => void } {
  const lastSentRef = useRef<number>(0);
  const channelRef = useRef<ReturnType<
    ReturnType<typeof supabaseBrowser>["channel"]
  > | null>(null);
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!playerId) return;
    const supabase = supabaseBrowser();
    const channel = supabase.channel(`typing:${roomCode}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        subscribedRef.current = true;
      }
    });
    return () => {
      subscribedRef.current = false;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [roomCode, playerId]);

  const signalTyping = useCallback(() => {
    if (!playerId) return;
    const now = Date.now();
    if (now - lastSentRef.current < TYPING_DEBOUNCE_MS) return;
    const channel = channelRef.current;
    if (!channel || !subscribedRef.current) return;
    lastSentRef.current = now;
    void channel.send({
      type: "broadcast",
      event: "typing",
      payload: { playerId, ts: now },
    });
  }, [playerId]);

  if (!playerId) {
    return { signalTyping: () => {} };
  }
  return { signalTyping };
}

export function useTypingListeners(
  roomCode: string
): { typingPlayerIds: string[] } {
  const [typingPlayerIds, setTypingPlayerIds] = useState<string[]>([]);
  const seenRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase.channel(`typing:${roomCode}`, {
      config: { broadcast: { self: false } },
    });

    channel.on(
      "broadcast",
      { event: "typing" },
      (msg: { payload?: { playerId?: string; ts?: number } }) => {
        const payload = msg?.payload;
        if (!payload || typeof payload.playerId !== "string") return;
        const ts =
          typeof payload.ts === "number" ? payload.ts : Date.now();
        seenRef.current.set(payload.playerId, ts);
      }
    );

    channel.subscribe();

    const interval = setInterval(() => {
      const cutoff = Date.now() - TYPING_EXPIRY_MS;
      const active: string[] = [];
      for (const [id, ts] of seenRef.current.entries()) {
        if (ts > cutoff) {
          active.push(id);
        } else {
          seenRef.current.delete(id);
        }
      }
      setTypingPlayerIds((prev) => {
        if (
          prev.length === active.length &&
          prev.every((id, i) => id === active[i])
        ) {
          return prev;
        }
        return active;
      });
    }, TICK_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [roomCode]);

  return { typingPlayerIds };
}
