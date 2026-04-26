import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { normalizeRoomCode } from "@/lib/room-code";

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

  const { data, error } = await sb
    .from("players")
    .insert({ room_code: code, name })
    .select("id")
    .single();
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ player_id: data.id });
}
