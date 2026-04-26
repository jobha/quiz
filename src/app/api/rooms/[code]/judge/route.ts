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
    return new NextResponse("Forbidden", { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    answer_id?: string;
    is_correct?: boolean;
  } | null;
  const answerId = body?.answer_id;
  if (!answerId || typeof body?.is_correct !== "boolean") {
    return new NextResponse("Missing fields", { status: 400 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("answers")
    .update({ is_correct: body.is_correct })
    .eq("id", answerId)
    .eq("room_code", code);
  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ ok: true });
}
