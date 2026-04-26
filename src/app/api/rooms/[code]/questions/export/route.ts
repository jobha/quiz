import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { verifyHost } from "@/lib/host-auth";
import { normalizeRoomCode } from "@/lib/room-code";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = normalizeRoomCode(rawCode);
  const secret = req.headers.get("x-host-secret") ?? "";
  if (!(await verifyHost(code, secret))) {
    return new NextResponse("Ikke tillatt", { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("questions")
    .select(
      "type, prompt, correct_answer, correct_answers, choices, points, tolerance, image_url, audio_url",
    )
    .eq("room_code", code)
    .order("position");

  if (error) return new NextResponse(error.message, { status: 500 });

  const rows = data ?? [];
  return NextResponse.json(rows, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="quiz-${code}.json"`,
    },
  });
}
