"use client";

const DEFAULT_EMOJIS = ["👏", "😂", "🔥", "🤯", "❤️", "🎉"];

export function ReactionsBar({
  emojis = DEFAULT_EMOJIS,
  onReact,
  disabled = false,
}: {
  emojis?: string[];
  onReact: (emoji: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-2 flex-wrap justify-center">
      {emojis.map((emoji) => (
        <button
          key={emoji}
          type="button"
          disabled={disabled}
          onClick={() => onReact(emoji)}
          aria-label={`Send reaksjon ${emoji}`}
          className="w-10 h-10 text-2xl rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:scale-110 active:scale-95 transition-transform disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center leading-none"
        >
          <span aria-hidden>{emoji}</span>
        </button>
      ))}
    </div>
  );
}
