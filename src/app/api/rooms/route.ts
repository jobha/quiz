import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { generateRoomCode } from "@/lib/room-code";

export async function POST() {
  const sb = supabaseAdmin();

  // Try a few times in the (very unlikely) event of a code collision.
  for (let i = 0; i < 5; i++) {
    const code = generateRoomCode(5);
    const hostRejoinCode = generateRoomCode(6);
    const { data, error } = await sb
      .from("rooms")
      .insert({ code, host_rejoin_code: hostRejoinCode })
      .select("code, host_secret, host_rejoin_code")
      .single();
    if (!error && data) {
      return NextResponse.json({
        code: data.code,
        host_secret: data.host_secret,
        host_rejoin_code: data.host_rejoin_code,
      });
    }
    if (error && error.code !== "23505") {
      return new NextResponse(error.message, { status: 500 });
    }
  }
  return new NextResponse("Could not allocate room code", { status: 500 });
}
