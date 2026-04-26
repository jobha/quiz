import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { normalizeRoomCode } from "@/lib/room-code";

// Unified resume endpoint. Given a 4-char code, figures out whether it's
// a player rejoin code or the host code for this room, and returns the
// matching credential.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const roomCode = normalizeRoomCode(rawCode);
  const body = (await req.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code ? normalizeRoomCode(body.code) : "";
  if (!roomCode || !code) {
    return new NextResponse("Mangler kode", { status: 400 });
  }

  const sb = supabaseAdmin();

  // Try host first.
  const { data: room } = await sb
    .from("rooms")
    .select("code, host_secret, host_rejoin_code")
    .eq("code", roomCode)
    .maybeSingle();
  if (!room) return new NextResponse("Fant ikke rommet", { status: 404 });
  if (room.host_rejoin_code === code) {
    return NextResponse.json({ type: "host", host_secret: room.host_secret });
  }

  // Then player.
  const { data: player } = await sb
    .from("players")
    .select("id, name")
    .eq("room_code", roomCode)
    .eq("rejoin_code", code)
    .maybeSingle();
  if (player) {
    return NextResponse.json({
      type: "player",
      player_id: player.id,
      name: player.name,
    });
  }

  return new NextResponse("Ukjent kode", { status: 404 });
}
