import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { verifyHost } from "@/lib/host-auth";
import { normalizeRoomCode } from "@/lib/room-code";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = normalizeRoomCode(rawCode);
  const secret = req.headers.get("x-host-secret") ?? "";
  if (!(await verifyHost(code, secret))) {
    return new NextResponse("Ikke tillatt", { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    player_id?: string;
    points?: number;
    reason?: string | null;
  } | null;

  const playerId = body?.player_id;
  if (!playerId) {
    return new NextResponse("Mangler spiller-id", { status: 400 });
  }
  if (typeof body?.points !== "number" || !Number.isFinite(body.points)) {
    return new NextResponse("Ugyldig poengsum", { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: player } = await sb
    .from("players")
    .select("id, room_code")
    .eq("id", playerId)
    .eq("room_code", code)
    .maybeSingle();
  if (!player) {
    return new NextResponse("Ukjent spiller", { status: 400 });
  }

  const HARD_CAP = 999;
  const clamped = Math.max(-HARD_CAP, Math.min(HARD_CAP, body.points));
  const points = Math.round(clamped * 2) / 2;

  let reason: string | null = null;
  if (typeof body.reason === "string") {
    const trimmed = body.reason.trim();
    reason = trimmed.length > 0 ? trimmed : null;
  }

  const { data, error } = await sb
    .from("bonus_points")
    .insert({
      room_code: code,
      player_id: playerId,
      points,
      reason,
    })
    .select("id")
    .single();
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ id: data.id });
}
