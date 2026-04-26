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
    host_rejoin_code?: string;
  } | null;
  const rejoinCode = body?.host_rejoin_code
    ? normalizeRoomCode(body.host_rejoin_code)
    : "";
  if (!rejoinCode) {
    return new NextResponse("Missing host code", { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("rooms")
    .select("code, host_secret, host_rejoin_code")
    .eq("code", code)
    .maybeSingle();
  if (error) return new NextResponse(error.message, { status: 500 });
  if (!data || data.host_rejoin_code !== rejoinCode) {
    return new NextResponse("Code not recognised", { status: 404 });
  }

  return NextResponse.json({ host_secret: data.host_secret });
}
