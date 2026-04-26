import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { generateRoomCode, normalizeRoomCode } from "@/lib/room-code";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = normalizeRoomCode(rawCode);
  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim();
  if (!name) return new NextResponse("Name is required", { status: 400 });
  if (name.length > 40)
    return new NextResponse("Name too long", { status: 400 });

  const sb = supabaseAdmin();
  const { data: room } = await sb
    .from("rooms")
    .select("code")
    .eq("code", code)
    .maybeSingle();
  if (!room) return new NextResponse("Room not found", { status: 404 });

  // Generate a unique 4-char rejoin code within this room.
  for (let i = 0; i < 10; i++) {
    const rejoinCode = generateRoomCode(4);
    const { data, error } = await sb
      .from("players")
      .insert({ room_code: code, name, rejoin_code: rejoinCode })
      .select("id, rejoin_code")
      .single();
    if (!error && data) {
      return NextResponse.json({
        player_id: data.id,
        rejoin_code: data.rejoin_code,
      });
    }
    if (error && error.code !== "23505") {
      return new NextResponse(error.message, { status: 500 });
    }
  }
  return new NextResponse("Could not allocate rejoin code", { status: 500 });
}
