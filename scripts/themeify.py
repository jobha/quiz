#!/usr/bin/env python3
"""One-shot helper: rewrite Tailwind zinc-* classes to light/dark pairs.

Run once after introducing dark mode. Idempotent-ish: skips classes that
already have a dark: variant immediately following.
"""
import re
import sys
from pathlib import Path

# Ordered list. Each entry: (pattern -> replacement).
# Hover variants come first to keep them stable when the base class
# substring would otherwise match inside them.
PAIRS = [
    (r"\bhover:bg-zinc-700\b", "hover:bg-zinc-300 dark:hover:bg-zinc-700"),
    (r"\bhover:bg-zinc-800\b", "hover:bg-zinc-200 dark:hover:bg-zinc-800"),
    (r"\bhover:border-zinc-600\b", "hover:border-zinc-400 dark:hover:border-zinc-600"),
    (r"\bhover:border-zinc-700\b", "hover:border-zinc-300 dark:hover:border-zinc-700"),
    (r"\bhover:text-zinc-100\b", "hover:text-zinc-900 dark:hover:text-zinc-100"),
    (r"\bhover:text-zinc-300\b", "hover:text-zinc-700 dark:hover:text-zinc-300"),
    (r"\bhover:text-zinc-200\b", "hover:text-zinc-800 dark:hover:text-zinc-200"),
    # Base classes. Use lookbehind/lookahead to avoid touching the strings
    # we just produced (which all begin with "dark:" or "hover:").
    (r"(?<![:\-A-Za-z])bg-zinc-950\b", "bg-zinc-50 dark:bg-zinc-950"),
    (r"(?<![:\-A-Za-z])bg-zinc-900\b", "bg-white dark:bg-zinc-900"),
    (r"(?<![:\-A-Za-z])bg-zinc-800\b", "bg-zinc-200 dark:bg-zinc-800"),
    (r"(?<![:\-A-Za-z])bg-zinc-700\b", "bg-zinc-300 dark:bg-zinc-700"),
    (r"(?<![:\-A-Za-z])border-zinc-800\b", "border-zinc-200 dark:border-zinc-800"),
    (r"(?<![:\-A-Za-z])border-zinc-700\b", "border-zinc-300 dark:border-zinc-700"),
    (r"(?<![:\-A-Za-z])border-zinc-600\b", "border-zinc-400 dark:border-zinc-600"),
    (r"(?<![:\-A-Za-z])text-zinc-400\b", "text-zinc-600 dark:text-zinc-400"),
    (r"(?<![:\-A-Za-z])text-zinc-300\b", "text-zinc-700 dark:text-zinc-300"),
    (r"(?<![:\-A-Za-z])text-zinc-200\b", "text-zinc-800 dark:text-zinc-200"),
    (r"(?<![:\-A-Za-z])text-zinc-100\b", "text-zinc-900 dark:text-zinc-100"),
    # text-zinc-500 stays put — it reads acceptably on both backgrounds.
]

def themeify(text: str) -> str:
    for pat, repl in PAIRS:
        text = re.sub(pat, repl, text)
    return text

def main(paths):
    for p in paths:
        path = Path(p)
        original = path.read_text()
        updated = themeify(original)
        if original != updated:
            path.write_text(updated)
            print(f"updated {path}")
        else:
            print(f"unchanged {path}")

if __name__ == "__main__":
    main(sys.argv[1:])
