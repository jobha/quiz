import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { normalizeRoomCode } from "@/lib/room-code";
import type { Question } from "@/lib/types";

function looseEquals(a: string, b: string): boolean {
  return normalizeText(a) === normalizeText(b);
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

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
  if (!room) return new NextResponse("Fant ikke rommet", { status: 404 });
  if (room.phase === "ended") {
    return new NextResponse("Quizen er ferdig", { status: 409 });
  }
  if (room.current_question_id !== questionId) {
    return new NextResponse("Spørsmålet er ikke aktivt", { status: 409 });
  }

  const { data: question } = await sb
    .from("questions")
    .select(
      "id, type, correct_answer, choices, points, tolerance, correct_answers, revealed",
    )
    .eq("id", questionId)
    .maybeSingle();
  if (!question) return new NextResponse("Fant ikke spørsmålet", { status: 404 });
  const q = question as Pick<
    Question,
    | "id"
    | "type"
    | "correct_answer"
    | "choices"
    | "points"
    | "tolerance"
    | "correct_answers"
    | "revealed"
  >;
  if (q.revealed) {
    return new NextResponse("Spørsmålet er allerede avslørt", { status: 409 });
  }

  // Auto-grade where possible; otherwise leave for host to judge.
  let isCorrect: boolean | null = null;
  let pointsAwarded: number | null = null;
  if (q.type === "choice") {
    const correct = answerText === q.correct_answer;
    isCorrect = correct;
    pointsAwarded = correct ? q.points : 0;
  } else if (q.type === "numeric") {
    const guess = parseFloat(answerText);
    const target = parseFloat(q.correct_answer);
    if (Number.isFinite(guess) && Number.isFinite(target)) {
      const tol = typeof q.tolerance === "number" ? q.tolerance : 0;
      const within = Math.abs(guess - target) <= tol;
      isCorrect = within;
      pointsAwarded = within ? q.points : 0;
    }
  } else if (q.type === "text") {
    // Loose-match free text: award full points on a normalized hit.
    // Misses stay null so the host can still award partial credit.
    if (looseEquals(answerText, q.correct_answer)) {
      isCorrect = true;
      pointsAwarded = q.points;
    }
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
