import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { verifyHost } from "@/lib/host-auth";
import { normalizeRoomCode } from "@/lib/room-code";

// Set a question's `revealed` flag. Reveal status is per-question so
// navigating between questions doesn't mutate it.
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
    revealed?: boolean;
  } | null;
  if (!body?.id || typeof body.revealed !== "boolean") {
    return new NextResponse("Mangler felter", { status: 400 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("questions")
    .update({ revealed: body.revealed })
    .eq("id", body.id)
    .eq("room_code", code);
  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ ok: true });
}
