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
    answer_id?: string;
    points_awarded?: number;
    is_correct?: boolean;
  } | null;
  const answerId = body?.answer_id;
  if (!answerId) return new NextResponse("Mangler svar-id", { status: 400 });

  const sb = supabaseAdmin();
  const { data: answer } = await sb
    .from("answers")
    .select("id, room_code, question_id")
    .eq("id", answerId)
    .maybeSingle();
  if (!answer || answer.room_code !== code) {
    return new NextResponse("Fant ikke svaret", { status: 404 });
  }

  const { data: question } = await sb
    .from("questions")
    .select("points")
    .eq("id", answer.question_id)
    .maybeSingle();
  if (!question) {
    return new NextResponse("Fant ikke spørsmålet", { status: 404 });
  }
  const max = question.points as number;

  let pointsAwarded: number;
  if (typeof body.points_awarded === "number" && Number.isFinite(body.points_awarded)) {
    pointsAwarded = Math.max(0, Math.min(max, Math.round(body.points_awarded)));
  } else if (typeof body.is_correct === "boolean") {
    pointsAwarded = body.is_correct ? max : 0;
  } else {
    return new NextResponse("Mangler felter", { status: 400 });
  }

  const { error } = await sb
    .from("answers")
    .update({
      points_awarded: pointsAwarded,
      is_correct: pointsAwarded > 0,
    })
    .eq("id", answerId)
    .eq("room_code", code);
  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ ok: true });
}
