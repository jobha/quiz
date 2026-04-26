import { supabaseAdmin } from "./supabase-server";

// Verifies that the provided host_secret matches the room's stored secret.
// Returns the room row when valid, otherwise null.
export async function verifyHost(roomCode: string, hostSecret: string) {
  if (!roomCode || !hostSecret) return null;
  const { data, error } = await supabaseAdmin()
    .from("rooms")
    .select("code, host_secret, phase, current_question_id, created_at")
    .eq("code", roomCode)
    .maybeSingle();
  if (error || !data) return null;
  if (data.host_secret !== hostSecret) return null;
  return data;
}
