import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { normalizeRoomCode } from "@/lib/room-code";
import type { Question } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = normalizeRoomCode(rawCode);
  const body = (await req.json().catch(() => null)) as {
    player_id?: string;
    question_id?: string;
    answer?: string;
  } | null;
  const playerId = body?.player_id;
  const questionId = body?.question_id;
  const answerText = body?.answer?.trim();
  if (!playerId || !questionId || !answerText) {
    return new NextResponse("Missing fields", { status: 400 });
  }

  const sb = supabaseAdmin();

  // Verify player belongs to room.
  const { data: player } = await sb
    .from("players")
    .select("id, room_code")
    .eq("id", playerId)
    .maybeSingle();
  if (!player || player.room_code !== code) {
    return new NextResponse("Unknown player", { status: 403 });
  }

  // Verify the room is asking, and the question matches the current one.
  const { data: room } = await sb
    .from("rooms")
    .select("phase, current_question_id")
    .eq("code", code)
    .maybeSingle();
  if (!room) return new NextResponse("Room not found", { status: 404 });
  if (room.phase !== "asking") {
    return new NextResponse("Not accepting answers", { status: 409 });
  }
  if (room.current_question_id !== questionId) {
    return new NextResponse("Question not active", { status: 409 });
  }

  const { data: question } = await sb
    .from("questions")
    .select("id, type, correct_answer, choices, points")
    .eq("id", questionId)
    .maybeSingle();
  if (!question) return new NextResponse("Fant ikke spørsmålet", { status: 404 });
  const q = question as Pick<
    Question,
    "id" | "type" | "correct_answer" | "choices" | "points"
  >;

  // Multiple-choice is auto-graded. Free text is left unjudged — the
  // host marks it during reveal (or anytime).
  let isCorrect: boolean | null = null;
  let pointsAwarded: number | null = null;
  if (q.type === "choice") {
    const correct = answerText === q.correct_answer;
    isCorrect = correct;
    pointsAwarded = correct ? q.points : 0;
  }

  const { error } = await sb
    .from("answers")
    .upsert(
      {
        room_code: code,
        question_id: questionId,
        player_id: playerId,
        answer: answerText,
        is_correct: isCorrect,
        points_awarded: pointsAwarded,
      },
      { onConflict: "question_id,player_id" },
    );
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ ok: true });
}
