import { PNM } from "@/lib/mock-data";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";

interface PNMDropZoneProps {
  pnm: PNM;
  slot: 1 | 2;
  matchedActiveName?: string;
  onUnmatch: (pnmId: string, slot: 1 | 2) => void;
  isDuplicate?: boolean;
  isHighlighted?: boolean;
  isDimmed?: boolean;
  dropPreview?: {
    alreadyUsedInSlot: boolean;
    chainCount: number;
    isOverLimit: boolean;
    wouldCycle: boolean;
  };
}

export default function PNMDropZone({ pnm, slot, matchedActiveName, onUnmatch, isDuplicate, isHighlighted, isDimmed, dropPreview }: PNMDropZoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-${pnm.id}-${slot}`,
    data: { pnm, slot },
  });

  if (matchedActiveName) {
    const isSlot1 = slot === 1;
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-1.5 px-2.5 py-1 border text-[11px] font-medium min-w-[112px] rounded-none transition-all shadow-[0_10px_20px_-18px_rgba(15,23,42,0.55)]",
          isSlot1 ? "bg-sky-50/90 border-sky-200 text-sky-700" : "bg-violet-50/90 border-violet-200 text-violet-700",
          isDuplicate && "border-red-300 bg-[linear-gradient(90deg,rgba(254,242,242,1),rgba(255,255,255,0.96))] text-red-700 shadow-[inset_3px_0_0_0_rgb(239_68_68)]",
          isHighlighted && "ring-1 ring-slate-900/10 shadow-sm",
          isDimmed && "opacity-40"
        )}
        data-testid={`text-match-${slot}-${pnm.id}`}
      >
        <div className="min-w-0 flex-1">
          <span className="truncate block">{matchedActiveName}</span>
          {isDuplicate ? <span className="block text-[8px] font-bold uppercase tracking-[0.14em] text-red-500">Duplicate assignment</span> : null}
        </div>
        <button
          onClick={() => onUnmatch(pnm.id, slot)}
          className="hover:text-destructive transition-colors leading-none"
          data-testid={`button-unmatch-${slot}-${pnm.id}`}
        >
          ×
        </button>
      </div>
    );
  }

  const blocked = isOver && (dropPreview?.wouldCycle || dropPreview?.alreadyUsedInSlot);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "h-6 border-2 border-dashed flex items-center justify-center text-[10px] px-2 transition-colors min-w-[100px] rounded-none",
        isOver && dropPreview?.wouldCycle && "border-orange-500 bg-orange-50 text-orange-700",
        isOver && !dropPreview?.wouldCycle && dropPreview?.alreadyUsedInSlot && "border-red-400 bg-red-50 text-red-700",
        isOver && !blocked && dropPreview?.isOverLimit && "border-amber-400 bg-amber-50 text-amber-700",
        isOver && !blocked && !dropPreview?.isOverLimit && "bg-primary/5 border-primary text-primary",
        !isOver && "text-muted-foreground/50 italic border-border/60 hover:border-border",
        isHighlighted && !isOver && "border-slate-400 text-slate-700",
        isDimmed && !isOver && "opacity-40"
      )}
      data-testid={`dropzone-slot-${slot}-${pnm.id}`}
    >
      {isOver && dropPreview?.wouldCycle
        ? "Cycle!"
        : isOver && dropPreview?.alreadyUsedInSlot
          ? `Used in Bump ${slot}`
          : isOver && dropPreview?.isOverLimit
            ? `Chain ${dropPreview.chainCount}`
            : isOver
              ? "Release"
              : `Slot ${slot}`}
    </div>
  );
}
