import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { verifyHost } from "@/lib/host-auth";
import { normalizeRoomCode } from "@/lib/room-code";

// Swap a question's position with the one above or below it.
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
    direction?: "up" | "down";
  } | null;
  if (!body?.id || (body.direction !== "up" && body.direction !== "down")) {
    return new NextResponse("Mangler felter", { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: list } = await sb
    .from("questions")
    .select("id, position")
    .eq("room_code", code)
    .order("position");
  if (!list) return new NextResponse("Ingen spørsmål", { status: 404 });

  const idx = list.findIndex((q) => q.id === body.id);
  if (idx < 0) return new NextResponse("Fant ikke spørsmålet", { status: 404 });
  const swapWith = body.direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= list.length) {
    return NextResponse.json({ ok: true, noop: true });
  }

  const a = list[idx];
  const b = list[swapWith];

  // Two-step swap to dodge the unique-position constraint (if there ever
  // is one): park `a` at a sentinel, move `b`, then move `a` to `b.position`.
  const tmp = -1 - idx;
  const r1 = await sb
    .from("questions")
    .update({ position: tmp })
    .eq("id", a.id);
  if (r1.error) return new NextResponse(r1.error.message, { status: 500 });
  const r2 = await sb
    .from("questions")
    .update({ position: a.position })
    .eq("id", b.id);
  if (r2.error) return new NextResponse(r2.error.message, { status: 500 });
  const r3 = await sb
    .from("questions")
    .update({ position: b.position })
    .eq("id", a.id);
  if (r3.error) return new NextResponse(r3.error.message, { status: 500 });

  return NextResponse.json({ ok: true });
}
