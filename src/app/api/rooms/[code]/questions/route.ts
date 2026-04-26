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
    type?: "text" | "choice";
    prompt?: string;
    correct_answer?: string;
    choices?: string[] | null;
    points?: number;
    image_url?: string | null;
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

  if (!type || (type !== "text" && type !== "choice")) {
    return new NextResponse("Ugyldig type", { status: 400 });
  }
  if (!prompt || !correct) {
    return new NextResponse("Mangler spørsmål eller riktig svar", {
      status: 400,
    });
  }

  let choices: string[] | null = null;
  if (type === "choice") {
    choices = (body?.choices ?? []).map((s) => s.trim()).filter(Boolean);
    if (choices.length < 2) {
      return new NextResponse("Trenger minst to alternativer", { status: 400 });
    }
    if (!choices.includes(correct)) {
      return new NextResponse("Riktig svar må være ett av alternativene", {
        status: 400,
      });
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
      correct_answer: correct,
      choices,
      points,
      image_url: imageUrl,
    })
    .select("id")
    .single();
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ id: data.id });
}
