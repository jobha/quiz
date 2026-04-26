"use client";
export function AudioClue({ src }: { src: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 p-2">
      <audio controls preload="metadata" src={src} className="w-full" />
    </div>
  );
}
