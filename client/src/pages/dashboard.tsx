import { useState, useMemo, useRef, useEffect } from "react";
import { 
  DndContext, 
  DragOverlay, 
  useSensor, 
  useSensors, 
  PointerSensor, 
  DragStartEvent, 
  DragEndEvent,
  closestCenter,
  defaultDropAnimationSideEffects
} from "@dnd-kit/core";
import { 
  arrayMove, 
  SortableContext, 
  verticalListSortingStrategy 
} from "@dnd-kit/sortable";
import { MOCK_PNMS, MOCK_ACTIVES, PNM, Active } from "@/lib/mock-data";
import ActiveDraggable from "@/components/recruitment/ActiveDraggable";
import PNMDropZone from "@/components/recruitment/PNMDropZone";
import SortablePNMRow from "@/components/recruitment/SortablePNMRow";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Search, ClipboardPaste, UserCheck, Users, Trash2, Download, Upload, GitMerge, ListOrdered, AlertTriangle, Wand2, Settings2, ChevronLeft, ChevronRight, RotateCcw, Save, BookMarked, Clock, BarChart2, Star, MessageSquare, ChevronDown } from "lucide-react";
import { Toaster, toast } from "sonner";
import Papa from "papaparse";
import * as XLSX from "xlsx";

interface RoundData {
  id: string;
  name: string;
  sortOrder: number;
  pnms: PNM[];
}

interface ChainInfo {
  activeIds: string[];
  count: number;
  display: string;
  starterName: string;
  handoffDisplay: string;
  isCycle: boolean;
  isOverLimit: boolean;
}

interface PlannerSnapshot {
  rounds: RoundData[];
  actives: Active[];
  activeRoundId: string;
  chainLengthLimit: number;
}

interface SnapshotMeta {
  id: string;
  label: string;
  createdAt: string;
}

interface PnmReview {
  id: string;
  pnmId: string;
  activeId: string;
  activeName: string;
  pnmName: string;
  stars: number;
  note: string;
  updatedAt: string;
}

const INITIAL_ROUNDS: RoundData[] = [
  { id: "r1", name: "Round 1", sortOrder: 0, pnms: MOCK_PNMS },
  { id: "r2", name: "Round 2", sortOrder: 1, pnms: MOCK_PNMS.slice(0, 2) },
];

// ── ReviewsTab component ───────────────────────────────────────────────────────
function ReviewsTab({
  rounds, actives, reviews, setReviews,
  expandedPnmId, setExpandedPnmId,
  reviewDraft, setReviewDraft,
  savingReviewId, setSavingReviewId,
  commentsSearch, setCommentsSearch,
}: {
  rounds: RoundData[];
  actives: Active[];
  reviews: PnmReview[];
  setReviews: React.Dispatch<React.SetStateAction<PnmReview[]>>;
  expandedPnmId: string | null;
  setExpandedPnmId: React.Dispatch<React.SetStateAction<string | null>>;
  reviewDraft: Record<string, { stars: number; note: string }>;
  setReviewDraft: React.Dispatch<React.SetStateAction<Record<string, { stars: number; note: string }>>>;
  savingReviewId: string | null;
  setSavingReviewId: React.Dispatch<React.SetStateAction<string | null>>;
  commentsSearch: string;
  setCommentsSearch: React.Dispatch<React.SetStateAction<string>>;
}) {
  const seenNames = new Set<string>();
  const uniquePnms = rounds.flatMap(r => r.pnms).filter(p => {
    if (seenNames.has(p.name)) return false;
    seenNames.add(p.name);
    return true;
  }).filter(p => p.name.toLowerCase().includes(commentsSearch.toLowerCase()));

  // Build a map: pnmId → Set of activeIds who talked to that PNM across all rounds
  const pnmToActiveIds = new Map<string, Set<string>>();
  rounds.forEach(round => {
    round.pnms.forEach(pnm => {
      if (!pnmToActiveIds.has(pnm.id)) pnmToActiveIds.set(pnm.id, new Set());
      if (pnm.matchedWith) pnmToActiveIds.get(pnm.id)!.add(pnm.matchedWith);
      if (pnm.secondMatch) pnmToActiveIds.get(pnm.id)!.add(pnm.secondMatch);
    });
  });

  const saveReview = async (pnmId: string, activeId: string, activeName: string, pnmName: string, stars: number, note: string) => {
    const id = `rev_${pnmId}_${activeId}`;
    setSavingReviewId(id);
    try {
      const res = await fetch(`/api/reviews/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pnmId, activeId, activeName, pnmName, stars, note }),
      });
      if (res.ok) {
        const saved: PnmReview = await res.json();
        setReviews(prev => [...prev.filter(r => r.id !== saved.id), saved]);
      }
    } finally {
      setSavingReviewId(null);
    }
  };

  const allPnmsCount = rounds.flatMap(r => r.pnms).filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i).length;

  return (
    <>
    <div className="px-3 py-2 border-b border-slate-200/80 shrink-0 flex items-center gap-2 bg-white/95">
      <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
      <input
        className="flex-1 text-[12px] bg-transparent outline-none placeholder:text-slate-400 text-slate-800"
        placeholder="Search PNMs…"
        value={commentsSearch}
        onChange={e => setCommentsSearch(e.target.value)}
        data-testid="input-comments-search"
      />
      {commentsSearch && <button onClick={() => setCommentsSearch("")} className="text-[10px] text-slate-400 hover:text-slate-600">✕</button>}
    </div>
    <ScrollArea className="flex-1">
      {uniquePnms.length === 0 ? (
        <div className="py-16 text-center text-[11px] text-slate-400">{allPnmsCount === 0 ? 'No PNMs imported yet.' : 'No PNMs match your search.'}</div>
      ) : uniquePnms.map(pnm => {
        const matchedActiveIds = pnmToActiveIds.get(pnm.id) ?? new Set<string>();
        const matchedActives = actives.filter(a => matchedActiveIds.has(a.id));
        const pnmReviewsList = reviews.filter(r => r.pnmId === pnm.id);
        const avgStars = pnmReviewsList.length > 0
          ? pnmReviewsList.reduce((s, r) => s + r.stars, 0) / pnmReviewsList.length
          : null;
        const isExpanded = expandedPnmId === pnm.id;

        return (
          <div key={pnm.id} className="border-b border-slate-100 last:border-0" data-testid={`review-section-${pnm.id}`}>
            <button
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left"
              onClick={() => setExpandedPnmId(isExpanded ? null : pnm.id)}
              data-testid={`btn-expand-pnm-${pnm.id}`}
            >
              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
              <span className="flex-1 text-[12px] font-semibold text-slate-800">{pnm.name}</span>
              {avgStars !== null ? (
                <span className="flex items-center gap-1 shrink-0" data-testid={`text-avg-stars-${pnm.id}`}>
                  {[1,2,3,4,5].map(s => (
                    <Star key={s} className={`w-3 h-3 ${s <= Math.round(avgStars) ? 'text-amber-400 fill-amber-400' : 'text-slate-200'}`} />
                  ))}
                  <span className="text-[10px] text-slate-500 ml-1">{avgStars.toFixed(1)} · {pnmReviewsList.length} comment{pnmReviewsList.length !== 1 ? 's' : ''}</span>
                </span>
              ) : (
                <span className="text-[10px] text-slate-300 shrink-0">No comments yet</span>
              )}
            </button>

            {isExpanded && (
              <div className="bg-slate-50/60 border-t border-slate-100 px-4 pt-3 pb-4 space-y-4">
                {matchedActives.length === 0 ? (
                  <p className="text-[11px] text-slate-400">No actives have been matched with this PNM yet.</p>
                ) : matchedActives.map(active => {
                  const reviewId = `rev_${pnm.id}_${active.id}`;
                  const existing = reviews.find(r => r.id === reviewId);
                  const draft = reviewDraft[reviewId];
                  const currentStars = draft?.stars ?? existing?.stars ?? 0;
                  const currentNote = draft?.note ?? existing?.note ?? "";
                  const isSaving = savingReviewId === reviewId;
                  const isDirty = draft !== undefined && (draft.stars !== (existing?.stars ?? 0) || draft.note !== (existing?.note ?? ""));

                  return (
                    <div key={active.id} className="bg-white border border-slate-200 p-3" data-testid={`review-form-${pnm.id}-${active.id}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-semibold text-slate-700">{active.name}</span>
                        {existing && !isDirty && <span className="text-[9px] text-slate-400">Saved</span>}
                      </div>
                      <div className="flex items-center gap-1 mb-2.5">
                        {[1,2,3,4,5].map(s => (
                          <button
                            key={s}
                            onClick={() => setReviewDraft(prev => ({ ...prev, [reviewId]: { stars: s, note: prev[reviewId]?.note ?? existing?.note ?? "" } }))}
                            className="transition-transform hover:scale-110"
                            data-testid={`star-${pnm.id}-${active.id}-${s}`}
                          >
                            <Star className={`w-5 h-5 ${s <= currentStars ? 'text-amber-400 fill-amber-400' : 'text-slate-200 hover:text-amber-300'}`} />
                          </button>
                        ))}
                        {currentStars > 0 && (
                          <button onClick={() => setReviewDraft(prev => ({ ...prev, [reviewId]: { stars: 0, note: prev[reviewId]?.note ?? existing?.note ?? "" } }))} className="ml-1 text-[9px] text-slate-400 hover:text-slate-600">clear</button>
                        )}
                      </div>
                      <Textarea
                        placeholder={`${active.name}'s notes on ${pnm.name}…`}
                        className="text-[11px] resize-none h-16 rounded-none border-slate-200 bg-slate-50 shadow-none focus:bg-white"
                        value={currentNote}
                        onChange={e => setReviewDraft(prev => ({ ...prev, [reviewId]: { stars: prev[reviewId]?.stars ?? existing?.stars ?? 0, note: e.target.value } }))}
                        data-testid={`textarea-review-${pnm.id}-${active.id}`}
                      />
                      {(isDirty || (currentStars > 0 && !existing)) && (
                        <button
                          disabled={isSaving || currentStars === 0}
                          onClick={async () => {
                            await saveReview(pnm.id, active.id, active.name, pnm.name, currentStars, currentNote);
                            setReviewDraft(prev => { const n = { ...prev }; delete n[reviewId]; return n; });
                          }}
                          className="mt-2 px-3 py-1 text-[10px] font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          data-testid={`btn-save-review-${pnm.id}-${active.id}`}
                        >
                          {isSaving ? "Saving…" : "Save Comment"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </ScrollArea>
    </>
  );
}

export default function Dashboard() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [rounds, setRounds] = useState<RoundData[]>(INITIAL_ROUNDS);
  const [activeRoundId, setActiveRoundId] = useState("r1");
  const [actives, setActives] = useState<Active[]>(MOCK_ACTIVES);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingType, setDraggingType] = useState<'active' | 'pnm' | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [pnmPasteData, setPnmPasteData] = useState("");
  const [activePasteData, setActivePasteData] = useState("");
  const [isPnmImportOpen, setIsPnmImportOpen] = useState(false);
  const [isActiveImportOpen, setIsActiveImportOpen] = useState(false);
  const [isBumpChainsOpen, setIsBumpChainsOpen] = useState(false);
  const [activeView, setActiveView] = useState<'planner' | 'summary' | 'reviews'>('planner');
  const [summarySearch, setSummarySearch] = useState("");
  const [commentsSearch, setCommentsSearch] = useState("");
  const [reviews, setReviews] = useState<PnmReview[]>([]);
  const [expandedPnmId, setExpandedPnmId] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<Record<string, { stars: number; note: string }>>({});
  const [savingReviewId, setSavingReviewId] = useState<string | null>(null);
  const [isSnapshotsOpen, setIsSnapshotsOpen] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [snapshotList, setSnapshotList] = useState<SnapshotMeta[]>([]);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  const [chainLengthLimit, setChainLengthLimit] = useState(6);
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(true);
  const [isLinkedHoverEnabled, setIsLinkedHoverEnabled] = useState(false);
  const [hoveredActiveId, setHoveredActiveId] = useState<string | null>(null);
  const [hoveredPnmId, setHoveredPnmId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<PlannerSnapshot[]>([]);

  const pool1Ref = useRef<HTMLDivElement>(null);
  const roundNameUndoCapturedRef = useRef(false);
  const pool2Ref = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isInitializedRef = useRef(false);          // becomes true after boot load settles
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load persisted state from the database on first mount.
  // If the API returns null (empty database), keep the mock data as-is.
  useEffect(() => {
    fetch("/api/state")
      .then(res => res.json())
      .then(data => {
        if (data && data.rounds) {
          const loadedRounds: RoundData[] = data.rounds.map((r: any) => ({
            id: r.id,
            name: r.name,
            sortOrder: r.sortOrder,
            pnms: r.pnms.map((p: any) => ({
              id: p.id,
              name: p.name,
              idNumber: p.idNumber,
              matchedWith: p.matchedWith ?? undefined,
              secondMatch: p.secondMatch ?? undefined,
              status: (p.matchedWith || p.secondMatch) ? 'matched' : 'unmatched',
            } as PNM)),
          }));
          setRounds(loadedRounds);
          setActives(data.actives ?? []);
          setActiveRoundId(loadedRounds[0]?.id ?? "");
          if (data.chainLengthLimit) setChainLengthLimit(data.chainLengthLimit);
        }
        // data === null means first launch → keep INITIAL_ROUNDS mock data
      })
      .catch(() => {
        // Network error or server down → keep mock data, show nothing to user
      })
      .finally(() => {
        setIsLoading(false);
        setTimeout(() => { isInitializedRef.current = true; }, 0);
      });
  }, []);

  // Load reviews on mount
  useEffect(() => {
    fetch("/api/reviews")
      .then(r => r.json())
      .then((data: PnmReview[]) => { if (Array.isArray(data)) setReviews(data); })
      .catch(() => {});
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Debounced autosave — fires 800ms after the last change to any of these values.
  // Skipped entirely until isInitializedRef.current is true (set after boot load).
  // Silent: no toast, fire-and-forget. Manual Save button is the toasted version.
  useEffect(() => {
    if (!isInitializedRef.current) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    autosaveTimerRef.current = setTimeout(async () => {
      try {
        const body = {
          rounds: rounds.map((r, i) => ({
            id: r.id,
            name: r.name,
            sortOrder: r.sortOrder ?? i,
            pnms: r.pnms.map(p => ({
              id: p.id,
              name: p.name,
              idNumber: p.idNumber,
              matchedWith: p.matchedWith ?? null,
              secondMatch: p.secondMatch ?? null,
            })),
          })),
          actives: actives.map(a => ({ id: a.id, name: a.name })),
          activeRoundId,
          chainLengthLimit,
        };
        await fetch("/api/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        // Autosave failures are silent — user can still use manual Save button
      }
    }, 800);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [rounds, actives, activeRoundId, chainLengthLimit]);

  const activeRound = useMemo(() => rounds.find(r => r.id === activeRoundId)!, [rounds, activeRoundId]);

  const createSnapshot = (): PlannerSnapshot => ({
    rounds: JSON.parse(JSON.stringify(rounds)) as RoundData[],
    actives: JSON.parse(JSON.stringify(actives)) as Active[],
    activeRoundId,
    chainLengthLimit,
  });

  const pushUndoState = () => {
    setUndoStack(prev => [...prev, createSnapshot()]);
  };

  const handleUndo = () => {
    const previousSnapshot = undoStack[undoStack.length - 1];
    if (!previousSnapshot) {
      return;
    }

    setUndoStack(prev => prev.slice(0, -1));
    setRounds(previousSnapshot.rounds);
    setActives(previousSnapshot.actives);
    setActiveRoundId(previousSnapshot.activeRoundId);
    setChainLengthLimit(previousSnapshot.chainLengthLimit);
    setHoveredActiveId(null);
    setHoveredPnmId(null);
    setDraggingId(null);
    setDraggingType(null);
    toast.success("Undid last planner change", {
      className: "rounded-none text-xs font-bold"
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isTypingTarget = target instanceof HTMLElement && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      );

      if (isTypingTarget) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey && undoStack.length > 0) {
        event.preventDefault();
        handleUndo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undoStack]);

  const handleAddRound = () => {
    pushUndoState();
    const nextRoundNumber = rounds.length + 1;
    const nextRound: RoundData = {
      id: `r${Date.now()}`,
      name: `Round ${nextRoundNumber}`,
      sortOrder: rounds.length,
      pnms: [],
    };
    setRounds(prev => [...prev, nextRound]);
    setActiveRoundId(nextRound.id);
  };

  const handleDeleteRound = () => {
    if (rounds.length <= 1) {
      toast.error("Cannot delete the last round");
      return;
    }
    if (!confirm("Delete this round? This cannot be undone.")) return;
    pushUndoState();
    const remaining = rounds.filter(r => r.id !== activeRoundId);
    setRounds(remaining);
    setActiveRoundId(remaining[0].id);
  };

  const handleClearRound = () => {
    if (!confirm(`Clear all PNMs from ${activeRound.name}? This cannot be undone.`)) return;
    pushUndoState();
    setRounds(prev => prev.map(r => r.id === activeRoundId ? { ...r, pnms: [] } : r));
    toast.success(`${activeRound.name} cleared`);
  };

  const handleClearActivePool = () => {
    if (!confirm("Remove all actives from the pool? This will also clear all bump assignments.")) return;
    pushUndoState();
    setActives([]);
    setRounds(prev => prev.map(r => ({
      ...r,
      pnms: r.pnms.map(p => ({ ...p, matchedWith: undefined, secondMatch: undefined })),
    })));
    toast.success("Active pool cleared");
  };

  const handleRoundNameChange = (name: string) => {
    if (!roundNameUndoCapturedRef.current) {
      pushUndoState();
      roundNameUndoCapturedRef.current = true;
    }

    setRounds(prev => prev.map(round => (
      round.id === activeRoundId
        ? { ...round, name }
        : round
    )));
  };

  const handleRoundNameBlur = () => {
    if (activeRound.name.trim()) {
      roundNameUndoCapturedRef.current = false;
      return;
    }

    const activeRoundIndex = rounds.findIndex(round => round.id === activeRoundId) + 1;
    setRounds(prev => prev.map(round => (
      round.id === activeRoundId
        ? { ...round, name: `Round ${activeRoundIndex || 1}` }
        : round
    )));
    roundNameUndoCapturedRef.current = false;
  };

  const usedActivesSlot1 = useMemo(() => new Set(activeRound.pnms.map(p => p.matchedWith).filter(Boolean)), [activeRound]);
  const usedActivesSlot2 = useMemo(() => new Set(activeRound.pnms.map(p => p.secondMatch).filter(Boolean)), [activeRound]);
  const activeNameById = useMemo(() => new Map(actives.map(active => [active.id, active.name])), [actives]);

  const buildChainAnalysis = (pnms: PNM[]) => {
    const forward = new Map<string, string>();
    const reverse = new Map<string, string>();
    const nodes = new Set<string>();
    const chains: ChainInfo[] = [];
    const activeToChain = new Map<string, ChainInfo>();
    const visited = new Set<string>();

    pnms.forEach(pnm => {
      if (pnm.matchedWith && pnm.secondMatch) {
        forward.set(pnm.matchedWith, pnm.secondMatch);
        reverse.set(pnm.secondMatch, pnm.matchedWith);
        nodes.add(pnm.matchedWith);
        nodes.add(pnm.secondMatch);
      }
    });

    const pushChain = (activeIds: string[], isCycle: boolean) => {
      const names = activeIds.map(activeId => activeNameById.get(activeId) || activeId);
      const readOrderNames = names;
      const display = isCycle ? [...readOrderNames, readOrderNames[0]].join(" -> ") : readOrderNames.join(" -> ");
      const starterName = readOrderNames[0];
      const handoffNames = isCycle
        ? [...readOrderNames.slice(1), readOrderNames[0]]
        : readOrderNames.slice(1);
      const handoffDisplay = handoffNames.length > 0 ? handoffNames.join(" -> ") : readOrderNames[0];
      const chain: ChainInfo = {
        activeIds,
        count: activeIds.length,
        display,
        starterName,
        handoffDisplay,
        isCycle,
        isOverLimit: activeIds.length > chainLengthLimit,
      };

      chains.push(chain);
      activeIds.forEach(activeId => activeToChain.set(activeId, chain));
    };

    Array.from(nodes).forEach(starter => {
      if (reverse.has(starter) || visited.has(starter)) {
        return;
      }

      const activeIds = [starter];
      visited.add(starter);
      let current = starter;
      let safetyCounter = 0;

      while (forward.has(current) && safetyCounter < nodes.size + 1) {
        const next = forward.get(current)!;
        if (visited.has(next)) {
          break;
        }
        activeIds.push(next);
        visited.add(next);
        current = next;
        safetyCounter += 1;
      }

      pushChain(activeIds, false);
    });

    Array.from(nodes).forEach(starter => {
      if (visited.has(starter)) {
        return;
      }

      const activeIds = [starter];
      visited.add(starter);
      let current = starter;
      let safetyCounter = 0;
      let isCycle = false;

      while (forward.has(current) && safetyCounter < nodes.size + 1) {
        const next = forward.get(current)!;
        if (next === starter) {
          isCycle = true;
          break;
        }
        if (visited.has(next)) {
          break;
        }
        activeIds.push(next);
        visited.add(next);
        current = next;
        safetyCounter += 1;
      }

      pushChain(activeIds, isCycle);
    });

    return {
      chains,
      activeToChain,
      longestChainCount: chains.reduce((max, chain) => Math.max(max, chain.count), 0),
      overLimitCount: chains.filter(chain => chain.isOverLimit).length,
    };
  };

  const chainAnalysis = useMemo(() => buildChainAnalysis(activeRound.pnms), [activeRound.pnms, activeNameById, chainLengthLimit]);

  const highlightedActiveIds = useMemo(() => {
    const ids = new Set<string>();

    if (!isLinkedHoverEnabled) {
      return ids;
    }

    const addLinkedActives = (activeId?: string) => {
      if (!activeId) {
        return;
      }

      const chain = chainAnalysis.activeToChain.get(activeId);
      if (chain) {
        chain.activeIds.forEach(linkedId => ids.add(linkedId));
        return;
      }

      ids.add(activeId);
    };

    if (hoveredActiveId) {
      addLinkedActives(hoveredActiveId);
    }

    if (hoveredPnmId) {
      const hoveredPnm = activeRound.pnms.find(pnm => pnm.id === hoveredPnmId);
      if (hoveredPnm) {
        addLinkedActives(hoveredPnm.matchedWith);
        addLinkedActives(hoveredPnm.secondMatch);
      }
    }

    return ids;
  }, [isLinkedHoverEnabled, hoveredActiveId, hoveredPnmId, activeRound.pnms, chainAnalysis]);

  const hasLinkedHighlight = isLinkedHoverEnabled && highlightedActiveIds.size > 0;

  const dropWarnings = useMemo(() => {
    const warnings = new Map<string, { alreadyUsedInSlot: boolean; chainCount: number; isOverLimit: boolean }>();

    if (draggingType !== 'active' || !draggingId) {
      return warnings;
    }

    const draggedActiveId = draggingId.split('-')[0];

    activeRound.pnms.forEach(pnm => {
      ([1, 2] as const).forEach(slot => {
        const slotKey = slot === 1 ? 'matchedWith' : 'secondMatch';
        const simulatedPnms = activeRound.pnms.map(currentPnm => {
          if (currentPnm.id !== pnm.id) {
            return currentPnm;
          }

          return {
            ...currentPnm,
            [slotKey]: draggedActiveId,
            status: 'matched' as const,
          };
        });
        const analysis = buildChainAnalysis(simulatedPnms);
        const relatedActiveIds = [
          draggedActiveId,
          slot === 1 ? pnm.secondMatch : pnm.matchedWith,
        ].filter(Boolean) as string[];
        const relatedChains = relatedActiveIds
          .map(activeId => analysis.activeToChain.get(activeId))
          .filter((chain): chain is ChainInfo => Boolean(chain));
        const chainCount = relatedChains.length ? Math.max(...relatedChains.map(chain => chain.count)) : 1;

        warnings.set(`${pnm.id}-${slot}`, {
          alreadyUsedInSlot: activeRound.pnms.some(otherPnm => otherPnm.id !== pnm.id && otherPnm[slotKey] === draggedActiveId),
          chainCount,
          isOverLimit: chainCount > chainLengthLimit,
        });
      });
    });

    return warnings;
  }, [draggingType, draggingId, activeRound.pnms, activeNameById, chainLengthLimit]);

  const handlePnmImport = () => {
    if (!pnmPasteData.trim()) return;
    pushUndoState();
    const lines = pnmPasteData.split('\n').filter(line => line.trim());
    
    const newPnms: PNM[] = lines.map((line, index) => {
      let name = "";
      let idNumber = "000";
      
      const cleanLine = line.trim();
      
      // Look for a number at the start: e.g. "123 Jane Doe" or "123, Doe, Jane"
      const startMatch = cleanLine.match(/^(\d+)[\s,]+(.+)$/);
      // Look for a number at the end: e.g. "Jane Doe 123" or "Doe, Jane, 123"
      const endMatch = cleanLine.match(/^(.+?)[\s,]+(\d+)$/);
      
      if (startMatch) {
        idNumber = startMatch[1];
        name = startMatch[2];
      } else if (endMatch) {
        name = endMatch[1];
        idNumber = endMatch[2];
      } else {
        // No number found at start or end, the entire line is the name
        name = cleanLine;
        idNumber = "000";
      }

      // Remove any stray commas or spaces at the start/end of the name
      name = name.replace(/^[\s,]+|[\s,]+$/g, '').trim();
      
      return {
        id: `p_${Date.now()}_${index}_${Math.random().toString(36).substring(7)}`,
        name: name || `PNM ${activeRound.pnms.length + index + 1}`,
        idNumber,
        status: 'unmatched'
      };
    });
    
    setRounds(prev => prev.map(r => r.id === activeRoundId ? { ...r, pnms: [...r.pnms, ...newPnms] } : r));
    setPnmPasteData("");
    setIsPnmImportOpen(false);
  };

  const shuffleArray = <T,>(array: T[]) => {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  };

  const buildAutoMatchAssignments = (mode: 'random' | 'balanced') => {
    const podSize = Math.max(2, chainLengthLimit);
    const shuffledActives = shuffleArray([...actives]);
    const pods: Active[][] = [];

    for (let i = 0; i < shuffledActives.length; i += podSize) {
      pods.push(shuffledActives.slice(i, i + podSize));
    }

    const podAssignments = pods.map(pod => {
      if (pod.length === 1) {
        return [{ matchedWith: pod[0].id, secondMatch: undefined }];
      }

      const base = mode === 'random' ? shuffleArray([...pod]) : [...pod];
      const offset = mode === 'random' ? Math.floor(Math.random() * (base.length - 1)) + 1 : 1;
      const rotated = base.map((_, index) => base[(index + offset) % base.length]);

      return base.map((active, index) => ({
        matchedWith: active.id,
        secondMatch: rotated[index].id,
      }));
    });

    if (mode === 'balanced') {
      const balancedAssignments: { matchedWith?: string; secondMatch?: string }[] = [];
      let index = 0;

      while (podAssignments.some(pod => index < pod.length)) {
        podAssignments.forEach(pod => {
          if (index < pod.length) {
            balancedAssignments.push(pod[index]);
          }
        });
        index += 1;
      }

      return balancedAssignments;
    }

    return shuffleArray(podAssignments.flat());
  };

  const applyAutoMatch = (mode: 'random' | 'balanced') => {
    if (actives.length === 0 || activeRound.pnms.length === 0) {
      toast.error("Need both PNMs and Actives to auto-match", { className: "rounded-none text-xs font-bold" });
      return;
    }

    pushUndoState();
    const assignments = buildAutoMatchAssignments(mode);

    setRounds(prev => prev.map(round => {
      if (round.id !== activeRoundId) {
        return round;
      }

      return {
        ...round,
        pnms: round.pnms.map((pnm, index) => {
          const assignment = assignments[index];
          return {
            ...pnm,
            matchedWith: assignment?.matchedWith,
            secondMatch: assignment?.secondMatch,
            status: assignment?.matchedWith || assignment?.secondMatch ? 'matched' as const : 'unmatched' as const,
          };
        }),
      };
    }));

    toast.success(mode === 'balanced' ? "Balanced auto-match complete" : "Random auto-match complete", {
      className: "rounded-none text-xs font-bold bg-purple-50 text-purple-700 border-purple-200"
    });
  };

  const handleActiveImport = () => {
    if (!activePasteData.trim()) return;
    pushUndoState();
    const lines = activePasteData.split('\n');
    const newActives: Active[] = lines.map((line, index) => ({
      id: `a_${Date.now()}_${index}`,
      name: line.trim()
    })).filter(a => a.name);
    setActives(prev => [...prev, ...newActives]);
    setActivePasteData("");
    setIsActiveImportOpen(false);
  };

  const handleDeletePnm = (pnmId: string) => {
    pushUndoState();
    setRounds(prev => prev.map(r => {
      if (r.id !== activeRoundId) return r;
      return {
        ...r,
        pnms: r.pnms.filter(p => p.id !== pnmId)
      };
    }));
  };

  const handleCSVImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const parseData = (data: string[][]) => {
        let matchupsStartIndex = -1;
        let matchupsEndIndex = data.length;

        for (let i = 0; i < data.length; i++) {
          if (data[i][0] === "--- MATCHUPS ---") {
            matchupsStartIndex = i + 2; // Skip the title and the header row
          } else if (data[i][0] === "--- UNUSED ACTIVES ---" || (matchupsStartIndex !== -1 && data[i][0] === "")) {
             if(matchupsEndIndex === data.length) {
               matchupsEndIndex = i;
             }
          }
        }

        if (matchupsStartIndex === -1) {
          toast.error("Invalid format. Could not find '--- MATCHUPS ---' section.", {
            className: "rounded-none text-xs font-bold"
          });
          return;
        }

        const newPnms: PNM[] = [];
        const extractedActives = new Map<string, Active>();

        // Ensure current actives are in the map
        actives.forEach(a => extractedActives.set(a.name, a));

        for (let i = matchupsStartIndex; i < matchupsEndIndex; i++) {
          const row = data[i];
          if (!row || row.length < 4) continue;
          if (!row[0] && !row[1]) continue; // Skip empty rows

          const idNumber = String(row[0]);
          const name = String(row[1]);
          const m1Name = String(row[2]);
          const m2Name = String(row[3]);

          let m1Id = undefined;
          let m2Id = undefined;

          // Helper to get or create active
          const getOrCreateActive = (activeName: string) => {
            if (!activeName || activeName === "Unmatched" || activeName === "") return undefined;
            if (extractedActives.has(activeName)) {
              return extractedActives.get(activeName)!.id;
            }
            const newId = `a_${Date.now()}_${Math.random().toString(36).substring(7)}`;
            const newActive = { id: newId, name: activeName };
            extractedActives.set(activeName, newActive);
            return newId;
          };

          m1Id = getOrCreateActive(m1Name);
          m2Id = getOrCreateActive(m2Name);

          // Find existing PNM or create new
          const existingPnm = activeRound.pnms.find(p => p.idNumber === idNumber);
          
          if (existingPnm) {
            newPnms.push({
              ...existingPnm,
              matchedWith: m1Id,
              secondMatch: m2Id,
              status: (m1Id || m2Id) ? 'matched' : 'unmatched'
            });
          } else {
             newPnms.push({
              id: `p_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              name: name || `PNM ${newPnms.length + 1}`,
              idNumber: idNumber || `ID-${Date.now()}-${newPnms.length}`,
              matchedWith: m1Id,
              secondMatch: m2Id,
              status: (m1Id || m2Id) ? 'matched' : 'unmatched'
            });
          }
        }
        
        pushUndoState();

        // Update Actives
        setActives(Array.from(extractedActives.values()));

        // Update Round PNMs
        setRounds(prev => prev.map(r => {
          if (r.id !== activeRoundId) return r;
          
          const csvPnmIds = new Set(newPnms.map(p => p.idNumber));
          const keptPnms = r.pnms.filter(p => !csvPnmIds.has(p.idNumber));

          return {
            ...r,
            pnms: [...keptPnms, ...newPnms]
          };
        }));

        toast.success("Imported Successfully", {
          className: "rounded-none text-xs font-bold bg-green-50 text-green-700 border-green-200"
        });
        
        // reset file input
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
    };

    if (file.name.endsWith('.csv')) {
      Papa.parse(file, {
        complete: (results) => {
          parseData(results.data as string[][]);
        },
        error: (error) => {
          toast.error(`Error parsing CSV: ${error.message}`, {
            className: "rounded-none text-xs font-bold"
          });
        }
      });
    } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: "" });
          
          // Convert array of objects back to array of arrays to match our parser logic
          // XLSX header: 1 means we get an array of arrays
          const arrayData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as string[][];
          
          // Pad rows to ensure they have enough columns if some are missing
          const paddedData = arrayData.map(row => {
             const newRow = [...row];
             while(newRow.length < 4) newRow.push("");
             return newRow;
          });
          
          parseData(paddedData);
        } catch (error) {
          toast.error(`Error parsing Excel file.`, {
            className: "rounded-none text-xs font-bold"
          });
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
        toast.error(`Unsupported file type. Please upload a CSV or Excel file.`, {
          className: "rounded-none text-xs font-bold"
        });
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    setDraggingId(active.id as string);
    // Actives have IDs starting with 'a-', 'a_', or suffix like '-1' or '-2', PNMs start with 'p-' or 'p_'
    const idStr = active.id.toString();
    if (idStr.startsWith('p-') || idStr.startsWith('p_')) {
      setDraggingType('pnm');
    } else if (idStr.startsWith('a-') || idStr.startsWith('a_') || idStr.includes('-1') || idStr.includes('-2')) {
      setDraggingType('active');
    } else {
      setDraggingType('active');
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setDraggingId(null);
    setDraggingType(null);

    if (!over) return;

    if (draggingType === 'active' && over.id.toString().startsWith('drop-')) {
      const activeId = active.id as string;
      const realActiveId = activeId.split('-')[0];
      const overData = over.data.current as { pnm: PNM, slot: 1 | 2 };
      const slotKey = overData.slot === 1 ? 'matchedWith' : 'secondMatch';
      
      // Check if this specific active is already used in THIS SLOT by a DIFFERENT PNM
      const alreadyUsedInSlot = activeRound.pnms.some(p => 
        p.id !== overData.pnm.id && p[slotKey] === realActiveId
      );

      if (alreadyUsedInSlot) {
        toast.error(`This active is already used as Bump ${overData.slot} by another PNM.`, {
          className: "rounded-none text-xs font-bold",
          duration: 3000
        });
        return;
      }

      const projectedDrop = dropWarnings.get(`${overData.pnm.id}-${overData.slot}`);
      pushUndoState();

      setRounds(prev => prev.map(r => {
        if (r.id !== activeRoundId) return r;
        return {
          ...r,
          pnms: r.pnms.map(p => {
            if (p.id !== overData.pnm.id) return p;
            return {
              ...p,
              status: 'matched',
              [slotKey]: realActiveId
            };
          })
        };
      }));

      if (projectedDrop?.isOverLimit) {
        toast.warning(`This move creates a ${projectedDrop.chainCount}-person chain.`, {
          className: "rounded-none text-xs font-bold bg-amber-50 text-amber-800 border-amber-200",
          duration: 3500
        });
      }
    }

    if (draggingType === 'pnm' && active.id !== over.id) {
      pushUndoState();
      setRounds(prev => prev.map(r => {
        if (r.id !== activeRoundId) return r;
        const oldIndex = r.pnms.findIndex(p => p.id === active.id);
        const newIndex = r.pnms.findIndex(p => p.id === over.id);
        return {
          ...r,
          pnms: arrayMove(r.pnms, oldIndex, newIndex)
        };
      }));
    }
  };

  const handleUnmatch = (pnmId: string, slot: 1 | 2) => {
    pushUndoState();
    setRounds(prev => prev.map(r => {
      if (r.id !== activeRoundId) return r;
      return {
        ...r,
        pnms: r.pnms.map(p => {
          if (p.id !== pnmId) return p;
          const updated = { ...p, [slot === 1 ? 'matchedWith' : 'secondMatch']: undefined };
          updated.status = (updated.matchedWith || updated.secondMatch) ? 'matched' : 'unmatched';
          return updated;
        })
      };
    }));
  };

  const handleClearBoth = (pnmId: string) => {
    pushUndoState();
    setRounds(prev => prev.map(r => {
      if (r.id !== activeRoundId) return r;
      return {
        ...r,
        pnms: r.pnms.map(p => {
          if (p.id !== pnmId) return p;
          return { ...p, matchedWith: undefined, secondMatch: undefined, status: 'unmatched' };
        })
      };
    }));
  };

  const handleDeleteActive = (activeId: string) => {
    const activeToDelete = actives.find(active => active.id === activeId);
    if (!activeToDelete) {
      return;
    }

    const didConfirmDelete = window.confirm(`Delete ${activeToDelete.name} from the active pool and remove her from both bump assignments?`);
    if (!didConfirmDelete) {
      return;
    }

    pushUndoState();
    setActives(prev => prev.filter(active => active.id !== activeId));
    setRounds(prev => prev.map(round => ({
      ...round,
      pnms: round.pnms.map(pnm => {
        const updated = {
          ...pnm,
          matchedWith: pnm.matchedWith === activeId ? undefined : pnm.matchedWith,
          secondMatch: pnm.secondMatch === activeId ? undefined : pnm.secondMatch,
        };

        return {
          ...updated,
          status: updated.matchedWith || updated.secondMatch ? 'matched' : 'unmatched',
        };
      }),
    })));
    setHoveredActiveId(current => current === activeId ? null : current);
    setHoveredPnmId(null);
    toast.success(`${activeToDelete.name} was removed from both bump pools.`, {
      className: "rounded-none text-xs font-bold",
      duration: 2200,
    });
  };

  const generateChains = () => chainAnalysis.chains.map(chain => ({
    starterName: chain.starterName,
    handoffDisplay: chain.handoffDisplay,
  }));

  const exportToCSV = () => {
    const escapeCSV = (str: string) => {
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const pnmRows: string[][] = activeRound.pnms.map(pnm => {
      const m1 = actives.find(a => a.id === pnm.matchedWith)?.name || "Unmatched";
      const m2 = actives.find(a => a.id === pnm.secondMatch)?.name || "Unmatched";
      return [escapeCSV(pnm.idNumber), escapeCSV(pnm.name), escapeCSV(m1), escapeCSV(m2)];
    });

    const chains = generateChains();

    const finalRows: string[][] = [];
    const maxRows = Math.max(pnmRows.length, chains.length);
    for (let i = 0; i < maxRows; i++) {
      const row = pnmRows[i] || ["", "", "", ""];
      const starterName = chains[i] ? escapeCSV(chains[i].starterName) : "";
      const chainStr = chains[i] ? escapeCSV(chains[i].handoffDisplay) : "";
      finalRows.push([...row, "", starterName, chainStr]);
    }

    const unusedBump1Actives = actives
      .filter(active => !usedActivesSlot1.has(active.id))
      .map(active => escapeCSV(active.name));

    const unusedBump2Actives = actives
      .filter(active => !usedActivesSlot2.has(active.id))
      .map(active => escapeCSV(active.name));

    const completelyUnusedActives = actives
      .filter(active => !usedActivesSlot1.has(active.id) && !usedActivesSlot2.has(active.id))
      .map(active => escapeCSV(active.name));

    const unusedRows: string[][] = [];
    const maxUnusedRows = Math.max(
      unusedBump1Actives.length,
      unusedBump2Actives.length,
      completelyUnusedActives.length,
      1,
    );

    for (let i = 0; i < maxUnusedRows; i++) {
      unusedRows.push([
        unusedBump1Actives[i] || "",
        unusedBump2Actives[i] || "",
        completelyUnusedActives[i] || "",
      ]);
    }

    const csvContent = [
      ["--- MATCHUPS ---"],
      ["ID Number", "PNM Name", "Match 1", "Match 2", "", "First Switch", "Then Goes To"],
      ...finalRows,
      [""],
      ["--- UNUSED ACTIVES ---"],
      ["Unused Bump 1", "Unused Bump 2", "Completely Unused"],
      ...unusedRows,
      [""],
      ["--- ACTIVE SUMMARY (ALL ROUNDS) ---"],
      ["Name", "Total Conversations"],
      ...activeSummary.map(a => [escapeCSV(a.name), String(a.count)])
    ].map(e => e.join(",")).join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `${activeRound.name}_matches.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── Snapshot functions ────────────────────────────────────────────────────

  const loadSnapshots = async () => {
    try {
      const res = await fetch("/api/snapshots");
      const data = await res.json();
      setSnapshotList(data);
    } catch {
      toast.error("Could not load snapshots");
    }
  };

  const handleSaveSnapshot = async () => {
    const label = snapshotLabel.trim();
    if (!label) return;
    setIsSavingSnapshot(true);
    try {
      const payload = {
        rounds: rounds.map((r, i) => ({
          id: r.id,
          name: r.name,
          sortOrder: r.sortOrder ?? i,
          pnms: r.pnms.map(p => ({
            id: p.id,
            name: p.name,
            idNumber: p.idNumber,
            matchedWith: p.matchedWith ?? null,
            secondMatch: p.secondMatch ?? null,
          })),
        })),
        actives: actives.map(a => ({ id: a.id, name: a.name })),
        activeRoundId,
        chainLengthLimit,
      };
      const res = await fetch("/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, payload }),
      });
      if (!res.ok) throw new Error();
      setSnapshotLabel("");
      toast.success(`Snapshot "${label}" saved`);
      await loadSnapshots();
    } catch {
      toast.error("Failed to save snapshot");
    } finally {
      setIsSavingSnapshot(false);
    }
  };

  const handleRestoreSnapshot = async (id: string) => {
    try {
      const res = await fetch(`/api/snapshots/${id}/restore`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();

      // Pause autosave while we apply restored state
      isInitializedRef.current = false;

      const loadedRounds: RoundData[] = (data.rounds ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        sortOrder: r.sortOrder,
        pnms: r.pnms.map((p: any) => ({
          id: p.id,
          name: p.name,
          idNumber: p.idNumber,
          matchedWith: p.matchedWith ?? undefined,
          secondMatch: p.secondMatch ?? undefined,
          status: (p.matchedWith || p.secondMatch) ? 'matched' : 'unmatched',
        } as PNM)),
      }));

      setRounds(loadedRounds);
      setActives(data.actives ?? []);
      setActiveRoundId(data.activeRoundId ?? loadedRounds[0]?.id ?? "");
      if (data.chainLengthLimit) setChainLengthLimit(data.chainLengthLimit);

      setIsSnapshotsOpen(false);
      toast.success("Snapshot restored");

      // Resume autosave after the restored state has settled
      setTimeout(() => { isInitializedRef.current = true; }, 0);
    } catch {
      toast.error("Failed to restore snapshot");
    }
  };

  const handleDeleteSnapshot = async (id: string) => {
    try {
      const res = await fetch(`/api/snapshots/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setSnapshotList(prev => prev.filter(s => s.id !== id));
      toast.success("Snapshot deleted");
    } catch {
      toast.error("Failed to delete snapshot");
    }
  };

  const saveState = async () => {
    setIsSaving(true);
    try {
      // Build the body the API expects.
      // PNMs stay nested inside their round — storage.ts flattens them server-side.
      // Strip the frontend-only `status` field; derive round's sortOrder from its index.
      const body = {
        rounds: rounds.map((r, i) => ({
          id: r.id,
          name: r.name,
          sortOrder: r.sortOrder ?? i,
          pnms: r.pnms.map(p => ({
            id: p.id,
            name: p.name,
            idNumber: p.idNumber,
            matchedWith: p.matchedWith ?? null,
            secondMatch: p.secondMatch ?? null,
          })),
        })),
        actives: actives.map(a => ({ id: a.id, name: a.name })),
        activeRoundId,
        chainLengthLimit,
      };

      const res = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorData = await res.json();
        console.error("SAVE ERROR:", errorData);
        throw new Error(errorData.details || errorData.error || "Server error");
      }
      toast.success("Saved to database");
    } catch (err) {
      console.error(err);
      toast.error("Save failed — " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  const activeSummary = useMemo(() => {
    const conversations: Record<string, { pnmName: string; roundName: string }[]> = {};
    actives.forEach(a => { conversations[a.id] = []; });
    rounds.forEach(round => {
      round.pnms.forEach(pnm => {
        if (pnm.matchedWith && conversations[pnm.matchedWith] !== undefined) {
          conversations[pnm.matchedWith].push({ pnmName: pnm.name, roundName: round.name });
        }
        if (pnm.secondMatch && conversations[pnm.secondMatch] !== undefined) {
          conversations[pnm.secondMatch].push({ pnmName: pnm.name, roundName: round.name });
        }
      });
    });
    return actives
      .map(a => ({ id: a.id, name: a.name, count: conversations[a.id].length, pnms: conversations[a.id] }))
      .sort((a, b) => b.count - a.count);
  }, [rounds, actives]);

  const filteredPnms = activeRound.pnms.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.idNumber.includes(searchTerm));

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96)_38%,_rgba(241,245,249,1))] font-sans text-slate-600 text-[13px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-slate-400 tracking-wide uppercase text-[10px] font-semibold">Loading planner…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96)_38%,_rgba(241,245,249,1))] flex flex-col font-sans overflow-hidden text-[12px] text-slate-800">
      <header className="border-b border-slate-200/80 bg-white/90 px-4 py-2.5 flex items-center justify-between gap-4 shrink-0 backdrop-blur-xl shadow-[0_14px_28px_-24px_rgba(15,23,42,0.45)]">
        {/* LEFT: app name + round controls */}
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <div className="flex flex-col leading-tight shrink-0">
            <span className="text-[17px] font-semibold text-slate-900 tracking-tight">MatchOps</span>
            <span className="text-[10px] text-slate-400 tracking-wide">Recruitment Matching System</span>
          </div>

          <div className="h-6 w-px bg-slate-200 mx-1 shrink-0" />

          {/* Round selector dropdown */}
          <select
            value={activeRoundId}
            onChange={e => setActiveRoundId(e.target.value)}
            className="h-8 border border-slate-200 bg-white text-[11px] px-2 text-slate-700 shadow-sm focus:outline-none focus:ring-1 focus:ring-violet-400 cursor-pointer"
            data-testid="select-round"
          >
            {rounds.map(r => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>

          {/* Inline round name editor */}
          <Input
            value={activeRound.name}
            onChange={e => handleRoundNameChange(e.target.value)}
            onBlur={handleRoundNameBlur}
            className="h-8 w-36 rounded-none border-slate-200 bg-slate-50/90 text-[12px] shadow-none"
            data-testid="input-round-name"
          />

          {/* Add Round */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddRound}
            className="h-8 px-3 rounded-none text-[11px] border-slate-200 text-slate-600 hover:bg-slate-100"
            data-testid="button-add-round"
          >
            + Add Round
          </Button>

          {/* Clear Round PNMs */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearRound}
            className="h-8 px-2.5 rounded-none text-slate-400 hover:text-amber-600 hover:bg-amber-50 text-[11px] font-medium"
            data-testid="button-clear-round"
            title={`Clear all PNMs from ${activeRound.name}`}
          >
            Clear Round
          </Button>

          {/* Delete Round */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDeleteRound}
            className="h-8 w-8 p-0 rounded-none text-slate-400 hover:text-red-500 hover:bg-red-50"
            data-testid="button-delete-round"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* RIGHT: Save + Undo */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={saveState}
            disabled={isSaving}
            className="h-7 rounded-none border-emerald-700 bg-emerald-600 px-2.5 text-[10px] font-semibold text-white shadow-[0_12px_24px_-18px_rgba(5,150,105,0.55)] hover:bg-emerald-500 hover:text-white disabled:opacity-60"
            data-testid="button-save-state"
          >
            <Save className="mr-1.5 h-3 w-3" />
            {isSaving ? "Saving…" : "Save"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="h-7 rounded-none border-violet-950 bg-violet-900 px-2.5 text-[10px] font-semibold text-white shadow-[0_12px_24px_-18px_rgba(76,29,149,0.65)] hover:bg-violet-800 hover:text-white disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
            data-testid="button-undo-action"
          >
            <RotateCcw className="mr-1.5 h-3 w-3" />
            Undo · Ctrl/⌘Z
          </Button>
        </div>
      </header>

      <DndContext 
        sensors={sensors} 
        onDragStart={handleDragStart} 
        onDragEnd={handleDragEnd}
        collisionDetection={closestCenter}
      >
        <div className="flex-1 flex overflow-hidden p-2 gap-2">
          <aside className={`border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.92))] shadow-[0_20px_40px_-30px_rgba(15,23,42,0.3)] transition-all duration-200 ${isToolsMenuOpen ? 'w-60' : 'w-14'}`}>
            <div className="h-full flex flex-col">
              <div className="border-b border-slate-200/80 p-3 flex items-center justify-between gap-2 bg-white/60 backdrop-blur-sm">
                {isToolsMenuOpen ? (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Controls</p>
                    <p className="text-[11px] text-slate-500">Tools for {activeRound.name}</p>
                  </div>
                ) : (
                  <div className="w-5" />
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-none"
                  onClick={() => setIsToolsMenuOpen(prev => !prev)}
                  data-testid="button-toggle-tools-menu"
                >
                  {isToolsMenuOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </Button>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-2.5 space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className={`h-10 text-[11px] rounded-none border w-full shadow-[0_12px_24px_-22px_rgba(15,23,42,0.45)] ${isToolsMenuOpen ? 'justify-start px-3.5' : 'justify-center px-0'} ${isLinkedHoverEnabled ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800 hover:text-white' : 'bg-white/90 text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                    onClick={() => {
                      setIsLinkedHoverEnabled(prev => !prev);
                      setHoveredActiveId(null);
                      setHoveredPnmId(null);
                    }}
                    data-testid="button-toggle-linked-hover"
                  >
                    <GitMerge className={`w-3 h-3 ${isToolsMenuOpen ? 'mr-2' : ''}`} />
                    {isToolsMenuOpen ? (isLinkedHoverEnabled ? 'Linked Hover On' : 'Linked Hover Off') : null}
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className={`h-10 text-[11px] rounded-none w-full bg-slate-800 hover:bg-slate-700 border-slate-800 text-white hover:text-white shadow-[0_12px_24px_-22px_rgba(15,23,42,0.45)] ${isToolsMenuOpen ? 'justify-start px-3.5' : 'justify-center px-0'}`} data-testid="button-actions-menu">
                        <Settings2 className={`w-3 h-3 ${isToolsMenuOpen ? 'mr-2' : ''}`} />
                        {isToolsMenuOpen ? 'Actions' : null}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start" className="w-56 rounded-none shadow-xl border-slate-200">
                      <DropdownMenuItem onClick={() => applyAutoMatch('random')} className="text-xs cursor-pointer rounded-none focus:bg-purple-50 focus:text-purple-700 py-2" data-testid="button-auto-match-random">
                        <Wand2 className="w-3.5 h-3.5 mr-2" />
                        <div className="flex flex-col">
                          <span className="font-semibold">Auto-Match (Random)</span>
                          <span className="text-[10px] text-slate-500">Random pod matching capped by the chain limit</span>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => applyAutoMatch('balanced')} className="text-xs cursor-pointer rounded-none focus:bg-blue-50 focus:text-blue-700 py-2" data-testid="button-auto-match-balanced">
                        <GitMerge className="w-3.5 h-3.5 mr-2" />
                        <div className="flex flex-col">
                          <span className="font-semibold">Auto-Match (Balanced)</span>
                          <span className="text-[10px] text-slate-500">Short chains with a more even spread across pods</span>
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button variant="outline" size="sm" className={`h-10 text-[11px] rounded-none w-full bg-green-50/95 hover:bg-green-100 border-green-200 text-green-700 shadow-[0_12px_24px_-22px_rgba(34,197,94,0.35)] ${isToolsMenuOpen ? 'justify-start px-3.5' : 'justify-center px-0'}`} onClick={exportToCSV} data-testid="button-export-csv">
                    <Download className={`w-3 h-3 ${isToolsMenuOpen ? 'mr-2' : ''}`} />
                    {isToolsMenuOpen ? 'Export CSV' : null}
                  </Button>

                  <Dialog open={isBumpChainsOpen} onOpenChange={setIsBumpChainsOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className={`h-10 text-[11px] rounded-none w-full bg-purple-50/95 hover:bg-purple-100 border-purple-200 text-purple-700 shadow-[0_12px_24px_-22px_rgba(168,85,247,0.35)] ${isToolsMenuOpen ? 'justify-start px-3.5' : 'justify-center px-0'}`} data-testid="button-view-chains">
                        <ListOrdered className={`w-3 h-3 ${isToolsMenuOpen ? 'mr-2' : ''}`} />
                        {isToolsMenuOpen ? 'View Chains' : null}
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col rounded-none">
                      <DialogHeader>
                        <DialogTitle>Current Bump Chains</DialogTitle>
                        <DialogDescription>
                          Read each chain left to right. Each name should switch with the next name to her right.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="flex items-center justify-between gap-3 px-0 py-2 border-b">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-600">Chain Limit Alert:</span>
                          <input 
                            type="number" 
                            min="2" 
                            max="20" 
                            value={chainLengthLimit} 
                            onChange={(e) => {
                              pushUndoState();
                              setChainLengthLimit(Math.max(2, Number(e.target.value) || 2));
                            }}
                            className="w-16 h-7 border px-2 text-xs"
                            data-testid="input-chain-limit"
                          />
                          <span className="text-[10px] text-slate-500">actives per chain</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                          <span data-testid="text-longest-chain">Longest {chainAnalysis.longestChainCount || 0}</span>
                          <span>•</span>
                          <span data-testid="text-chains-over-limit">Over limit {chainAnalysis.overLimitCount}</span>
                        </div>
                      </div>
                      <ScrollArea className="flex-1 -mx-4 px-4 py-2">
                        {chainAnalysis.chains.length > 0 ? (
                          <div className="space-y-2">
                            {chainAnalysis.chains.map((chain, idx) => (
                              <div key={idx} className={`p-3 bg-slate-50 border text-sm font-medium shadow-sm flex items-start justify-between gap-4 ${chain.isOverLimit ? 'border-red-300 bg-red-50' : 'border-slate-100 text-slate-700'}`}>
                                <div className={`flex flex-wrap items-center ${chain.isOverLimit ? 'text-red-800' : ''}`}>
                                  <span className={`font-bold ${chain.isOverLimit ? 'text-red-700' : 'text-slate-800'}`}>{chain.starterName}</span>
                                  <span className={chain.isOverLimit ? 'text-red-300 px-1' : 'text-slate-300 px-1'}>→</span>
                                  <span className={chain.isOverLimit ? 'text-red-700' : 'text-slate-500'}>{chain.handoffDisplay}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {chain.isOverLimit && <AlertTriangle className="w-4 h-4 text-red-500" />}
                                  <Badge variant="outline" className={`text-[10px] rounded-none ${chain.isOverLimit ? 'bg-red-100 text-red-700 border-red-200' : ''}`}>
                                    {chain.count}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                            <ListOrdered className="w-8 h-8 mb-2 opacity-50" />
                            <p className="text-sm">No complete bump chains found yet.</p>
                            <p className="text-xs">Match more PNMs to generate chains.</p>
                          </div>
                        )}
                      </ScrollArea>
                    </DialogContent>
                  </Dialog>

                  <Button variant="outline" size="sm" className={`h-10 text-[11px] rounded-none w-full bg-blue-50/95 hover:bg-blue-100 border-blue-200 text-blue-700 shadow-[0_12px_24px_-22px_rgba(59,130,246,0.35)] ${isToolsMenuOpen ? 'justify-start px-3.5' : 'justify-center px-0'}`} onClick={() => fileInputRef.current?.click()} data-testid="button-import-csv">
                    <Upload className={`w-3 h-3 ${isToolsMenuOpen ? 'mr-2' : ''}`} />
                    {isToolsMenuOpen ? 'Import CSV' : null}
                  </Button>
                  <input 
                    type="file" 
                    accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" 
                    className="hidden" 
                    ref={fileInputRef} 
                    onChange={handleCSVImport} 
                  />

                  <Dialog open={isSnapshotsOpen} onOpenChange={(open) => { setIsSnapshotsOpen(open); if (open) loadSnapshots(); }}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className={`h-10 text-[11px] rounded-none w-full bg-amber-50/95 hover:bg-amber-100 border-amber-200 text-amber-700 shadow-[0_12px_24px_-22px_rgba(245,158,11,0.35)] ${isToolsMenuOpen ? 'justify-start px-3.5' : 'justify-center px-0'}`} data-testid="button-open-snapshots">
                        <BookMarked className={`w-3 h-3 ${isToolsMenuOpen ? 'mr-2' : ''}`} />
                        {isToolsMenuOpen ? 'Snapshots' : null}
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col rounded-none">
                      <DialogHeader>
                        <DialogTitle>Snapshots</DialogTitle>
                        <DialogDescription>Save and restore named copies of the full planner state.</DialogDescription>
                      </DialogHeader>

                      {/* Save new snapshot */}
                      <div className="flex gap-2 pt-1 pb-3 border-b border-slate-100">
                        <Input
                          placeholder="Snapshot name…"
                          value={snapshotLabel}
                          onChange={e => setSnapshotLabel(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && handleSaveSnapshot()}
                          className="h-8 rounded-none text-[12px]"
                          data-testid="input-snapshot-label"
                        />
                        <Button
                          size="sm"
                          onClick={handleSaveSnapshot}
                          disabled={!snapshotLabel.trim() || isSavingSnapshot}
                          className="h-8 rounded-none bg-amber-500 hover:bg-amber-600 text-white border-none shrink-0 text-[11px]"
                          data-testid="button-save-snapshot"
                        >
                          {isSavingSnapshot ? "Saving…" : "Save Snapshot"}
                        </Button>
                      </div>

                      {/* Snapshot list */}
                      <ScrollArea className="flex-1 -mx-1 px-1">
                        {snapshotList.length === 0 ? (
                          <p className="text-center text-[11px] text-slate-400 py-8">No snapshots yet</p>
                        ) : (
                          <div className="space-y-1.5 py-1">
                            {snapshotList.map(snap => (
                              <div key={snap.id} className="flex items-center justify-between gap-2 border border-slate-100 bg-slate-50/80 px-3 py-2">
                                <div className="min-w-0">
                                  <p className="text-[12px] font-semibold text-slate-800 truncate" data-testid={`text-snapshot-label-${snap.id}`}>{snap.label}</p>
                                  <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                                    <Clock className="w-2.5 h-2.5" />
                                    {new Date(snap.createdAt).toLocaleString()}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleRestoreSnapshot(snap.id)}
                                    className="h-6 px-2 rounded-none text-[10px] border-violet-300 text-violet-700 hover:bg-violet-50"
                                    data-testid={`button-restore-snapshot-${snap.id}`}
                                  >
                                    Restore
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleDeleteSnapshot(snap.id)}
                                    className="h-6 w-6 p-0 rounded-none text-slate-400 hover:text-red-500"
                                    data-testid={`button-delete-snapshot-${snap.id}`}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </ScrollArea>
                    </DialogContent>
                  </Dialog>


                </div>
              </ScrollArea>
            </div>
          </aside>

          <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
          <ResizablePanel defaultSize={70} minSize={40}>
            <div className="h-full flex flex-col bg-white/92 border border-slate-200/80 shadow-[0_20px_40px_-30px_rgba(15,23,42,0.28)] overflow-hidden">

              {/* View tabs */}
              <div className="flex border-b border-slate-200/80 shrink-0 bg-white/95 px-1">
                <button onClick={() => setActiveView('planner')} className={`px-4 py-2.5 text-[11px] font-semibold border-b-2 transition-colors ${activeView === 'planner' ? 'border-violet-500 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`} data-testid="tab-planner">Planner</button>
                <button onClick={() => setActiveView('summary')} className={`px-4 py-2.5 text-[11px] font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${activeView === 'summary' ? 'border-violet-500 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`} data-testid="tab-active-summary"><BarChart2 className="w-3 h-3" />Active Summary</button>
                <button onClick={() => setActiveView('reviews')} className={`px-4 py-2.5 text-[11px] font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${activeView === 'reviews' ? 'border-violet-500 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`} data-testid="tab-reviews"><Star className="w-3 h-3" />Comments</button>
              </div>

              {activeView === 'planner' && (<>
              <div className="px-3 py-2.5 border-b border-slate-200/80 flex items-center justify-between gap-3 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.86))] shrink-0">
                <div className="flex items-center gap-2.5 flex-1 flex-wrap">
                  <div className="h-8 w-8 border border-slate-200 bg-white flex items-center justify-center shadow-sm shrink-0">
                    <Search className="h-3.5 w-3.5 text-slate-500" />
                  </div>
                  <Input placeholder="Search PNMs..." className="h-8 text-[12px] max-w-xs py-0 rounded-none border-slate-200 bg-white/95 shadow-none" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} data-testid="input-search-pnms" />
                  <div className="h-8 border border-violet-200 bg-violet-50/80 px-3 flex items-center gap-2 shadow-[0_10px_20px_-18px_rgba(91,33,182,0.45)]">
                    <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-violet-500">Round Progress</span>
                    <span className="text-[11px] font-semibold text-violet-800" data-testid="text-round-match-summary">
                      {activeRound.pnms.filter((pnm) => pnm.matchedWith && pnm.secondMatch).length} / {activeRound.pnms.length} fully matched
                    </span>
                  </div>
                  <Dialog open={isPnmImportOpen} onOpenChange={setIsPnmImportOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 rounded-none border-slate-200 bg-white/95 px-3 text-[11px] text-slate-700 shadow-[0_12px_24px_-22px_rgba(15,23,42,0.35)] hover:bg-slate-50" data-testid="button-import-pnms">
                        <ClipboardPaste className="mr-2 h-3 w-3" />
                        Import PNMs
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md rounded-none">
                      <DialogHeader><DialogTitle>Import PNMs to {activeRound.name}</DialogTitle><DialogDescription>Format: Name, ID Number (one per line)</DialogDescription></DialogHeader>
                      <Textarea placeholder="Jane Doe, 12345" className="min-h-[200px] text-xs rounded-none" value={pnmPasteData} onChange={(e) => setPnmPasteData(e.target.value)} />
                      <Button onClick={handlePnmImport} className="w-full h-8 text-xs rounded-none">Add PNMs to Round</Button>
                    </DialogContent>
                  </Dialog>
                  <Dialog open={isActiveImportOpen} onOpenChange={setIsActiveImportOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 rounded-none border-slate-200 bg-white/95 px-3 text-[11px] text-slate-700 shadow-[0_12px_24px_-22px_rgba(15,23,42,0.35)] hover:bg-slate-50" data-testid="button-import-actives">
                        <Users className="mr-2 h-3 w-3" />
                        Import Actives
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md rounded-none">
                      <DialogHeader><DialogTitle>Import Active Members</DialogTitle><DialogDescription>Paste names (one per line)</DialogDescription></DialogHeader>
                      <Textarea placeholder="Sarah Jenkins&#10;Jessica Reynolds" className="min-h-[200px] text-xs rounded-none" value={activePasteData} onChange={(e) => setActivePasteData(e.target.value)} />
                      <Button onClick={handleActiveImport} className="w-full h-8 text-xs rounded-none">Add Actives</Button>
                    </DialogContent>
                  </Dialog>
                </div>
                <Badge variant="outline" className="text-[10px] h-6 px-2 rounded-none border-slate-200 bg-slate-50/90 text-slate-600">{activeRound.pnms.length} PNMs</Badge>
              </div>
              
              <ScrollArea className="flex-1">
                <Table className="rounded-none">
                  <TableHeader className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur-md shadow-[inset_0_-1px_0_rgba(226,232,240,0.95)]">
                    <TableRow className="sticky top-0 z-20 border-b border-slate-200/90 bg-slate-50/95 hover:bg-slate-50/95">
                      <TableHead className="w-8 bg-slate-50/95"></TableHead>
                      <TableHead className="py-1 h-8 text-[10px] uppercase font-bold bg-slate-50/95">Status</TableHead>
                      <TableHead className="py-1 h-8 text-[10px] uppercase font-bold bg-slate-50/95">PNM Name & ID</TableHead>
                      <TableHead className="py-1 h-8 text-[10px] uppercase font-bold bg-slate-50/95">Bump Match 1</TableHead>
                      <TableHead className="py-1 h-8 text-[10px] uppercase font-bold bg-slate-50/95">Bump Match 2</TableHead>
                      <TableHead className="py-1 h-8 text-[10px] uppercase font-bold w-10 bg-slate-50/95"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPnms.length > 0 ? (
                      <SortableContext 
                        items={filteredPnms.map(p => p.id)} 
                        strategy={verticalListSortingStrategy}
                      >
                        {filteredPnms.map((pnm, index) => {
                          const isHighlighted = Boolean(
                            (pnm.matchedWith && highlightedActiveIds.has(pnm.matchedWith)) ||
                            (pnm.secondMatch && highlightedActiveIds.has(pnm.secondMatch))
                          );

                          return (
                            <SortablePNMRow 
                              key={pnm.id} 
                              pnm={pnm} 
                              pnms={activeRound.pnms}
                              actives={actives} 
                              rowIndex={index}
                              onUnmatch={handleUnmatch}
                              onClearBoth={handleClearBoth}
                              onDelete={handleDeletePnm}
                              onHoverStart={() => setHoveredPnmId(pnm.id)}
                              onHoverEnd={() => setHoveredPnmId(current => current === pnm.id ? null : current)}
                              isHighlighted={isHighlighted}
                              isDimmed={hasLinkedHighlight && !isHighlighted}
                              dropPreview1={dropWarnings.get(`${pnm.id}-1`)}
                              dropPreview2={dropWarnings.get(`${pnm.id}-2`)}
                              highlightedActiveIds={highlightedActiveIds}
                            />
                          );
                        })}
                      </SortableContext>
                    ) : (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={6} className="py-12">
                          <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 border border-dashed border-slate-200 bg-slate-50/70 px-6 py-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">{searchTerm ? 'No results' : 'No PNMs yet'}</div>
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-slate-700" data-testid="text-pnm-empty-state-title">
                                {searchTerm ? `No PNMs match “${searchTerm}”.` : `This round doesn't have any PNMs yet.`}
                              </p>
                              <p className="text-[11px] text-slate-500" data-testid="text-pnm-empty-state-description">
                                {searchTerm ? 'Try a different name or ID, or clear the search to see the full list.' : 'Import a list to start assigning bump matches for this round.'}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {searchTerm ? (
                                <Button variant="outline" size="sm" className="h-8 rounded-none px-3 text-[11px]" onClick={() => setSearchTerm('')} data-testid="button-clear-pnm-search">
                                  Clear Search
                                </Button>
                              ) : (
                                <Button variant="outline" size="sm" className="h-8 rounded-none px-3 text-[11px]" onClick={() => setIsPnmImportOpen(true)} data-testid="button-empty-import-pnms">
                                  Import PNMs
                                </Button>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </ScrollArea>
              </>)}
              {activeView === 'summary' && (
                /* ── Active Summary Tab ── */
                <>
                <div className="px-3 py-2 border-b border-slate-200/80 shrink-0 flex items-center gap-2 bg-white/95">
                  <Search className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <input
                    className="flex-1 text-[12px] bg-transparent outline-none placeholder:text-slate-400 text-slate-800"
                    placeholder="Search actives…"
                    value={summarySearch}
                    onChange={e => setSummarySearch(e.target.value)}
                    data-testid="input-summary-search"
                  />
                  {summarySearch && <button onClick={() => setSummarySearch("")} className="text-[10px] text-slate-400 hover:text-slate-600">✕</button>}
                </div>
                <ScrollArea className="flex-1">
                  <Table className="rounded-none">
                    <TableHeader className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur-md shadow-[inset_0_-1px_0_rgba(226,232,240,0.95)]">
                      <TableRow className="border-b border-slate-200/90 bg-slate-50/95 hover:bg-slate-50/95">
                        <TableHead className="py-1 h-8 text-[10px] uppercase font-bold bg-slate-50/95 w-40">Active</TableHead>
                        <TableHead className="py-1 h-8 text-[10px] uppercase font-bold bg-slate-50/95 w-20">Convos</TableHead>
                        <TableHead className="py-1 h-8 text-[10px] uppercase font-bold bg-slate-50/95">PNMs Talked To (All Rounds)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeSummary.filter(a => a.name.toLowerCase().includes(summarySearch.toLowerCase())).length === 0 ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={3} className="py-10 text-center text-[11px] text-slate-400">{activeSummary.length === 0 ? 'No actives imported yet.' : 'No actives match your search.'}</TableCell>
                        </TableRow>
                      ) : activeSummary.filter(a => a.name.toLowerCase().includes(summarySearch.toLowerCase())).map(a => (
                        <TableRow key={a.id} className="align-top" data-testid={`row-summary-${a.id}`}>
                          <TableCell className="py-2.5 text-[12px] font-semibold text-slate-800 whitespace-nowrap">{a.name}</TableCell>
                          <TableCell className="py-2.5">
                            <span className={`inline-flex items-center justify-center h-6 min-w-[24px] px-1.5 text-[11px] font-bold rounded-sm ${a.count === 0 ? 'bg-slate-100 text-slate-400' : 'bg-violet-100 text-violet-700'}`} data-testid={`text-summary-count-${a.id}`}>{a.count}</span>
                          </TableCell>
                          <TableCell className="py-2.5">
                            {a.pnms.length === 0 ? (
                              <span className="text-[11px] text-slate-300">—</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {a.pnms.map((p, i) => (
                                  <span key={i} className="inline-flex items-center gap-1 text-[10px] bg-slate-100 px-1.5 py-0.5 text-slate-700" data-testid={`chip-pnm-${a.id}-${i}`}>
                                    {p.pnmName}
                                    <span className="text-slate-400 text-[9px]">· {p.roundName}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
                </>
              )}
              {activeView === 'reviews' && (
                <ReviewsTab
                  rounds={rounds}
                  actives={actives}
                  reviews={reviews}
                  setReviews={setReviews}
                  expandedPnmId={expandedPnmId}
                  setExpandedPnmId={setExpandedPnmId}
                  reviewDraft={reviewDraft}
                  setReviewDraft={setReviewDraft}
                  savingReviewId={savingReviewId}
                  setSavingReviewId={setSavingReviewId}
                  commentsSearch={commentsSearch}
                  setCommentsSearch={setCommentsSearch}
                />
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle className="w-2 bg-slate-100 hover:bg-slate-200 transition-colors" />

          <ResizablePanel defaultSize={30} minSize={20}>
            <div className="h-full min-w-[220px] bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,250,252,0.92))] border border-slate-200/80 shadow-[0_20px_40px_-30px_rgba(15,23,42,0.28)] p-2.5 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-3 px-0.5 shrink-0">
                <div>
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">Active Pool</h3>
                  <p className="text-[10px] text-slate-400 mt-0.5">Right-click an active to edit the pool.</p>
                </div>
                <div className="flex gap-2 items-center">
                  <button
                    onClick={handleClearActivePool}
                    className="h-7 px-2 text-[10px] font-semibold text-slate-400 hover:text-red-500 hover:bg-red-50 border border-slate-200 bg-white transition-colors"
                    data-testid="button-clear-active-pool"
                    title="Remove all actives from the pool"
                  >
                    Clear Pool
                  </button>
                  <div className="h-7 w-7 border border-slate-200 bg-white flex items-center justify-center shadow-sm"><UserCheck className="h-3 w-3 text-slate-400" /></div>
                </div>
              </div>
              
              <div className="flex-1 flex gap-2 overflow-hidden">
                <div className="flex-1 flex flex-col overflow-hidden border border-sky-200/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,0.96))] shadow-[0_12px_24px_-22px_rgba(15,23,42,0.22)]">
                  <div className="flex items-center justify-between gap-2 py-2 px-2.5 border-b border-sky-100 shrink-0 bg-sky-50/70">
                    <div>
                      <div className="text-[8px] font-bold text-sky-700 uppercase tracking-[0.18em]">M1 Pool</div>
                      <div className="text-[9px] text-slate-500">{usedActivesSlot1.size} matched · {actives.length - usedActivesSlot1.size} open</div>
                    </div>
                    <Badge variant="outline" className="h-5 rounded-none border-sky-200 bg-white px-1.5 text-[9px] text-sky-700">{actives.length}</Badge>
                  </div>
                  <ScrollArea 
                    className="flex-1"
                    viewportRef={pool1Ref}
                  >
                    <div className="space-y-1.5 p-2 pb-4">
                      {actives.map(active => {
                        const isHighlighted = highlightedActiveIds.has(active.id);
                        return (
                          <ActiveDraggable
                            key={`${active.id}-1`}
                            active={{ ...active, id: `${active.id}-1` }}
                            isMatched={usedActivesSlot1.has(active.id)}
                            isHighlighted={isHighlighted}
                            isDimmed={hasLinkedHighlight && !isHighlighted}
                            onHoverStart={() => setHoveredActiveId(active.id)}
                            onHoverEnd={() => setHoveredActiveId(current => current === active.id ? null : current)}
                            onRightClick={(event) => {
                              event.preventDefault();
                              handleDeleteActive(active.id);
                            }}
                          />
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
                <div className="w-px bg-slate-200/80 shrink-0" />
                <div className="flex-1 flex flex-col overflow-hidden border border-violet-200/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,0.96))] shadow-[0_12px_24px_-22px_rgba(15,23,42,0.22)]">
                  <div className="flex items-center justify-between gap-2 py-2 px-2.5 border-b border-violet-100 shrink-0 bg-violet-50/70">
                    <div>
                      <div className="text-[8px] font-bold text-violet-700 uppercase tracking-[0.18em]">M2 Pool</div>
                      <div className="text-[9px] text-slate-500">{usedActivesSlot2.size} matched · {actives.length - usedActivesSlot2.size} open</div>
                    </div>
                    <Badge variant="outline" className="h-5 rounded-none border-violet-200 bg-white px-1.5 text-[9px] text-violet-700">{actives.length}</Badge>
                  </div>
                  <ScrollArea 
                    className="flex-1"
                    viewportRef={pool2Ref}
                  >
                    <div className="space-y-1.5 p-2 pb-4">
                      {actives.map(active => {
                        const isHighlighted = highlightedActiveIds.has(active.id);
                        return (
                          <ActiveDraggable
                            key={`${active.id}-2`}
                            active={{ ...active, id: `${active.id}-2` }}
                            isMatched={usedActivesSlot2.has(active.id)}
                            isHighlighted={isHighlighted}
                            isDimmed={hasLinkedHighlight && !isHighlighted}
                            onHoverStart={() => setHoveredActiveId(active.id)}
                            onHoverEnd={() => setHoveredActiveId(current => current === active.id ? null : current)}
                            onRightClick={(event) => {
                              event.preventDefault();
                              handleDeleteActive(active.id);
                            }}
                          />
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              </div>

            </div>
          </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        <DragOverlay dropAnimation={{
          sideEffects: defaultDropAnimationSideEffects({
            styles: {
              active: {
                opacity: '0.5',
              },
            },
          }),
        }}>
          {draggingId ? (
            draggingType === 'pnm' ? (
              <div className="w-full bg-white/95 border border-slate-200 shadow-[0_22px_44px_-24px_rgba(15,23,42,0.4)] opacity-95 p-2.5 text-xs font-semibold text-slate-800 rounded-none backdrop-blur-sm">
                {activeRound.pnms.find(p => p.id === draggingId)?.name}
              </div>
            ) : (
              <div className="py-1.5 px-2.5 border border-slate-200 bg-white/95 text-[12px] font-semibold text-slate-800 shadow-[0_22px_44px_-24px_rgba(15,23,42,0.4)] opacity-95 scale-105 rounded-none backdrop-blur-sm">
                {actives.find(a => a.id === draggingId.split('-')[0])?.name}
              </div>
            )
          ) : null}
        </DragOverlay>
      </DndContext>
      <Toaster position="top-center" richColors />
    </div>
  );
}
