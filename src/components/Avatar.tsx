"use client";

const PALETTE = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#06b6d4",
  "#84cc16",
];

function hashColor(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i++) {
    sum += name.charCodeAt(i);
  }
  const index = sum % PALETTE.length;
  return PALETTE[index] ?? PALETTE[0]!;
}

const SIZES = {
  sm: { box: 24, font: 14 },
  md: { box: 32, font: 18 },
  lg: { box: 48, font: 26 },
  xl: { box: 96, font: 52 },
} as const;

export function Avatar({
  emoji,
  color,
  name,
  size = "md",
}: {
  emoji: string | null;
  color: string | null;
  name?: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const dims = SIZES[size];
  const backgroundColor =
    color ?? (name && name.length > 0 ? hashColor(name) : "#d4d4d8");
  const initial =
    name && name.length > 0 ? name.charAt(0).toUpperCase() : "?";

  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white font-semibold select-none leading-none"
      style={{
        backgroundColor,
        width: `${dims.box}px`,
        height: `${dims.box}px`,
        fontSize: `${dims.font}px`,
      }}
      aria-label={name ?? "avatar"}
    >
      {emoji ? <span aria-hidden>{emoji}</span> : <span>{initial}</span>}
    </span>
  );
}
