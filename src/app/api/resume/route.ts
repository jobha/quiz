import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { normalizeRoomCode } from "@/lib/room-code";

// Look up a personal code globally and return the matching credentials.
// Codes are unique across all rooms so the user does not need to know
// which room they were in.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code ? normalizeRoomCode(body.code) : "";
  if (!code) return new NextResponse("Mangler kode", { status: 400 });

  const sb = supabaseAdmin();

  // Try host first.
  const { data: room } = await sb
    .from("rooms")
    .select("code, host_secret, host_rejoin_code")
    .eq("host_rejoin_code", code)
    .maybeSingle();
  if (room) {
    return NextResponse.json({
      type: "host",
      room_code: room.code,
      host_secret: room.host_secret,
    });
  }

  const { data: player } = await sb
    .from("players")
    .select("id, name, room_code")
    .eq("rejoin_code", code)
    .maybeSingle();
  if (player) {
    return NextResponse.json({
      type: "player",
      room_code: player.room_code,
      player_id: player.id,
      name: player.name,
    });
  }

  return new NextResponse("Ukjent kode", { status: 404 });
}
