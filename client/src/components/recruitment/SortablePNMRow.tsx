import { Active, PNM } from "@/lib/mock-data";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import PNMDropZone from "./PNMDropZone";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, GripVertical, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SortablePNMRowProps {
  pnm: PNM;
  pnms: PNM[];
  actives: Active[];
  rowIndex: number;
  onUnmatch: (pnmId: string, slot: 1 | 2) => void;
  onClearBoth: (pnmId: string) => void;
  onDelete: (pnmId: string) => void;
  onHoverStart?: () => void;
  onHoverEnd?: () => void;
  isHighlighted?: boolean;
  isDimmed?: boolean;
  dropPreview1?: {
    alreadyUsedInSlot: boolean;
    chainCount: number;
    isOverLimit: boolean;
    wouldCycle: boolean;
  };
  dropPreview2?: {
    alreadyUsedInSlot: boolean;
    chainCount: number;
    isOverLimit: boolean;
    wouldCycle: boolean;
  };
  highlightedActiveIds: Set<string>;
  isBump2Enabled?: boolean;
  assignMode?: 'drag' | 'click';
  selectedActiveForAssign?: { id: string; slot: 1 | 2 } | null;
  onClickAssignToSlot?: (slot: 1 | 2) => void;
}

export default function SortablePNMRow({
  pnm, pnms, actives, rowIndex, onUnmatch, onClearBoth, onDelete,
  onHoverStart, onHoverEnd, isHighlighted, isDimmed, dropPreview1, dropPreview2,
  highlightedActiveIds, isBump2Enabled = true,
  assignMode = 'drag', selectedActiveForAssign, onClickAssignToSlot,
}: SortablePNMRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: pnm.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const filledCount = isBump2Enabled
    ? [pnm.matchedWith, pnm.secondMatch].filter(Boolean).length
    : [pnm.matchedWith].filter(Boolean).length;
  const totalSlots = isBump2Enabled ? 2 : 1;
  const hasDuplicate1 = !!pnm.matchedWith && pnms.some(otherPnm => otherPnm.id !== pnm.id && otherPnm.matchedWith === pnm.matchedWith);
  const hasDuplicate2 = isBump2Enabled && !!pnm.secondMatch && pnms.some(otherPnm => otherPnm.id !== pnm.id && otherPnm.secondMatch === pnm.secondMatch);
  const hasDuplicate = hasDuplicate1 || hasDuplicate2;

  const slot1Assignable = assignMode === 'click' && selectedActiveForAssign?.slot === 1 && !pnm.matchedWith;
  const slot2Assignable = assignMode === 'click' && selectedActiveForAssign?.slot === 2 && !pnm.secondMatch;

  const getStatusBadge = () => {
    if (hasDuplicate) {
      return <Badge className="bg-red-500 hover:bg-red-600 text-white border-none rounded-none text-[9px] h-5 px-1.5 uppercase font-bold">Conflict</Badge>;
    }
    if (filledCount === totalSlots) {
      return <Badge className="bg-green-500 hover:bg-green-600 text-white border-none rounded-none text-[9px] h-5 px-1.5 uppercase font-bold">Ready</Badge>;
    }
    if (filledCount >= 1) {
      return <Badge className="bg-amber-400 hover:bg-amber-500 text-white border-none rounded-none text-[9px] h-5 px-1.5 uppercase font-bold text-nowrap">Missing 1</Badge>;
    }
    return <Badge className="bg-red-500 hover:bg-red-600 text-white border-none rounded-none text-[9px] h-5 px-1.5 uppercase font-bold text-nowrap">Unmatched</Badge>;
  };

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      data-testid={`row-pnm-${pnm.id}`}
      className={cn(
        "h-10 border-b border-b-slate-100/90 transition-all relative group",
        rowIndex % 2 === 1 ? "bg-violet-50/45" : "bg-white/80",
        !isDragging && !isHighlighted && "hover:bg-slate-100/85",
        isDragging && "z-50 bg-white shadow-[0_18px_36px_-26px_rgba(15,23,42,0.45)] opacity-85",
        isHighlighted && "bg-slate-100/90 shadow-[inset_3px_0_0_0_rgb(15_23_42)]",
        isDimmed && !isDragging && "opacity-45",
      )}
    >
      <TableCell className="py-0.5 w-8 p-0">
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-2 text-slate-300 hover:text-slate-600 transition-colors"
          data-testid={`button-drag-pnm-${pnm.id}`}
        >
          <GripVertical className="h-3 w-3" />
        </div>
      </TableCell>
      <TableCell className="py-0.5">
        {getStatusBadge()}
      </TableCell>
      <TableCell className="py-0.5">
        <div className="flex flex-col">
          <span className="text-[12px] font-semibold leading-tight" data-testid={`text-pnm-name-${pnm.id}`}>{pnm.name}</span>
          <span className="text-[9px] text-muted-foreground" data-testid={`text-pnm-id-${pnm.id}`}>ID: {pnm.idNumber}</span>
        </div>
      </TableCell>
      <TableCell className="py-0.5" onClick={e => e.stopPropagation()}>
        <PNMDropZone
          pnm={pnm}
          slot={1}
          matchedActiveName={actives.find(a => a.id === pnm.matchedWith)?.name}
          onUnmatch={onUnmatch}
          isDuplicate={hasDuplicate1}
          isHighlighted={!!pnm.matchedWith && highlightedActiveIds.has(pnm.matchedWith)}
          isDimmed={isDimmed}
          dropPreview={dropPreview1}
          isClickAssignable={slot1Assignable}
          onClickAssign={() => onClickAssignToSlot?.(1)}
        />
      </TableCell>
      {isBump2Enabled ? (
        <TableCell className="py-0.5" onClick={e => e.stopPropagation()}>
          <PNMDropZone
            pnm={pnm}
            slot={2}
            matchedActiveName={actives.find(a => a.id === pnm.secondMatch)?.name}
            onUnmatch={onUnmatch}
            isDuplicate={hasDuplicate2}
            isHighlighted={!!pnm.secondMatch && highlightedActiveIds.has(pnm.secondMatch)}
            isDimmed={isDimmed}
            dropPreview={dropPreview2}
            isClickAssignable={slot2Assignable}
            onClickAssign={() => onClickAssignToSlot?.(2)}
          />
        </TableCell>
      ) : (
        <TableCell className="py-0.5 text-slate-200 text-[10px] text-center select-none">—</TableCell>
      )}
      <TableCell className="py-0.5 w-20" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-0.5">
          {(pnm.matchedWith || pnm.secondMatch) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-amber-600 rounded-none opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => onClearBoth(pnm.id)}
              title="Clear both matches"
              data-testid={`button-clear-pnm-${pnm.id}`}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive rounded-none"
            onClick={() => onDelete(pnm.id)}
            data-testid={`button-delete-pnm-${pnm.id}`}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
