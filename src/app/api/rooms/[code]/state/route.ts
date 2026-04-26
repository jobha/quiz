import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { verifyHost } from "@/lib/host-auth";
import { normalizeRoomCode } from "@/lib/room-code";

const VALID_PHASES = new Set(["lobby", "asking", "revealed", "ended"]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = normalizeRoomCode(rawCode);
  const secret = req.headers.get("x-host-secret") ?? "";
  if (!(await verifyHost(code, secret))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    phase?: string;
    current_question_id?: string | null;
    show_scoreboard?: boolean;
    show_own_score?: boolean;
    show_history?: boolean;
    hide_rejoin_codes?: boolean;
    accent_color?: string | null;
  } | null;

  const update: Record<string, unknown> = {};
  if (body?.phase !== undefined) {
    if (!VALID_PHASES.has(body.phase)) {
      return new NextResponse("Invalid phase", { status: 400 });
    }
    update.phase = body.phase;
  }
  if (body && Object.prototype.hasOwnProperty.call(body, "current_question_id")) {
    update.current_question_id = body.current_question_id;
    // Auto-clear the spotlight when navigating to a different question;
    // the host can re-spotlight intentionally.
    update.spotlight_answer_id = null;
  }
  if (body && typeof body.show_scoreboard === "boolean") {
    update.show_scoreboard = body.show_scoreboard;
  }
  if (body && typeof body.show_own_score === "boolean") {
    update.show_own_score = body.show_own_score;
  }
  if (body && typeof body.show_history === "boolean") {
    update.show_history = body.show_history;
  }
  if (body && typeof body.hide_rejoin_codes === "boolean") {
    update.hide_rejoin_codes = body.hide_rejoin_codes;
  }
  if (body && Object.prototype.hasOwnProperty.call(body, "accent_color")) {
    const c = body.accent_color;
    if (c === null) {
      update.accent_color = null;
    } else if (typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)) {
      update.accent_color = c.toLowerCase();
    } else {
      return new NextResponse("Ugyldig farge", { status: 400 });
    }
  }
  if (Object.keys(update).length === 0) {
    return new NextResponse("Nothing to update", { status: 400 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb.from("rooms").update(update).eq("code", code);
  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ ok: true });
}
