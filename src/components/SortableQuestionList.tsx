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

type QuestionItem = {
  id: string;
  position: number;
  render: () => React.ReactNode;
};

function SortableRow({ item }: { item: QuestionItem }) {
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
      <div className="flex-1 min-w-0">{item.render()}</div>
    </div>
  );
}

export function SortableQuestionList({
  questions,
  onReorder,
}: {
  questions: QuestionItem[];
  onReorder: (orderedIds: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    })
  );

  const ids = React.useMemo(() => questions.map((q) => q.id), [questions]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(ids, oldIndex, newIndex);
    onReorder(next);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2">
          {questions.map((q) => (
            <SortableRow key={q.id} item={q} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
