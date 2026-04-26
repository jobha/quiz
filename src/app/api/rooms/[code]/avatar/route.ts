import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { normalizeRoomCode } from "@/lib/room-code";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = normalizeRoomCode(rawCode);

  const body = (await req.json().catch(() => null)) as {
    player_id?: string;
    emoji?: string | null;
    color?: string | null;
  } | null;

  const playerId = body?.player_id;
  if (!playerId) {
    return new NextResponse("Mangler spiller-id", { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: player } = await sb
    .from("players")
    .select("id")
    .eq("id", playerId)
    .eq("room_code", code)
    .maybeSingle();
  if (!player) {
    return new NextResponse("Ukjent spiller", { status: 404 });
  }

  const update: Record<string, unknown> = {};

  if (body && Object.prototype.hasOwnProperty.call(body, "emoji")) {
    const e = body.emoji;
    if (e === null) {
      update.emoji = null;
    } else if (typeof e === "string") {
      const trimmed = e.trim();
      if (trimmed.length === 0) {
        update.emoji = null;
      } else {
        const codepoints = Array.from(trimmed);
        if (codepoints.length < 1 || codepoints.length > 8) {
          return new NextResponse("Ugyldig emoji", { status: 400 });
        }
        update.emoji = trimmed;
      }
    } else {
      return new NextResponse("Ugyldig emoji", { status: 400 });
    }
  }

  if (body && Object.prototype.hasOwnProperty.call(body, "color")) {
    const c = body.color;
    if (c === null) {
      update.color = null;
    } else if (typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)) {
      update.color = c.toLowerCase();
    } else {
      return new NextResponse("Ugyldig farge", { status: 400 });
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await sb
    .from("players")
    .update(update)
    .eq("id", playerId)
    .eq("room_code", code);
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ ok: true });
}
