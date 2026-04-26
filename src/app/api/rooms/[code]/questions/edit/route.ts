import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { verifyHost } from "@/lib/host-auth";
import { normalizeRoomCode } from "@/lib/room-code";

type QuestionType = "text" | "choice" | "numeric" | "multi";

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
    id?: string;
    prompt?: string;
    type?: QuestionType;
    correct_answer?: string;
    correct_answers?: string[] | null;
    choices?: string[] | null;
    points?: number;
    tolerance?: number | null;
    image_url?: string | null;
    audio_url?: string | null;
  } | null;

  const id = body?.id;
  if (!id) return new NextResponse("Mangler id", { status: 400 });

  const update: Record<string, unknown> = {};

  // We need the effective type to validate dependent fields. If the caller
  // is changing type, we use the new type; otherwise we read the current
  // value to validate against.
  const sb = supabaseAdmin();

  let effectiveType: QuestionType | undefined = body?.type;
  let effectiveChoices: string[] | null | undefined =
    body?.choices === undefined ? undefined : body?.choices;
  let effectiveCorrect: string | undefined = body?.correct_answer;
  let effectiveCorrectMulti: string[] | null | undefined =
    body?.correct_answers === undefined ? undefined : body?.correct_answers;

  const needsExisting =
    effectiveType === undefined ||
    (effectiveType === "choice" &&
      (effectiveChoices === undefined || effectiveCorrect === undefined)) ||
    (effectiveType === "multi" && effectiveCorrectMulti === undefined) ||
    (effectiveType === "numeric" && effectiveCorrect === undefined);

  if (needsExisting) {
    const { data: existing, error: exErr } = await sb
      .from("questions")
      .select("type, choices, correct_answer, correct_answers")
      .eq("id", id)
      .eq("room_code", code)
      .single();
    if (exErr || !existing) {
      return new NextResponse("Fant ikke spørsmålet", { status: 404 });
    }
    if (effectiveType === undefined) {
      effectiveType = existing.type as QuestionType;
    }
    if (effectiveChoices === undefined) {
      effectiveChoices = (existing.choices as string[] | null) ?? null;
    }
    if (effectiveCorrect === undefined) {
      effectiveCorrect = (existing.correct_answer as string | null) ?? "";
    }
    if (effectiveCorrectMulti === undefined) {
      effectiveCorrectMulti =
        (existing.correct_answers as string[] | null) ?? null;
    }
  }

  if (
    effectiveType !== "text" &&
    effectiveType !== "choice" &&
    effectiveType !== "numeric" &&
    effectiveType !== "multi"
  ) {
    return new NextResponse("Ugyldig type", { status: 400 });
  }

  if (body?.type !== undefined) update.type = body.type;

  if (body?.prompt !== undefined) {
    const prompt = body.prompt.trim();
    if (!prompt) {
      return new NextResponse("Mangler spørsmål", { status: 400 });
    }
    update.prompt = prompt;
  }

  if (effectiveType === "choice") {
    const choices = (effectiveChoices ?? [])
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean);
    if (choices.length < 2) {
      return new NextResponse("Trenger minst to alternativer", { status: 400 });
    }
    const correct = (effectiveCorrect ?? "").trim();
    if (!correct || !choices.includes(correct)) {
      return new NextResponse("Riktig svar må være ett av alternativene", {
        status: 400,
      });
    }
    if (body?.choices !== undefined) update.choices = choices;
    if (body?.correct_answer !== undefined) update.correct_answer = correct;
  } else if (effectiveType === "multi") {
    const arr = Array.isArray(effectiveCorrectMulti)
      ? effectiveCorrectMulti
          .map((s) => (typeof s === "string" ? s.trim() : ""))
          .filter(Boolean)
      : [];
    if (arr.length < 1) {
      return new NextResponse("Trenger minst ett riktig svar", { status: 400 });
    }
    if (body?.correct_answers !== undefined) update.correct_answers = arr;
    if (body?.choices !== undefined) update.choices = body.choices;
  } else if (effectiveType === "numeric") {
    const n = Number((effectiveCorrect ?? "").toString().trim());
    if (!Number.isFinite(n)) {
      return new NextResponse("Riktig svar må være et tall", { status: 400 });
    }
    if (body?.correct_answer !== undefined) {
      update.correct_answer = String(n);
    }
    if (body?.tolerance !== undefined) {
      if (body.tolerance === null) {
        update.tolerance = null;
      } else {
        const t = Number(body.tolerance);
        if (!Number.isFinite(t) || t < 0) {
          return new NextResponse("Toleranse må være ≥ 0", { status: 400 });
        }
        update.tolerance = t;
      }
    }
  } else if (effectiveType === "text") {
    if (body?.correct_answer !== undefined) {
      const correct = body.correct_answer.trim();
      if (!correct) {
        return new NextResponse("Mangler riktig svar", { status: 400 });
      }
      update.correct_answer = correct;
    }
  }

  if (body?.points !== undefined) {
    if (!Number.isFinite(body.points)) {
      return new NextResponse("Ugyldig poengsum", { status: 400 });
    }
    update.points = Math.max(0.5, Math.min(100, body.points));
  }

  if (body?.image_url !== undefined) {
    update.image_url =
      typeof body.image_url === "string" && body.image_url.trim()
        ? body.image_url.trim()
        : null;
  }

  if (body?.audio_url !== undefined) {
    update.audio_url =
      typeof body.audio_url === "string" && body.audio_url.trim()
        ? body.audio_url.trim()
        : null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await sb
    .from("questions")
    .update(update)
    .eq("id", id)
    .eq("room_code", code);
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ ok: true });
}
