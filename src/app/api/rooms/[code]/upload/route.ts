import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { verifyHost } from "@/lib/host-auth";
import { normalizeRoomCode } from "@/lib/room-code";

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/x-m4a",
  "audio/m4a",
]);
const MAX_BYTES = 10 * 1024 * 1024;

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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new NextResponse("Forventet multipart-form", { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return new NextResponse("Mangler fil", { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return new NextResponse("Ugyldig filtype", { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return new NextResponse("Bildet er for stort (maks 5 MB)", { status: 400 });
  }

  const ext = (file.name.split(".").pop() ?? "img").toLowerCase().slice(0, 5);
  const path = `${code}/${crypto.randomUUID()}.${ext}`;
  const buffer = await file.arrayBuffer();

  const sb = supabaseAdmin();
  const { error } = await sb.storage
    .from("questions")
    .upload(path, buffer, { contentType: file.type, upsert: false });
  if (error) {
    return new NextResponse(error.message, { status: 500 });
  }

  const { data } = sb.storage.from("questions").getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl, path });
}

// Allow up to 6MB request bodies (image + multipart overhead).
export const config = { api: { bodyParser: false } };
