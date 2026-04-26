"use client";
import * as React from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Question } from "@/lib/types";

export type RoundChange = { id: string; round_name: string | null };

export type QuestionListWithRoundsProps = {
  questions: Question[];
  currentId: string | null;
  busyId: string | null;
  editingId: string | null;
  answerCount: (questionId: string) => number;
  playerCount: number;
  renderRow: (q: Question, globalIndex: number) => React.ReactNode;
  onChange: (orderedIds: string[], roundChanges: RoundChange[]) => void;
};

type Item =
  | { kind: "header"; id: string; name: string }
  | { kind: "question"; id: string; q: Question };

function normalize(name: string | null | undefined): string {
  return (name ?? "").trim();
}

/** Build the initial Item list from server-current questions. */
function buildItemsFromQuestions(questions: Question[]): Item[] {
  const items: Item[] = [];
  let prev: string | null = null;
  let headerCounter = 0;
  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    const cur = normalize(q.round_name);
    const curOrNull = cur.length === 0 ? null : cur;
    const prevOrNull = prev; // already normalized to non-empty or null
    const needHeader =
      i === 0
        ? curOrNull !== null
        : curOrNull !== prevOrNull;
    if (needHeader) {
      items.push({
        kind: "header",
        id: `header:${headerCounter++}`,
        name: cur,
      });
    }
    items.push({ kind: "question", id: q.id, q });
    prev = curOrNull;
  }
  return items;
}

function computeRoundAssignments(items: Item[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  let current: string | null = null;
  for (const it of items) {
    if (it.kind === "header") {
      current = it.name.trim().length === 0 ? null : it.name.trim();
    } else {
      out.set(it.id, current);
    }
  }
  return out;
}

function questionIdsOf(items: Item[]): string[] {
  const out: string[] = [];
  for (const it of items) if (it.kind === "question") out.push(it.id);
  return out;
}

function sameSequence(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function sameRoundMap(
  a: Map<string, string | null>,
  b: Map<string, string | null>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (!b.has(k)) return false;
    if (b.get(k) !== v) return false;
  }
  return true;
}

function diffRoundChanges(
  next: Map<string, string | null>,
  serverQuestions: Question[],
): RoundChange[] {
  const changes: RoundChange[] = [];
  const seen = new Set<string>();
  for (const q of serverQuestions) {
    if (!next.has(q.id)) continue;
    const nv = next.get(q.id) ?? null;
    const cur = normalize(q.round_name);
    const curOrNull = cur.length === 0 ? null : cur;
    if (nv !== curOrNull && !seen.has(q.id)) {
      seen.add(q.id);
      changes.push({ id: q.id, round_name: nv });
    }
  }
  return changes;
}

/* ---------------------- header row ---------------------- */

function SortableHeader({
  item,
  disabled,
  onRename,
  onDelete,
}: {
  item: Extract<Item, { kind: "header" }>;
  disabled: boolean;
  onRename: (newName: string) => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  };

  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(item.name);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (editing) {
      setDraft(item.name);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editing, item.name]);

  const empty = item.name.trim().length === 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-1 pt-3 pb-1"
    >
      <button
        type="button"
        aria-label="Dra runde"
        className="select-none text-zinc-400 cursor-grab active:cursor-grabbing px-1 py-0.5 touch-none"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      {editing ? (
        <>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onRename(draft);
                setEditing(false);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            onBlur={() => setEditing(false)}
            placeholder="Rundenavn (tom = Uten runde)"
            className="text-xs uppercase tracking-widest bg-transparent border-b accent-border outline-none px-1 py-0.5 text-zinc-700 dark:text-zinc-200 min-w-[12rem]"
          />
          <span className="text-[10px] text-zinc-400">
            Enter for å lagre · Esc for å avbryte
          </span>
        </>
      ) : (
        <>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEditing(true)}
            className={[
              "text-xs uppercase tracking-widest px-1 py-0.5 rounded",
              "accent-text accent-bg-faded",
              empty ? "italic text-zinc-500 not-accent" : "",
            ].join(" ")}
            style={empty ? { color: undefined } : undefined}
            aria-label="Endre rundenavn"
          >
            {empty ? (
              <span className="italic text-zinc-500">Uten runde</span>
            ) : (
              item.name
            )}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setEditing(true)}
            aria-label="Endre rundenavn"
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150 delay-100 group-hover:delay-0 text-xs text-zinc-400 hover:accent-text disabled:opacity-30"
          >
            ✎
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onDelete}
            aria-label="Slett runde"
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150 delay-100 group-hover:delay-0 text-xs text-zinc-400 hover:text-red-500 disabled:opacity-30"
          >
            ✗
          </button>
        </>
      )}
    </div>
  );
}

/* ---------------------- question row ---------------------- */

function SortableQuestion({
  question,
  globalIndex,
  renderRow,
}: {
  question: Question;
  globalIndex: number;
  renderRow: (q: Question, globalIndex: number) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: question.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        "flex items-start gap-2 rounded-lg border p-2 transition-colors",
        isDragging
          ? "bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 shadow-md"
          : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800",
      ].join(" ")}
    >
      <button
        type="button"
        aria-label="Dra for å endre rekkefølge"
        className="select-none text-zinc-400 cursor-grab active:cursor-grabbing px-1 py-0.5 touch-none"
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
      <div className="flex-1 min-w-0">{renderRow(question, globalIndex)}</div>
    </div>
  );
}

/* ---------------------- separator ---------------------- */

function InsertSeparator({
  id,
  disabled,
  onInsert,
}: {
  id: string;
  disabled: boolean;
  onInsert: (newName: string) => void;
}) {
  const { setNodeRef, isOver } = useSortable({ id });
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (editing) {
      setDraft("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [editing]);

  if (editing) {
    return (
      <div ref={setNodeRef} className="py-1">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onInsert(draft);
                setEditing(false);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            onBlur={() => setEditing(false)}
            placeholder="Nytt rundenavn (tom = Uten runde)"
            className="text-xs uppercase tracking-widest bg-transparent border-b accent-border outline-none px-1 py-0.5 text-zinc-700 dark:text-zinc-200 min-w-[14rem]"
          />
          <span className="text-[10px] text-zinc-400">
            Enter for å sette inn · Esc for å avbryte
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={[
        "group relative flex items-center justify-center",
        isOver ? "h-[18px] my-0.5" : "h-1.5 hover:h-[18px]",
      ].join(" ")}
    >
      <div
        className={[
          "absolute left-0 right-0 pointer-events-none",
          isOver
            ? "h-px border-t border-dashed accent-border"
            : "h-px border-t border-dashed border-transparent group-hover:accent-border",
        ].join(" ")}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        className="relative z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-150 delay-100 group-hover:delay-0 text-[10px] uppercase tracking-widest accent-text bg-[var(--bg,transparent)] px-2 py-0.5 rounded disabled:opacity-30"
      >
        + Sett inn runde
      </button>
    </div>
  );
}

/* ---------------------- main ---------------------- */

export function QuestionListWithRounds({
  questions,
  busyId,
  renderRow,
  onChange,
}: QuestionListWithRoundsProps): React.JSX.Element {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
  );

  const disabled = busyId !== null;

  // Server-derived items.
  const serverItems = React.useMemo(
    () => buildItemsFromQuestions(questions),
    [questions],
  );
  const serverQuestionIds = React.useMemo(
    () => questions.map((q) => q.id),
    [questions],
  );

  // Optimistic local items state. Null = follow server.
  const [localItems, setLocalItems] = React.useState<Item[] | null>(null);

  // When server catches up to local (same sequence + same round mapping),
  // drop the optimistic state.
  React.useEffect(() => {
    if (!localItems) return;
    const localQids = questionIdsOf(localItems);
    const serverQids = serverQuestionIds;
    if (!sameSequence(localQids, serverQids)) return;
    const localMap = computeRoundAssignments(localItems);
    const serverMap = computeRoundAssignments(serverItems);
    if (sameRoundMap(localMap, serverMap)) {
      setLocalItems(null);
    }
  }, [localItems, serverItems, serverQuestionIds]);

  const items: Item[] = localItems ?? serverItems;

  // Header counter for new headers — keep monotonic across the lifetime so
  // ids never collide with existing ones.
  const headerCounterRef = React.useRef(0);
  React.useEffect(() => {
    // Make sure the counter is always > any existing header index.
    let max = -1;
    for (const it of items) {
      if (it.kind === "header") {
        const m = /^header:(\d+)$/.exec(it.id);
        if (m) {
          const n = Number(m[1]);
          if (n > max) max = n;
        }
      }
    }
    if (headerCounterRef.current <= max) {
      headerCounterRef.current = max + 1;
    }
  }, [items]);

  function newHeaderId(): string {
    const id = `header:${headerCounterRef.current}`;
    headerCounterRef.current += 1;
    return id;
  }

  /** Commit a new items array: update optimistic state and emit onChange. */
  const commit = React.useCallback(
    (next: Item[]) => {
      setLocalItems(next);
      const orderedIds = questionIdsOf(next);
      const map = computeRoundAssignments(next);
      const changes = diffRoundChanges(map, questions);
      onChange(orderedIds, changes);
    },
    [onChange, questions],
  );

  /* ----- top "+ Ny runde øverst" ----- */
  const [topEditing, setTopEditing] = React.useState(false);
  const [topDraft, setTopDraft] = React.useState("");
  const topInputRef = React.useRef<HTMLInputElement | null>(null);
  React.useEffect(() => {
    if (topEditing) {
      setTopDraft("");
      requestAnimationFrame(() => topInputRef.current?.focus());
    }
  }, [topEditing]);

  function insertHeaderAt(index: number, name: string) {
    const next: Item[] = items.slice();
    next.splice(index, 0, {
      kind: "header",
      id: newHeaderId(),
      name: name.trim(),
    });
    commit(next);
  }

  function renameHeader(headerId: string, name: string) {
    const next: Item[] = items.map((it) =>
      it.kind === "header" && it.id === headerId
        ? { ...it, name: name.trim() }
        : it,
    );
    commit(next);
  }

  function deleteHeader(headerId: string) {
    const next: Item[] = items.filter(
      (it) => !(it.kind === "header" && it.id === headerId),
    );
    commit(next);
  }

  /* ----- drag-end ----- */

  // The dnd-kit sortable id list: every item id, plus separator ids
  // interleaved so they're valid drop targets.
  const sepId = (afterIndex: number) => `__sep_${afterIndex}__`;

  const dndIds = React.useMemo(() => {
    const ids: string[] = [];
    ids.push(sepId(-1));
    for (let i = 0; i < items.length; i += 1) {
      ids.push(items[i].id);
      ids.push(sepId(i));
    }
    return ids;
  }, [items]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const oldIndex = items.findIndex((it) => it.id === activeId);
    if (oldIndex === -1) return;

    let targetInsert: number;
    if (overId.startsWith("__sep_")) {
      const afterIndex = Number(overId.slice("__sep_".length, -2));
      targetInsert = afterIndex + 1; // insert position in the pre-removal list
    } else {
      const overIdx = items.findIndex((it) => it.id === overId);
      if (overIdx === -1) return;
      targetInsert = overIdx;
    }

    let newIndex =
      oldIndex < targetInsert ? targetInsert - 1 : targetInsert;
    if (newIndex < 0) newIndex = 0;
    if (newIndex >= items.length) newIndex = items.length - 1;
    if (newIndex === oldIndex) return;

    const next = arrayMove(items, oldIndex, newIndex);
    commit(next);
  }

  /* ----- render ----- */

  if (questions.length === 0) {
    return (
      <div className="text-sm text-zinc-500 italic py-6 text-center">
        Ingen spørsmål ennå.
      </div>
    );
  }

  // Compute per-question global index for renderRow.
  const globalIndexById = new Map<string, number>();
  {
    let n = 0;
    for (const it of items) {
      if (it.kind === "question") {
        globalIndexById.set(it.id, n);
        n += 1;
      }
    }
  }

  return (
    <div className="flex flex-col">
      {topEditing ? (
        <div className="pb-2">
          <input
            ref={topInputRef}
            value={topDraft}
            onChange={(e) => setTopDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                insertHeaderAt(0, topDraft);
                setTopEditing(false);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setTopEditing(false);
              }
            }}
            onBlur={() => setTopEditing(false)}
            placeholder="Navn på ny runde (tom = Uten runde)"
            className="text-xs uppercase tracking-widest bg-transparent border-b accent-border outline-none px-1 py-0.5 text-zinc-700 dark:text-zinc-200 min-w-[14rem]"
          />
          <span className="ml-2 text-[10px] text-zinc-400">
            Enter for å lagre · Esc for å avbryte
          </span>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setTopEditing(true)}
          className="self-start text-xs uppercase tracking-widest accent-text hover:underline pb-2 disabled:opacity-30"
        >
          + Ny runde øverst
        </button>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={dndIds} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col">
            <InsertSeparator
              id={sepId(-1)}
              disabled={disabled}
              onInsert={(name) => insertHeaderAt(0, name)}
            />
            {items.map((it, i) => (
              <React.Fragment key={it.id}>
                {it.kind === "header" ? (
                  <SortableHeader
                    item={it}
                    disabled={disabled}
                    onRename={(name) => renameHeader(it.id, name)}
                    onDelete={() => deleteHeader(it.id)}
                  />
                ) : (
                  <SortableQuestion
                    question={it.q}
                    globalIndex={globalIndexById.get(it.id) ?? 0}
                    renderRow={renderRow}
                  />
                )}
                <InsertSeparator
                  id={sepId(i)}
                  disabled={disabled}
                  onInsert={(name) => insertHeaderAt(i + 1, name)}
                />
              </React.Fragment>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
