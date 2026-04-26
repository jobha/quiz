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

  const body = (await req.json().catch(() => null)) as {
    answer_id?: string | null;
  } | null;

  if (!body || !Object.prototype.hasOwnProperty.call(body, "answer_id")) {
    return new NextResponse("Mangler svar-id", { status: 400 });
  }

  const sb = supabaseAdmin();
  const answerId = body.answer_id;

  if (answerId === null) {
    const { error } = await sb
      .from("rooms")
      .update({ spotlight_answer_id: null })
      .eq("code", code);
    if (error) return new NextResponse(error.message, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (typeof answerId !== "string" || !answerId) {
    return new NextResponse("Ugyldig svar-id", { status: 400 });
  }

  const { data: answer } = await sb
    .from("answers")
    .select("id, room_code")
    .eq("id", answerId)
    .maybeSingle();
  if (!answer || answer.room_code !== code) {
    return new NextResponse("Fant ikke svaret", { status: 404 });
  }

  const { error } = await sb
    .from("rooms")
    .update({ spotlight_answer_id: answerId })
    .eq("code", code);
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ ok: true });
}
