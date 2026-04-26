import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { verifyHost } from "@/lib/host-auth";
import { normalizeRoomCode } from "@/lib/room-code";

const VALID_TYPES = new Set(["text", "choice", "numeric", "multi"]);

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
    type?: string;
    prompt?: string;
    correct_answer?: string;
    correct_answers?: string[] | null;
    choices?: string[] | null;
    points?: number;
    tolerance?: number | null;
    image_url?: string | null;
    audio_url?: string | null;
    round_name?: string | null;
  } | null;

  const type = body?.type;
  const prompt = body?.prompt?.trim();
  const correct = body?.correct_answer?.trim();
  const points = Number.isFinite(body?.points)
    ? Math.max(0.5, Math.min(100, body!.points!))
    : 1;
  const imageUrl =
    typeof body?.image_url === "string" && body.image_url.trim()
      ? body.image_url.trim()
      : null;
  const audioUrl =
    typeof body?.audio_url === "string" && body.audio_url.trim()
      ? body.audio_url.trim()
      : null;
  const roundName =
    typeof body?.round_name === "string" && body.round_name.trim()
      ? body.round_name.trim().slice(0, 80)
      : null;

  if (!type || !VALID_TYPES.has(type)) {
    return new NextResponse("Ugyldig type", { status: 400 });
  }
  if (!prompt) {
    return new NextResponse("Mangler spørsmålstekst", { status: 400 });
  }

  let choices: string[] | null = null;
  let correctAnswers: string[] | null = null;
  let tolerance: number | null = null;
  let canonicalCorrect = correct ?? "";

  if (type === "choice") {
    if (!correct) {
      return new NextResponse("Mangler riktig svar", { status: 400 });
    }
    choices = (body?.choices ?? []).map((s) => s.trim()).filter(Boolean);
    if (choices.length < 2) {
      return new NextResponse("Trenger minst to alternativer", { status: 400 });
    }
    if (!choices.includes(correct)) {
      return new NextResponse("Riktig svar må være ett av alternativene", {
        status: 400,
      });
    }
  } else if (type === "multi") {
    correctAnswers = (body?.correct_answers ?? [])
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean);
    if (correctAnswers.length < 1) {
      return new NextResponse(
        "Trenger minst ett gyldig svar for flere-svar-spørsmål",
        { status: 400 },
      );
    }
    canonicalCorrect = correctAnswers[0];
  } else if (type === "numeric") {
    if (!correct) {
      return new NextResponse("Mangler riktig svar", { status: 400 });
    }
    const n = parseFloat(correct);
    if (!Number.isFinite(n)) {
      return new NextResponse("Riktig svar må være et tall", { status: 400 });
    }
    if (
      body &&
      Object.prototype.hasOwnProperty.call(body, "tolerance") &&
      body.tolerance !== null
    ) {
      const t = Number(body.tolerance);
      if (!Number.isFinite(t) || t < 0) {
        return new NextResponse("Toleranse må være ≥ 0", { status: 400 });
      }
      tolerance = t;
    } else {
      tolerance = 0;
    }
  } else {
    // text
    if (!correct) {
      return new NextResponse("Mangler riktig svar", { status: 400 });
    }
  }

  const sb = supabaseAdmin();
  const { count } = await sb
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("room_code", code);

  const position = (count ?? 0) + 1;
  const { data, error } = await sb
    .from("questions")
    .insert({
      room_code: code,
      position,
      type,
      prompt,
      correct_answer: canonicalCorrect,
      correct_answers: correctAnswers,
      tolerance,
      choices,
      points,
      image_url: imageUrl,
      audio_url: audioUrl,
      round_name: roundName,
    })
    .select("id")
    .single();
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ id: data.id });
}
