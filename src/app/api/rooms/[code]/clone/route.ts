import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { verifyHost } from "@/lib/host-auth";
import { generateRoomCode, normalizeRoomCode } from "@/lib/room-code";

// Creates a new room and copies all questions from the source room.
// Returns the new room's code + host secret. Caller must have host
// access to the SOURCE room.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const sourceCode = normalizeRoomCode(rawCode);
  const secret = req.headers.get("x-host-secret") ?? "";
  if (!(await verifyHost(sourceCode, secret))) {
    return new NextResponse("Ikke tillatt", { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data: sourceQuestions } = await sb
    .from("questions")
    .select("type, prompt, choices, correct_answer, points, image_url, position")
    .eq("room_code", sourceCode)
    .order("position");

  // Allocate a new room code.
  let newCode: string | null = null;
  let newSecret: string | null = null;
  let newRejoin: string | null = null;
  for (let i = 0; i < 5; i++) {
    const candidate = generateRoomCode(5);
    const rejoin = generateRoomCode(6);
    const { data, error } = await sb
      .from("rooms")
      .insert({ code: candidate, host_rejoin_code: rejoin })
      .select("code, host_secret, host_rejoin_code")
      .single();
    if (!error && data) {
      newCode = data.code;
      newSecret = data.host_secret as string;
      newRejoin = data.host_rejoin_code as string;
      break;
    }
    if (error && error.code !== "23505") {
      return new NextResponse(error.message, { status: 500 });
    }
  }
  if (!newCode || !newSecret) {
    return new NextResponse("Klarte ikke å lage rom", { status: 500 });
  }

  if (sourceQuestions && sourceQuestions.length > 0) {
    const rows = sourceQuestions.map((q, i) => ({
      room_code: newCode!,
      type: q.type,
      prompt: q.prompt,
      choices: q.choices,
      correct_answer: q.correct_answer,
      points: q.points,
      image_url: q.image_url,
      position: i + 1,
    }));
    const { error } = await sb.from("questions").insert(rows);
    if (error) return new NextResponse(error.message, { status: 500 });
  }

  return NextResponse.json({
    code: newCode,
    host_secret: newSecret,
    host_rejoin_code: newRejoin,
  });
}
