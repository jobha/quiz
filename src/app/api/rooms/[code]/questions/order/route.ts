import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { verifyHost } from "@/lib/host-auth";
import { normalizeRoomCode } from "@/lib/room-code";

// Atomic reorder via SQL function (single transaction → fewer flickery
// realtime events than N separate UPDATEs). Body: { order: string[] }
// — full list of question IDs in the new order.
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
  const { error } = await sb.rpc("reorder_questions_in_room", {
    p_room_code: code,
    p_ids: order,
  });
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ ok: true });
}
