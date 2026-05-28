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
  onClickAssign?: () => void;
  hasSelectedPnm?: boolean;
}

export default function ActiveDraggable({
  active, isMatched, isHighlighted, isDimmed,
  onHoverStart, onHoverEnd, onRightClick,
  assignMode = 'drag', onClickAssign, hasSelectedPnm,
}: ActiveDraggableProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: active.id,
    data: { active },
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  const isClickMode = assignMode === 'click';
  const isClickable = isClickMode && !isMatched && hasSelectedPnm;

  return (
    <div
      ref={isClickMode ? undefined : setNodeRef}
      style={isClickMode ? undefined : style}
      {...(isClickMode ? {} : listeners)}
      {...(isClickMode ? {} : attributes)}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onContextMenu={isClickMode ? undefined : onRightClick}
      onClick={isClickMode ? onClickAssign : undefined}
      data-testid={`button-active-${active.id}`}
      className={cn(
        "py-1.5 px-2.5 border border-slate-200/90 bg-white/95 text-[12px] font-medium text-slate-700 shadow-[0_10px_18px_-16px_rgba(15,23,42,0.55)] transition-all hover:border-slate-300 hover:shadow-[0_14px_24px_-18px_rgba(15,23,42,0.45)] rounded-none",
        !isClickMode && "touch-none cursor-grab active:cursor-grabbing hover:-translate-y-[1px]",
        isClickable && "cursor-pointer hover:bg-green-50 hover:border-green-400 hover:text-green-700",
        isClickMode && !isClickable && !isMatched && "cursor-default opacity-60",
        isDragging && "opacity-55 scale-[1.03] shadow-lg",
        isMatched && "bg-slate-50/90 text-slate-400",
        isHighlighted && "border-sky-400 bg-sky-50 text-sky-700 shadow-[0_14px_24px_-18px_rgba(14,116,144,0.45)]",
        isDimmed && !isDragging && "opacity-30"
      )}
    >
      {active.name}
    </div>
  );
}
