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

  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  const id = body?.id;
  if (!id) return new NextResponse("Mangler id", { status: 400 });

  const sb = supabaseAdmin();

  // If we're about to delete the active question, drop it from the room
  // first so players don't get stuck on a missing question.
  await sb
    .from("rooms")
    .update({ current_question_id: null, phase: "lobby" })
    .eq("code", code)
    .eq("current_question_id", id);

  const { error } = await sb
    .from("questions")
    .delete()
    .eq("id", id)
    .eq("room_code", code);
  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ ok: true });
}
