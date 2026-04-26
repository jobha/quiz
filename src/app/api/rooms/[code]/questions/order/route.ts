import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { verifyHost } from "@/lib/host-auth";
import { normalizeRoomCode } from "@/lib/room-code";

// Reorder all questions in one go. Body: { order: string[] } — full
// list of question IDs in the new order.
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
    order?: string[];
  } | null;
  const order = Array.isArray(body?.order) ? body!.order! : null;
  if (!order || order.some((x) => typeof x !== "string")) {
    return new NextResponse("Mangler 'order'", { status: 400 });
  }

  const sb = supabaseAdmin();

  // Two-pass to avoid the unique-position constraint (if any) and to keep
  // numbering tight: park everything at negative positions, then write
  // final positions.
  for (let i = 0; i < order.length; i++) {
    const r = await sb
      .from("questions")
      .update({ position: -1 - i })
      .eq("id", order[i])
      .eq("room_code", code);
    if (r.error) return new NextResponse(r.error.message, { status: 500 });
  }
  for (let i = 0; i < order.length; i++) {
    const r = await sb
      .from("questions")
      .update({ position: i + 1 })
      .eq("id", order[i])
      .eq("room_code", code);
    if (r.error) return new NextResponse(r.error.message, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
