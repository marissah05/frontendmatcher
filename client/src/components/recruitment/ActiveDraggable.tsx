import { Active } from "@/lib/mock-data";
import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { MouseEvent } from "react";

interface ActiveDraggableProps {
  active: Active;
  isMatched?: boolean;
  isHighlighted?: boolean;
  isDimmed?: boolean;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
  onRightClick?: (event: MouseEvent<HTMLDivElement>) => void;
  assignMode?: 'drag' | 'click';
  onSelectForAssign?: () => void;
  isSelectedForAssign?: boolean;
}

export default function ActiveDraggable({
  active, isMatched, isHighlighted, isDimmed,
  onHoverStart, onHoverEnd, onRightClick,
  assignMode = 'drag', onSelectForAssign, isSelectedForAssign,
}: ActiveDraggableProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: active.id,
    data: { active },
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  const isClickMode = assignMode === 'click';

  return (
    <div
      ref={isClickMode ? undefined : setNodeRef}
      style={isClickMode ? undefined : style}
      {...(isClickMode ? {} : listeners)}
      {...(isClickMode ? {} : attributes)}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onContextMenu={isClickMode ? undefined : onRightClick}
      onClick={isClickMode && !isMatched ? onSelectForAssign : undefined}
      data-testid={`button-active-${active.id}`}
      className={cn(
        "py-1.5 px-2.5 border text-[12px] font-medium text-slate-700 shadow-[0_10px_18px_-16px_rgba(15,23,42,0.55)] transition-all rounded-none",
        !isClickMode && "bg-white/95 border-slate-200/90 touch-none cursor-grab active:cursor-grabbing hover:border-slate-300 hover:-translate-y-[1px] hover:shadow-[0_14px_24px_-18px_rgba(15,23,42,0.45)]",
        isClickMode && !isMatched && !isSelectedForAssign && "bg-white/95 border-slate-200/90 cursor-pointer hover:border-violet-400 hover:bg-violet-50/60 hover:text-violet-700",
        isClickMode && isSelectedForAssign && "bg-green-50 border-green-500 text-green-800 ring-2 ring-green-400 ring-offset-1 cursor-pointer",
        isClickMode && isMatched && "bg-slate-50/90 border-slate-200/90 text-slate-400 cursor-default opacity-60",
        isDragging && "opacity-55 scale-[1.03] shadow-lg",
        !isClickMode && isMatched && "bg-slate-50/90 text-slate-400",
        isHighlighted && !isClickMode && "border-sky-400 bg-sky-50 text-sky-700 shadow-[0_14px_24px_-18px_rgba(14,116,144,0.45)]",
        isDimmed && !isDragging && !isClickMode && "opacity-30"
      )}
    >
      {active.name}
    </div>
  );
}
