import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { verifyHost } from "@/lib/host-auth";
import { normalizeRoomCode } from "@/lib/room-code";

type QuestionType = "text" | "choice" | "numeric" | "multi";

type ImportItem = {
  type: QuestionType;
  prompt: string;
  correct_answer: string;
  correct_answers?: string[] | null;
  choices?: string[] | null;
  points?: number;
  tolerance?: number | null;
  image_url?: string | null;
  audio_url?: string | null;
};

type Row = {
  room_code: string;
  position: number;
  type: QuestionType;
  prompt: string;
  correct_answer: string;
  correct_answers: string[] | null;
  choices: string[] | null;
  points: number;
  tolerance: number | null;
  image_url: string | null;
  audio_url: string | null;
};

function clampPoints(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.max(0.5, Math.min(100, v));
}

function validateItem(
  item: unknown,
  lineHint: string,
): { ok: true; value: Omit<Row, "room_code" | "position"> } | { ok: false; error: string } {
  if (!item || typeof item !== "object") {
    return { ok: false, error: `${lineHint}: ugyldig oppføring` };
  }
  const o = item as Record<string, unknown>;

  const type = o.type;
  if (
    type !== "text" &&
    type !== "choice" &&
    type !== "numeric" &&
    type !== "multi"
  ) {
    return { ok: false, error: `${lineHint}: ugyldig type` };
  }

  const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
  if (!prompt) {
    return { ok: false, error: `${lineHint}: mangler spørsmål` };
  }

  const correctRaw =
    typeof o.correct_answer === "string" ? o.correct_answer.trim() : "";

  let choices: string[] | null = null;
  if (Array.isArray(o.choices)) {
    choices = o.choices
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean);
    if (choices.length === 0) choices = null;
  } else if (o.choices === null) {
    choices = null;
  }

  let correct_answers: string[] | null = null;
  if (Array.isArray(o.correct_answers)) {
    correct_answers = o.correct_answers
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean);
    if (correct_answers.length === 0) correct_answers = null;
  } else if (o.correct_answers === null) {
    correct_answers = null;
  }

  if (type === "choice") {
    if (!choices || choices.length < 2) {
      return { ok: false, error: `${lineHint}: trenger minst to alternativer` };
    }
    if (!correctRaw || !choices.includes(correctRaw)) {
      return {
        ok: false,
        error: `${lineHint}: riktig svar må være ett av alternativene`,
      };
    }
  } else if (type === "multi") {
    if (!correct_answers || correct_answers.length < 1) {
      return { ok: false, error: `${lineHint}: trenger minst ett riktig svar` };
    }
  } else if (type === "numeric") {
    const n = Number(correctRaw);
    if (!Number.isFinite(n)) {
      return { ok: false, error: `${lineHint}: riktig svar må være et tall` };
    }
  } else {
    if (!correctRaw) {
      return { ok: false, error: `${lineHint}: mangler riktig svar` };
    }
  }

  let tolerance: number | null = null;
  if (o.tolerance !== undefined && o.tolerance !== null && o.tolerance !== "") {
    const t = typeof o.tolerance === "number" ? o.tolerance : Number(o.tolerance);
    if (!Number.isFinite(t) || t < 0) {
      return { ok: false, error: `${lineHint}: toleranse må være ≥ 0` };
    }
    tolerance = t;
  }

  const points = clampPoints(o.points);

  const image_url =
    typeof o.image_url === "string" && o.image_url.trim()
      ? o.image_url.trim()
      : null;
  const audio_url =
    typeof o.audio_url === "string" && o.audio_url.trim()
      ? o.audio_url.trim()
      : null;

  return {
    ok: true,
    value: {
      type,
      prompt,
      correct_answer: correctRaw,
      correct_answers,
      choices,
      points,
      tolerance,
      image_url,
      audio_url,
    },
  };
}

function parseCsv(text: string): string[][] {
  // Returns an array of rows; each row is an array of fields.
  // Supports quoted fields with `"` and escaped `""`.
  // Comment lines (starting with `#`, ignoring leading whitespace) are skipped.
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  let lineStart = true;

  const pushField = () => {
    cur.push(field);
    field = "";
  };
  const pushRow = () => {
    rows.push(cur);
    cur = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (lineStart && !inQuotes) {
      // Skip whitespace at the very start of a logical line.
      let j = i;
      while (j < text.length && (text[j] === " " || text[j] === "\t")) j++;
      if (text[j] === "#") {
        // Comment line — skip until newline.
        while (j < text.length && text[j] !== "\n") j++;
        if (text[j] === "\n") j++;
        i = j;
        lineStart = true;
        continue;
      }
      lineStart = false;
    }

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      pushField();
      pushRow();
      lineStart = true;
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  // Flush trailing field/row if any content present.
  if (field.length > 0 || cur.length > 0) {
    pushField();
    pushRow();
  }

  // Drop empty rows (rows with a single empty field).
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

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
    format?: "csv" | "json";
    data?: string;
  } | null;

  const format = body?.format;
  const data = body?.data;
  if ((format !== "csv" && format !== "json") || typeof data !== "string") {
    return new NextResponse("Ugyldig forespørsel", { status: 400 });
  }

  const items: Omit<Row, "room_code" | "position">[] = [];

  if (format === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return new NextResponse("Ugyldig JSON", { status: 400 });
    }
    if (!Array.isArray(parsed)) {
      return new NextResponse("JSON må være en liste", { status: 400 });
    }
    for (let i = 0; i < parsed.length; i++) {
      const res = validateItem(parsed[i], `Element ${i + 1}`);
      if (!res.ok) return new NextResponse(res.error, { status: 400 });
      items.push(res.value);
    }
  } else {
    const rows = parseCsv(data);
    if (rows.length === 0) {
      return new NextResponse("Tom CSV", { status: 400 });
    }
    const header = rows[0].map((s) => s.trim().toLowerCase());
    const required = ["type", "prompt", "correct_answer", "points"];
    for (const r of required) {
      if (!header.includes(r)) {
        return new NextResponse(`Mangler kolonne: ${r}`, { status: 400 });
      }
    }
    const idx = (name: string) => header.indexOf(name);
    const iType = idx("type");
    const iPrompt = idx("prompt");
    const iCorrect = idx("correct_answer");
    const iPoints = idx("points");
    const iChoices = idx("choices");
    const iCorrectMulti = idx("correct_answers");
    const iTolerance = idx("tolerance");
    const iImage = idx("image_url");
    const iAudio = idx("audio_url");

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const lineHint = `Linje ${r + 1}`;
      const get = (i: number) => (i >= 0 && i < row.length ? row[i] : "");
      const splitPipe = (s: string): string[] | null => {
        const v = s.trim();
        if (!v) return null;
        const parts = v
          .split("|")
          .map((p) => p.trim())
          .filter(Boolean);
        return parts.length > 0 ? parts : null;
      };

      const item: Record<string, unknown> = {
        type: get(iType).trim(),
        prompt: get(iPrompt),
        correct_answer: get(iCorrect),
        points: get(iPoints).trim() === "" ? 1 : Number(get(iPoints)),
      };
      if (iChoices >= 0) item.choices = splitPipe(get(iChoices));
      if (iCorrectMulti >= 0) item.correct_answers = splitPipe(get(iCorrectMulti));
      if (iTolerance >= 0) {
        const t = get(iTolerance).trim();
        item.tolerance = t === "" ? null : Number(t);
      }
      if (iImage >= 0) {
        const v = get(iImage).trim();
        item.image_url = v === "" ? null : v;
      }
      if (iAudio >= 0) {
        const v = get(iAudio).trim();
        item.audio_url = v === "" ? null : v;
      }

      const res = validateItem(item, lineHint);
      if (!res.ok) return new NextResponse(res.error, { status: 400 });
      items.push(res.value);
    }
  }

  if (items.length === 0) {
    return NextResponse.json({ inserted: 0 });
  }

  const sb = supabaseAdmin();
  const { count } = await sb
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("room_code", code);
  const base = count ?? 0;

  const insertRows: Row[] = items.map((it, i) => ({
    room_code: code,
    position: base + 1 + i,
    type: it.type,
    prompt: it.prompt,
    correct_answer: it.correct_answer,
    correct_answers: it.correct_answers ?? null,
    choices: it.choices ?? null,
    points: it.points ?? 1,
    tolerance: it.tolerance ?? null,
    image_url: it.image_url ?? null,
    audio_url: it.audio_url ?? null,
  }));

  const { error } = await sb.from("questions").insert(insertRows);
  if (error) return new NextResponse(error.message, { status: 500 });

  return NextResponse.json({ inserted: insertRows.length });
}
