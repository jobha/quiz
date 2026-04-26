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
    rejoin_code?: string;
  } | null;
  const rejoinCode = body?.rejoin_code
    ? normalizeRoomCode(body.rejoin_code)
    : "";
  if (!rejoinCode) {
    return new NextResponse("Missing rejoin code", { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("players")
    .select("id, name")
    .eq("room_code", code)
    .eq("rejoin_code", rejoinCode)
    .maybeSingle();
  if (error) return new NextResponse(error.message, { status: 500 });
  if (!data) return new NextResponse("Code not recognised", { status: 404 });

  return NextResponse.json({ player_id: data.id, name: data.name });
}
