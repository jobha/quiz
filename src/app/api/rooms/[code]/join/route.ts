import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { generateRoomCode, normalizeRoomCode } from "@/lib/room-code";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = normalizeRoomCode(rawCode);
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    avatar_emoji?: string | null;
    avatar_color?: string | null;
  } | null;
  const name = body?.name?.trim();
  if (!name) return new NextResponse("Navn må fylles inn", { status: 400 });
  if (name.length > 40)
    return new NextResponse("Navnet er for langt", { status: 400 });

  const emoji =
    typeof body?.avatar_emoji === "string" && body.avatar_emoji.trim()
      ? body.avatar_emoji.trim().slice(0, 8)
      : null;
  const color =
    typeof body?.avatar_color === "string" &&
    /^#[0-9a-fA-F]{6}$/.test(body.avatar_color)
      ? body.avatar_color.toLowerCase()
      : null;

  const sb = supabaseAdmin();
  const { data: room } = await sb
    .from("rooms")
    .select("code")
    .eq("code", code)
    .maybeSingle();
  if (!room) return new NextResponse("Fant ikke rommet", { status: 404 });

  for (let i = 0; i < 10; i++) {
    const rejoinCode = generateRoomCode(6);
    const { data, error } = await sb
      .from("players")
      .insert({
        room_code: code,
        name,
        rejoin_code: rejoinCode,
        avatar_emoji: emoji,
        avatar_color: color,
      })
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
  return new NextResponse("Kunne ikke generere kode", { status: 500 });
}
