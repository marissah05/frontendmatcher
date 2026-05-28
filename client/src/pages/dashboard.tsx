import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from "react";
import {
  loadState as idbLoadState,
  saveState as idbSaveState,
  loadReviews as idbLoadReviews,
  upsertReview as idbUpsertReview,
  deleteReviewById as idbDeleteReview,
  listSnapshots as idbListSnapshots,
  createSnapshot as idbCreateSnapshot,
  getSnapshotPayload,
  deleteSnapshotById,
  exportFullBackup,
  importFullBackup,
} from "@/lib/localStore";
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

interface DayData {
  id: string;
  name: string;
  rounds: RoundData[];
}

// ── MasterSummaryView component ───────────────────────────────────────────────
function MasterSummaryView({ days, actives }: { days: DayData[]; actives: Active[] }) {
  const activeIdSet = useMemo(() => new Set(actives.map(a => a.id)), [actives]);
  const DAY_THEME: Record<string, { border: string; bg: string; dot: string; text: string; bar: string }> = {
    sisterhood:   { border: "border-violet-200", bg: "bg-violet-50/60", dot: "bg-violet-500", text: "text-violet-700", bar: "bg-violet-500" },
    philanthropy: { border: "border-rose-200",   bg: "bg-rose-50/60",   dot: "bg-rose-500",   text: "text-rose-700",   bar: "bg-rose-500" },
    preference:   { border: "border-amber-200",  bg: "bg-amber-50/60",  dot: "bg-amber-500",  text: "text-amber-700",  bar: "bg-amber-500" },
  };

  const isMatched = (id: string | undefined | null) => !!id && activeIdSet.has(id);

  const totalRounds  = days.reduce((s, d) => s + d.rounds.length, 0);
  const totalPnms    = days.reduce((s, d) => s + d.rounds.reduce((rs, r) => rs + r.pnms.length, 0), 0);
  const totalMatched = days.reduce((s, d) => s + d.rounds.reduce((rs, r) => rs + r.pnms.filter(p => isMatched(p.matchedWith)).length, 0), 0);

  return (
    <div className="flex-1 overflow-auto bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96)_38%,_rgba(241,245,249,1))]">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-end justify-between mb-5">
          <div>
            <h2 className="text-[15px] font-bold text-slate-800 tracking-tight">Master Summary</h2>
            <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wider">All recruitment days — combined view</p>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: "Days Active",     value: days.filter(d => d.rounds.length > 0).length },
            { label: "Total Rounds",    value: totalRounds },
            { label: "Total PNMs",      value: totalPnms },
            { label: "Fully Matched",   value: totalPnms > 0 ? `${totalMatched} / ${totalPnms}` : "—" },
          ].map(stat => (
            <div key={stat.label} className="bg-white border border-slate-200 px-4 py-3 shadow-sm">
              <div className="text-[22px] font-bold text-slate-800 leading-none">{stat.value}</div>
              <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400 mt-1">{stat.label}</div>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          {days.map(day => {
            const theme = DAY_THEME[day.id] ?? DAY_THEME.sisterhood;
            const dayPnms    = day.rounds.reduce((s, r) => s + r.pnms.length, 0);
            const dayMatched = day.rounds.reduce((s, r) => s + r.pnms.filter(p => isMatched(p.matchedWith)).length, 0);
            const pct = dayPnms > 0 ? Math.round((dayMatched / dayPnms) * 100) : 0;

            return (
              <div key={day.id} className={`bg-white border ${theme.border} shadow-sm overflow-hidden`}>
                <div className={`px-4 py-2.5 ${theme.bg} border-b ${theme.border} flex items-center justify-between`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${theme.dot}`} />
                    <span className={`text-[12px] font-bold ${theme.text}`}>{day.name}</span>
                  </div>
                  <div className="flex items-center gap-4 text-[10px] text-slate-500">
                    <span>{day.rounds.length} round{day.rounds.length !== 1 ? 's' : ''}</span>
                    <span>{dayPnms} PNMs</span>
                    <span className={`font-bold ${pct === 100 && dayPnms > 0 ? 'text-green-600' : theme.text}`}>{pct}% matched</span>
                  </div>
                </div>
                {day.rounds.length === 0 ? (
                  <div className="px-4 py-5 text-[11px] text-slate-300 text-center italic">No rounds added yet</div>
                ) : (
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/60">
                        {["Round", "PNMs", "M1 Filled", "M2 Filled", "Fully Matched", "Progress"].map(h => (
                          <th key={h} className="py-1.5 px-4 text-[9px] font-bold uppercase tracking-wider text-slate-400 text-left last:text-right">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {day.rounds.map(round => {
                        const total = round.pnms.length;
                        const m1    = round.pnms.filter(p => isMatched(p.matchedWith)).length;
                        const m2    = round.pnms.filter(p => isMatched(p.secondMatch)).length;
                        const rPct  = total > 0 ? Math.round((m1 / total) * 100) : 0;
                        return (
                          <tr key={round.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/40 transition-colors">
                            <td className="py-2 px-4 font-semibold text-slate-700">{round.name}</td>
                            <td className="py-2 px-4 text-slate-500">{total}</td>
                            <td className="py-2 px-4 text-slate-500">{m1}</td>
                            <td className="py-2 px-4 text-slate-500">{m2}</td>
                            <td className="py-2 px-4">
                              <span className={`font-semibold ${m1 === total && total > 0 ? 'text-green-600' : 'text-slate-600'}`}>{m1}</span>
                            </td>
                            <td className="py-2 px-4">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div className={`h-full ${theme.bar} rounded-full transition-all`} style={{ width: `${rPct}%` }} />
                                </div>
                                <span className="text-[9px] text-slate-400 w-7 text-right">{rPct}%</span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── ActiveRankListView component ──────────────────────────────────────────────
function ActiveRankListView({ actives, reviews, days }: { actives: Active[]; reviews: PnmReview[]; days: DayData[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"pnms" | "actives">("pnms");

  const pnmIdNumberMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const day of (days ?? []))
      for (const round of day.rounds)
        for (const pnm of round.pnms)
          if (!m.has(pnm.name)) m.set(pnm.name, pnm.idNumber);
    return m;
  }, [days]);

  const activeRoundCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const day of (days ?? []))
      for (const round of day.rounds) {
        const activesSeen = new Set<string>();
        for (const pnm of round.pnms) {
          if (pnm.matchedWith) activesSeen.add(pnm.matchedWith);
          if (pnm.secondMatch) activesSeen.add(pnm.secondMatch);
        }
        for (const aid of activesSeen)
          counts.set(aid, (counts.get(aid) ?? 0) + 1);
      }
    return counts;
  }, [days]);

  const rankedActives = useMemo(() => {
    const map = new Map<string, { id: string; name: string; reviews: PnmReview[] }>();
    for (const a of actives) map.set(a.id, { id: a.id, name: a.name, reviews: [] });
    for (const r of reviews) {
      if (!map.has(r.activeId)) map.set(r.activeId, { id: r.activeId, name: r.activeName, reviews: [] });
      map.get(r.activeId)!.reviews.push(r);
    }
    return Array.from(map.values())
      .filter(a => a.reviews.length > 0)
      .map(a => {
        const total      = a.reviews.reduce((s, r) => s + r.stars, 0);
        const avg        = total / a.reviews.length;
        const roundCount = activeRoundCounts.get(a.id) ?? 0;
        return { ...a, total, avg, count: a.reviews.length, roundCount };
      })
      .sort((a, b) => b.roundCount - a.roundCount || b.avg - a.avg);
  }, [actives, reviews, activeRoundCounts]);

  const rankedPnms = useMemo(() => {
    const map = new Map<string, { id: string; name: string; reviews: PnmReview[] }>();
    for (const r of reviews) {
      if (!map.has(r.pnmId)) map.set(r.pnmId, { id: r.pnmId, name: r.pnmName, reviews: [] });
      map.get(r.pnmId)!.reviews.push(r);
    }
    return Array.from(map.values())
      .map(p => {
        const total = p.reviews.reduce((s, r) => s + r.stars, 0);
        const avg   = total / p.reviews.length;
        return { ...p, total, avg, count: p.reviews.length };
      })
      .sort((a, b) => b.avg - a.avg || b.count - a.count);
  }, [reviews]);

  const ranked = mode === "pnms" ? rankedPnms : rankedActives;

  const renderStars = (n: number) => (
    <span className="inline-flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={`text-[11px] ${i < Math.round(n) ? "text-amber-400" : "text-slate-200"}`}>★</span>
      ))}
    </span>
  );

  const rankLabel = (i: number) => `#${i + 1}`;

  const expandBg   = mode === "pnms" ? "bg-rose-50/40"   : "bg-violet-50/50";
  const expandRow  = mode === "pnms" ? "bg-rose-50/30"   : "bg-violet-50/30";
  const borderT    = mode === "pnms" ? "border-rose-100" : "border-violet-100";
  const labelColor = mode === "pnms" ? "text-rose-700"   : "text-violet-700";

  return (
    <div className="flex-1 overflow-auto bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96)_38%,_rgba(241,245,249,1))]">
      <div className="max-w-3xl mx-auto px-6 py-6">

        {/* Header + toggle */}
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-bold text-slate-800 tracking-tight">
              {mode === "pnms" ? "PNM Rank List" : "Active Rank List"}
            </h2>
            <p className="text-[10px] text-slate-400 mt-0.5 uppercase tracking-wider">
              {mode === "pnms"
                ? "PNMs ranked by average rating — highest = strongest bid candidates"
                : "Actives ranked by average rating they gave across all PNMs"}
            </p>
          </div>
          <div className="flex shrink-0 border border-slate-200 overflow-hidden shadow-sm">
            <button
              onClick={() => { setMode("pnms"); setExpandedId(null); }}
              className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${mode === "pnms" ? "bg-rose-500 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
              data-testid="toggle-rank-pnms"
            >
              PNMs
            </button>
            <button
              onClick={() => { setMode("actives"); setExpandedId(null); }}
              className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-colors border-l border-slate-200 ${mode === "actives" ? "bg-violet-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
              data-testid="toggle-rank-actives"
            >
              Actives
            </button>
          </div>
        </div>

        {/* Stats bar */}
        {ranked.length > 0 && (
          <div className="flex gap-3 mb-4">
            {[
              { label: "Ranked", value: ranked.length },
              { label: "Top Score", value: ranked[0]?.avg.toFixed(2) + " / 5" },
              { label: "Total Reviews", value: reviews.length },
            ].map(s => (
              <div key={s.label} className="flex-1 bg-white border border-slate-200 px-3 py-2 shadow-sm">
                <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{s.label}</div>
                <div className="text-[13px] font-bold text-slate-700 mt-0.5">{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {ranked.length === 0 ? (
          <div className="bg-white border border-slate-200 px-6 py-12 text-center shadow-sm">
            <p className="text-[12px] font-semibold text-slate-400">No reviews yet</p>
            <p className="text-[10px] text-slate-300 mt-1">Add star ratings in the Comments tab to populate rankings.</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70">
                  <th className="py-2 px-4 text-left text-[9px] font-bold uppercase tracking-wider text-slate-400 w-10">#</th>
                  {mode === "pnms" && <th className="py-2 px-4 text-left text-[9px] font-bold uppercase tracking-wider text-slate-400 w-20">PNM No.</th>}
                  <th className="py-2 px-4 text-left text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    {mode === "pnms" ? "Name" : "Active Name"}
                  </th>
                  <th className="py-2 px-4 text-left text-[9px] font-bold uppercase tracking-wider text-slate-400">Avg Score</th>
                  {mode === "actives" && <th className="py-2 px-4 text-center text-[9px] font-bold uppercase tracking-wider text-slate-400 w-16">Rounds</th>}
                  <th className="py-2 px-4 text-center text-[9px] font-bold uppercase tracking-wider text-slate-400 w-20">Reviews</th>
                  {mode === "pnms" && <th className="py-2 px-4 text-center text-[9px] font-bold uppercase tracking-wider text-slate-400 w-16">Total Pts</th>}
                  <th className="py-2 px-3 w-8" />
                </tr>
              </thead>
              <tbody>
                {ranked.map((entry, i) => {
                  const isExpanded = expandedId === entry.id;
                  return (
                    <Fragment key={entry.id}>
                      <tr
                        className={`border-b border-slate-50 cursor-pointer transition-colors ${isExpanded ? expandBg : "hover:bg-slate-50/50"}`}
                        onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                        data-testid={`row-rank-${entry.id}`}
                      >
                        <td className="py-2.5 px-4">
                          <span className="text-[10px] font-bold text-slate-400">{rankLabel(i)}</span>
                        </td>
                        {mode === "pnms" && (
                          <td className="py-2.5 px-4 text-slate-500 font-mono text-[10px]">
                            {pnmIdNumberMap.get(entry.name) ?? "—"}
                          </td>
                        )}
                        <td className="py-2.5 px-4 font-semibold text-slate-800">{entry.name}</td>
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            {renderStars(entry.avg)}
                            <span className="text-[10px] font-bold text-slate-600">{entry.avg.toFixed(2)}</span>
                            <span className="text-[9px] text-slate-300">/ 5</span>
                          </div>
                        </td>
                        {mode === "actives" && (
                          <td className="py-2.5 px-4 text-center font-bold text-violet-600">
                            {"roundCount" in entry ? entry.roundCount : "—"}
                          </td>
                        )}
                        <td className="py-2.5 px-4 text-center text-slate-500">{entry.count}</td>
                        {mode === "pnms" && <td className="py-2.5 px-4 text-center font-semibold text-slate-600">{entry.total}</td>}
                        <td className="py-2.5 px-3 text-center text-slate-300 text-[10px]">{isExpanded ? "▲" : "▼"}</td>
                      </tr>
                      {isExpanded && (
                        <tr className={`border-b border-slate-100 ${expandRow}`}>
                          <td colSpan={mode === "actives" ? 6 : 7} className="px-6 py-3">
                            <div className={`text-[9px] font-bold uppercase tracking-wider mb-2 ${labelColor}`}>
                              Score Breakdown — {entry.count} review{entry.count !== 1 ? "s" : ""}
                            </div>
                            <div className="space-y-1.5">
                              {entry.reviews
                                .slice()
                                .sort((a, b) => b.stars - a.stars)
                                .map(r => (
                                  <div key={r.id} className="flex items-start gap-3 py-1.5 px-3 bg-white border border-slate-100 rounded">
                                    <div className="flex-1 min-w-0">
                                      {mode === "pnms" ? (
                                        <span className="font-semibold text-slate-700 text-[11px]">{r.activeName}</span>
                                      ) : (
                                        <span className="flex flex-col">
                                          <span className="font-semibold text-slate-700 text-[11px]">{r.pnmName}</span>
                                          <span className="text-[9px] text-slate-400 font-mono leading-none">ID: {pnmIdNumberMap.get(r.pnmName) ?? "—"}</span>
                                        </span>
                                      )}
                                      {r.note && <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{r.note}</p>}
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {renderStars(r.stars)}
                                      <span className="text-[10px] font-bold text-slate-500">{r.stars}/5</span>
                                    </div>
                                  </div>
                                ))}
                            </div>
                            <div className={`mt-2 pt-2 border-t ${borderT} flex items-center gap-4 text-[10px] text-slate-500`}>
                              <span>Avg: <strong className="text-slate-700">{entry.avg.toFixed(2)}</strong></span>
                              <span>Total pts: <strong className="text-slate-700">{entry.total}</strong></span>
                              <span>Reviews: <strong className="text-slate-700">{entry.count}</strong></span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const INITIAL_DAYS: DayData[] = [
  { id: "sisterhood", name: "Sisterhood Day", rounds: [
    { id: "r1", name: "Round 1", sortOrder: 0, pnms: MOCK_PNMS },
    { id: "r2", name: "Round 2", sortOrder: 1, pnms: MOCK_PNMS.slice(0, 2) },
  ]},
  { id: "philanthropy", name: "Philanthropy Day", rounds: [] },
  { id: "preference", name: "Preference Day", rounds: [] },
];

// ── ReviewsTab component ───────────────────────────────────────────────────────
function ReviewsTab({
  rounds, actives, reviews, setReviews,
  expandedPnmId, setExpandedPnmId,
  reviewDraft, setReviewDraft,
  savingReviewId, setSavingReviewId,
  commentsSearch, setCommentsSearch,
  commentActiveOverrides, setCommentActiveOverrides,
  deleteReview,
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
  commentActiveOverrides: Record<string, string[]>;
  setCommentActiveOverrides: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  deleteReview: (reviewId: string) => Promise<void>;
}) {
  const [editingPnmId, setEditingPnmId] = useState<string | null>(null);
  const [activeSearch, setActiveSearch] = useState("");

  const seenNames = new Set<string>();
  const uniquePnms = rounds.flatMap(r => r.pnms).filter(p => {
    if (seenNames.has(p.name)) return false;
    seenNames.add(p.name);
    return true;
  }).filter(p => p.name.toLowerCase().includes(commentsSearch.toLowerCase()));

  // Build planner-derived map: pnmId → Set of activeIds
  const pnmToActiveIds = new Map<string, Set<string>>();
  rounds.forEach(round => {
    round.pnms.forEach(pnm => {
      if (!pnmToActiveIds.has(pnm.id)) pnmToActiveIds.set(pnm.id, new Set());
      if (pnm.matchedWith) pnmToActiveIds.get(pnm.id)!.add(pnm.matchedWith);
      if (pnm.secondMatch) pnmToActiveIds.get(pnm.id)!.add(pnm.secondMatch);
    });
  });

  const getActiveIdsForPnm = (pnmId: string): string[] => {
    const overrides = commentActiveOverrides ?? {};
    if (overrides[pnmId] !== undefined) return overrides[pnmId];
    return Array.from(pnmToActiveIds.get(pnmId) ?? new Set());
  };

  const handleStartEdit = (pnm: PNM) => {
    const overrides = commentActiveOverrides ?? {};
    if (overrides[pnm.id] === undefined) {
      setCommentActiveOverrides(prev => ({
        ...(prev ?? {}),
        [pnm.id]: Array.from(pnmToActiveIds.get(pnm.id) ?? new Set()),
      }));
    }
    setEditingPnmId(pnm.id);
    setExpandedPnmId(pnm.id);
    setActiveSearch("");
  };

  const handleRemoveActive = (pnmId: string, activeId: string) => {
    setCommentActiveOverrides(prev => ({
      ...(prev ?? {}),
      [pnmId]: ((prev ?? {})[pnmId] ?? []).filter(id => id !== activeId),
    }));
    const reviewId = `rev_${pnmId}_${activeId}`;
    if (reviews.find(r => r.id === reviewId)) deleteReview(reviewId);
  };

  const handleAddActive = (pnmId: string, activeId: string) => {
    setCommentActiveOverrides(prev => {
      const safe = prev ?? {};
      const current = safe[pnmId] ?? Array.from(pnmToActiveIds.get(pnmId) ?? new Set());
      if (current.includes(activeId)) return safe;
      return { ...safe, [pnmId]: [...current, activeId] };
    });
    setActiveSearch("");
  };

  const saveReview = async (pnmId: string, activeId: string, activeName: string, pnmName: string, stars: number, note: string) => {
    const id = `rev_${pnmId}_${activeId}`;
    setSavingReviewId(id);
    try {
      const saved = await idbUpsertReview({ id, pnmId, activeId, activeName, pnmName, stars, note });
      setReviews(prev => [...prev.filter(r => r.id !== saved.id), saved]);
    } finally {
      setSavingReviewId(null);
    }
  };

  const allPnmsCount = rounds.flatMap(r => r.pnms).filter((p, i, arr) => arr.findIndex(x => x.name === p.name) === i).length;
  const importFileRef = useRef<HTMLInputElement>(null);

  const handleExportComments = () => {
    const blob = new Blob([JSON.stringify(reviews, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `matchops-comments-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportComments = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (!Array.isArray(parsed)) throw new Error("Invalid format");
        setReviews(prev => {
          const merged = [...prev];
          for (const incoming of parsed) {
            const idx = merged.findIndex(r => r.id === incoming.id);
            if (idx >= 0) merged[idx] = incoming;
            else merged.push(incoming);
          }
          return merged;
        });
      } catch {
        alert("Could not read the file. Make sure it's a valid MatchOps comments export.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <>
    <div className="px-3 py-1 border-b border-slate-200/80 shrink-0 flex items-center gap-2 bg-white/95">
      <Search className="h-3 w-3 text-slate-400 shrink-0" />
      <input
        className="flex-1 text-[11px] bg-transparent outline-none placeholder:text-slate-400 text-slate-800"
        placeholder="Search PNMs…"
        value={commentsSearch}
        onChange={e => setCommentsSearch(e.target.value)}
        data-testid="input-comments-search"
      />
      {commentsSearch && <button onClick={() => setCommentsSearch("")} className="text-[10px] text-slate-400 hover:text-slate-600">✕</button>}
      <div className="flex items-center gap-1 shrink-0 ml-1">
        <button
          onClick={handleExportComments}
          className="flex items-center gap-1 h-6 px-2 text-[9px] font-bold uppercase tracking-wide border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
          data-testid="button-export-comments"
          title="Export all comments to a JSON file"
        >
          <Download className="h-2.5 w-2.5" />
          Export
        </button>
        <button
          onClick={() => importFileRef.current?.click()}
          className="flex items-center gap-1 h-6 px-2 text-[9px] font-bold uppercase tracking-wide border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100 transition-colors"
          data-testid="button-import-comments"
          title="Import comments from a previously exported file"
        >
          <Upload className="h-2.5 w-2.5" />
          Import
        </button>
        <input
          ref={importFileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleImportComments}
          data-testid="input-import-comments-file"
        />
      </div>
    </div>
    <ScrollArea className="flex-1">
      {uniquePnms.length === 0 ? (
        <div className="py-16 text-center text-[11px] text-slate-400">{allPnmsCount === 0 ? 'No PNMs imported yet.' : 'No PNMs match your search.'}</div>
      ) : uniquePnms.map(pnm => {
        const finalActiveIds = getActiveIdsForPnm(pnm.id);
        const matchedActives = actives.filter(a => finalActiveIds.includes(a.id));
        const pnmReviewsList = reviews.filter(r => r.pnmId === pnm.id);
        const avgStars = pnmReviewsList.length > 0
          ? pnmReviewsList.reduce((s, r) => s + r.stars, 0) / pnmReviewsList.length
          : null;
        const isExpanded = expandedPnmId === pnm.id;
        const isEditing = editingPnmId === pnm.id;
        const searchedActives = actives.filter(a =>
          !finalActiveIds.includes(a.id) &&
          a.name.toLowerCase().includes(activeSearch.toLowerCase())
        );

        return (
          <div key={pnm.id} className="border-b border-slate-100 last:border-0" data-testid={`review-section-${pnm.id}`}>
            {/* PNM header row */}
            <div className="flex items-center">
              <button
                className="flex-1 flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 transition-colors text-left min-w-0"
                onClick={() => { setExpandedPnmId(isExpanded ? null : pnm.id); if (isEditing) setEditingPnmId(null); }}
                data-testid={`btn-expand-pnm-${pnm.id}`}
              >
                <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                <span className="flex-1 min-w-0 flex flex-col truncate">
                  <span className="text-[11px] font-semibold text-slate-800 truncate">{pnm.name}</span>
                  <span className="text-[9px] text-slate-400 font-mono leading-none">ID: {pnm.idNumber}</span>
                </span>
                {avgStars !== null ? (
                  <span className="flex items-center gap-0.5 shrink-0" data-testid={`text-avg-stars-${pnm.id}`}>
                    {[1,2,3,4,5].map(s => (
                      <Star key={s} className={`w-2.5 h-2.5 ${s <= Math.round(avgStars) ? 'text-amber-400 fill-amber-400' : 'text-slate-200'}`} />
                    ))}
                    <span className="text-[9px] text-slate-500 ml-1">{avgStars.toFixed(1)} · {pnmReviewsList.length}</span>
                  </span>
                ) : (
                  <span className="text-[9px] text-slate-300 shrink-0">No comments</span>
                )}
              </button>
              <button
                className={`pl-2.5 pr-3.5 py-1.5 text-[9px] font-bold uppercase tracking-wide border-l border-slate-100 transition-colors shrink-0 ${isEditing ? 'text-white bg-violet-600 hover:bg-violet-700' : 'text-violet-600 bg-violet-50 hover:bg-violet-100 hover:text-violet-700'}`}
                onClick={e => { e.stopPropagation(); isEditing ? setEditingPnmId(null) : handleStartEdit(pnm); }}
                data-testid={`btn-edit-actives-${pnm.id}`}
              >
                {isEditing ? "Done" : "Edit"}
              </button>
            </div>

            {isExpanded && (
              <div className="bg-slate-50/60 border-t border-slate-100 px-3 pt-2 pb-2.5">
                {isEditing ? (
                  /* ── Edit mode ── */
                  <div className="space-y-2">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Actives for {pnm.name}</p>
                    {/* Current actives as chips */}
                    <div className="flex flex-wrap gap-1 min-h-[26px]">
                      {finalActiveIds.length === 0 && (
                        <span className="text-[10px] text-slate-400 italic">No actives assigned</span>
                      )}
                      {finalActiveIds.map(aid => {
                        const a = actives.find(x => x.id === aid);
                        return (
                          <span key={aid} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-slate-200 text-[10px] font-semibold text-slate-700 shadow-sm">
                            {a?.name ?? aid}
                            <button
                              className="text-slate-300 hover:text-red-500 transition-colors"
                              onClick={() => handleRemoveActive(pnm.id, aid)}
                              data-testid={`btn-remove-active-${pnm.id}-${aid}`}
                              title="Remove this active"
                            >×</button>
                          </span>
                        );
                      })}
                    </div>
                    {/* Add active search */}
                    <div className="relative">
                      <div className="flex items-center gap-1.5 border border-slate-200 bg-white px-2 py-1">
                        <Search className="w-2.5 h-2.5 text-slate-400 shrink-0" />
                        <input
                          className="flex-1 text-[10px] bg-transparent outline-none placeholder:text-slate-400 text-slate-800"
                          placeholder="Search actives to add…"
                          value={activeSearch}
                          onChange={e => setActiveSearch(e.target.value)}
                          data-testid={`input-add-active-search-${pnm.id}`}
                        />
                        {activeSearch && <button onClick={() => setActiveSearch("")} className="text-[9px] text-slate-300 hover:text-slate-500">✕</button>}
                      </div>
                      {activeSearch && searchedActives.length > 0 && (
                        <div className="absolute z-20 top-full left-0 right-0 bg-white border border-slate-200 border-t-0 shadow-lg max-h-32 overflow-auto">
                          {searchedActives.map(a => (
                            <button
                              key={a.id}
                              className="w-full text-left px-3 py-1.5 text-[10px] font-medium text-slate-700 hover:bg-violet-50 hover:text-violet-700 transition-colors border-b border-slate-50 last:border-0"
                              onClick={() => handleAddActive(pnm.id, a.id)}
                              data-testid={`btn-add-active-${pnm.id}-${a.id}`}
                            >
                              {a.name}
                            </button>
                          ))}
                        </div>
                      )}
                      {activeSearch && searchedActives.length === 0 && (
                        <div className="absolute z-20 top-full left-0 right-0 bg-white border border-slate-200 border-t-0 px-3 py-2 shadow-md">
                          <span className="text-[10px] text-slate-400">No matching actives found</span>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* ── Review forms ── */
                  <div className="space-y-1.5">
                    {matchedActives.length === 0 ? (
                      <p className="text-[10px] text-slate-400 py-1">No actives assigned yet. Click <span className="font-semibold text-violet-500">Edit</span> to add one.</p>
                    ) : matchedActives.map(active => {
                      const reviewId = `rev_${pnm.id}_${active.id}`;
                      const existing = reviews.find(r => r.id === reviewId);
                      const draft = reviewDraft[reviewId];
                      const currentStars = draft?.stars ?? existing?.stars ?? 0;
                      const currentNote = draft?.note ?? existing?.note ?? "";
                      const isSaving = savingReviewId === reviewId;
                      const isDirty = draft !== undefined && (draft.stars !== (existing?.stars ?? 0) || draft.note !== (existing?.note ?? ""));

                      return (
                        <div key={active.id} className="bg-white border border-slate-200 p-2" data-testid={`review-form-${pnm.id}-${active.id}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] font-semibold text-slate-700">{active.name}</span>
                            {existing && !isDirty && <span className="text-[9px] text-slate-400">Saved</span>}
                          </div>
                          <div className="flex items-center gap-0.5 mb-1.5">
                            {[1,2,3,4,5].map(s => (
                              <button
                                key={s}
                                onClick={() => setReviewDraft(prev => ({ ...prev, [reviewId]: { stars: s, note: prev[reviewId]?.note ?? existing?.note ?? "" } }))}
                                className="transition-transform hover:scale-110"
                                data-testid={`star-${pnm.id}-${active.id}-${s}`}
                              >
                                <Star className={`w-4 h-4 ${s <= currentStars ? 'text-amber-400 fill-amber-400' : 'text-slate-200 hover:text-amber-300'}`} />
                              </button>
                            ))}
                            {currentStars > 0 && (
                              <button onClick={() => setReviewDraft(prev => ({ ...prev, [reviewId]: { stars: 0, note: prev[reviewId]?.note ?? existing?.note ?? "" } }))} className="ml-1 text-[9px] text-slate-400 hover:text-slate-600">clear</button>
                            )}
                          </div>
                          <Textarea
                            placeholder={`${active.name}'s notes on ${pnm.name}…`}
                            className="text-[11px] resize-none h-12 rounded-none border-slate-200 bg-slate-50 shadow-none focus:bg-white"
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
                              className="mt-1 px-2 py-0.5 text-[10px] font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              data-testid={`btn-save-review-${pnm.id}-${active.id}`}
                            >
                              {isSaving ? "Saving…" : "Save"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
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
  const [days, setDays] = useState<DayData[]>(INITIAL_DAYS);
  const [activeDayId, setActiveDayId] = useState("sisterhood");
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
  const [isMasterExportOpen, setIsMasterExportOpen] = useState(false);
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
  const [isCycleResolverOpen, setIsCycleResolverOpen] = useState(false);
  const [isBump2Enabled, setIsBump2Enabled] = useState(true);
  const [isToolsMenuOpen, setIsToolsMenuOpen] = useState(true);
  const [isLinkedHoverEnabled, setIsLinkedHoverEnabled] = useState(false);
  const [hoveredActiveId, setHoveredActiveId] = useState<string | null>(null);
  const [hoveredPnmId, setHoveredPnmId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<PlannerSnapshot[]>([]);
  const [specialView, setSpecialView] = useState<null | "master" | "rank">(null);
  const [commentActiveOverrides, setCommentActiveOverrides] = useState<Record<string, string[]>>({});

  const rounds = useMemo(() => days.find(d => d.id === activeDayId)?.rounds ?? [], [days, activeDayId]);

  const setRounds = useCallback((updater: RoundData[] | ((prev: RoundData[]) => RoundData[])) => {
    setDays(prev => prev.map(d => {
      if (d.id !== activeDayId) return d;
      const newRounds = typeof updater === 'function' ? updater(d.rounds) : updater;
      return { ...d, rounds: newRounds };
    }));
  }, [activeDayId]);

  const handleSwitchDay = (dayId: string) => {
    setSpecialView(null);
    const day = days.find(d => d.id === dayId)!;
    if (day.rounds.length === 0) {
      const newRound: RoundData = { id: `${dayId}-r1`, name: "Round 1", sortOrder: 0, pnms: [] };
      setDays(prev => prev.map(d => d.id === dayId ? { ...d, rounds: [newRound] } : d));
      setActiveDayId(dayId);
      setActiveRoundId(newRound.id);
    } else {
      setActiveDayId(dayId);
      setActiveRoundId(day.rounds[0].id);
    }
  };

  const pool1Ref = useRef<HTMLDivElement>(null);
  const roundNameUndoCapturedRef = useRef(false);
  const pool2Ref = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isInitializedRef = useRef(false);          // becomes true after boot load settles
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load persisted state from IndexedDB on first mount.
  // If nothing is stored yet, keep the mock data as-is.
  useEffect(() => {
    idbLoadState()
      .then(data => {
        if (!data) return; // first launch → keep mock data
        const parseRounds = (rawRounds: any[]): RoundData[] => (rawRounds ?? []).map((r: any) => ({
          id: r.id,
          name: r.name,
          sortOrder: r.sortOrder,
          pnms: (r.pnms ?? []).map((p: any) => ({
            id: p.id,
            name: p.name,
            idNumber: p.idNumber,
            matchedWith: p.matchedWith ?? undefined,
            secondMatch: p.secondMatch ?? undefined,
            lockedM1: p.lockedM1 ?? false,
            lockedM2: p.lockedM2 ?? false,
            status: (p.matchedWith || p.secondMatch) ? 'matched' : 'unmatched',
          } as PNM)),
        }));
        if (data.days) {
          // Multi-day format
          const loadedDays: DayData[] = data.days.map((d: any) => ({
            id: d.id,
            name: d.name,
            rounds: parseRounds(d.rounds ?? []),
          }));
          setDays(loadedDays);
          setActives(data.actives ?? []);
          const loadedDayId = data.activeDayId ?? "sisterhood";
          setActiveDayId(loadedDayId);
          const activeDay = loadedDays.find(d => d.id === loadedDayId);
          setActiveRoundId(data.activeRoundId ?? activeDay?.rounds[0]?.id ?? "");
          if (data.chainLengthLimit) setChainLengthLimit(data.chainLengthLimit);
        }
        if (data.commentActiveOverrides) setCommentActiveOverrides(data.commentActiveOverrides);
      })
      .catch(() => {})
      .finally(() => {
        setIsLoading(false);
        setTimeout(() => { isInitializedRef.current = true; }, 0);
      });
  }, []);

  // Load reviews on mount
  useEffect(() => {
    idbLoadReviews()
      .then(data => { if (Array.isArray(data)) setReviews(data); })
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
        const serializeRounds = (rs: RoundData[]) => rs.map((r, i) => ({
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
        }));
        await idbSaveState({
          days: days.map(d => ({ id: d.id, name: d.name, rounds: serializeRounds(d.rounds) })),
          actives: actives.map(a => ({ id: a.id, name: a.name })),
          activeDayId,
          activeRoundId,
          chainLengthLimit,
          commentActiveOverrides,
        });
      } catch {
        // Autosave failures are silent — user can still use manual Save button
      }
    }, 800);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [days, actives, activeDayId, activeRoundId, chainLengthLimit, commentActiveOverrides]);

  const deleteReview = useCallback(async (reviewId: string) => {
    await idbDeleteReview(reviewId);
    setReviews(prev => prev.filter(r => r.id !== reviewId));
  }, []);

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
      // Read order: tail first (the active unused in M1 who is free to initiate bumping)
      const readOrderNames = [...names].reverse();
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
      cycleCount: chains.filter(chain => chain.isCycle).length,
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
    const warnings = new Map<string, { alreadyUsedInSlot: boolean; chainCount: number; isOverLimit: boolean; wouldCycle: boolean }>();

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
        const wouldCycle = relatedChains.some(chain => chain.isCycle);

        warnings.set(`${pnm.id}-${slot}`, {
          alreadyUsedInSlot: activeRound.pnms.some(otherPnm => otherPnm.id !== pnm.id && otherPnm[slotKey] === draggedActiveId),
          chainCount,
          isOverLimit: chainCount > chainLengthLimit,
          wouldCycle,
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

  const buildAutoMatchAssignments = (mode: 'random' | 'balanced', activesPool = actives) => {
    const podSize = Math.max(2, chainLengthLimit);
    const shuffledActives = shuffleArray([...activesPool]);
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

    // Collect actives pinned to locked slots — exclude them from the pool
    const lockedActiveIds = new Set<string>();
    for (const pnm of activeRound.pnms) {
      if (pnm.lockedM1 && pnm.matchedWith) lockedActiveIds.add(pnm.matchedWith);
      if (pnm.lockedM2 && pnm.secondMatch) lockedActiveIds.add(pnm.secondMatch);
    }
    const availableActives = actives.filter(a => !lockedActiveIds.has(a.id));
    const assignments = buildAutoMatchAssignments(mode, availableActives);

    setRounds(prev => prev.map(round => {
      if (round.id !== activeRoundId) return round;
      let idx = 0;
      return {
        ...round,
        pnms: round.pnms.map(pnm => {
          const m1Locked = pnm.lockedM1 && !!pnm.matchedWith;
          const m2Locked = pnm.lockedM2 && !!pnm.secondMatch;
          if (m1Locked && m2Locked) return pnm; // fully locked — skip entirely
          const assignment = assignments[idx++];
          const newM1 = m1Locked ? pnm.matchedWith : assignment?.matchedWith;
          const newM2 = m2Locked ? pnm.secondMatch : assignment?.secondMatch;
          return {
            ...pnm,
            matchedWith: newM1,
            secondMatch: newM2,
            status: newM1 || newM2 ? 'matched' as const : 'unmatched' as const,
          };
        }),
      };
    }));

    const lockedCount = activeRound.pnms.filter(p => (p.lockedM1 && p.matchedWith) || (p.lockedM2 && p.secondMatch)).length;
    toast.success(
      `${mode === 'balanced' ? "Balanced" : "Random"} auto-match complete${lockedCount > 0 ? ` · ${lockedCount} locked slot${lockedCount !== 1 ? 's' : ''} preserved` : ""}`,
      { className: "rounded-none text-xs font-bold bg-purple-50 text-purple-700 border-purple-200" }
    );
  };

  const handleToggleLock = (pnmId: string, slot: 1 | 2) => {
    const key = slot === 1 ? 'lockedM1' : 'lockedM2';
    setRounds(prev => prev.map(round => {
      if (round.id !== activeRoundId) return round;
      return {
        ...round,
        pnms: round.pnms.map(p => p.id !== pnmId ? p : { ...p, [key]: !p[key] }),
      };
    }));
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

      if (projectedDrop?.wouldCycle) {
        toast.error("This assignment would create a cycle — no free active could start the chain.", {
          className: "rounded-none text-xs font-bold",
          duration: 4000
        });
        return;
      }

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
          const updated = {
            ...p,
            [slot === 1 ? 'matchedWith' : 'secondMatch']: undefined,
            [slot === 1 ? 'lockedM1' : 'lockedM2']: false,
          };
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
      const fullChain = chains[i]
        ? escapeCSV(`${chains[i].starterName} -> ${chains[i].handoffDisplay}`)
        : "";
      finalRows.push([...row, "", fullChain]);
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
      ["ID Number", "PNM Name", "Match 1", "Match 2", "", "Bump Chain"],
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
      const data = await idbListSnapshots();
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
      const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await idbCreateSnapshot(id, label, payload);
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
      const data = await getSnapshotPayload(id) as any;
      if (!data) throw new Error("Snapshot not found");

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
      await deleteSnapshotById(id);
      setSnapshotList(prev => prev.filter(s => s.id !== id));
      toast.success("Snapshot deleted");
    } catch {
      toast.error("Failed to delete snapshot");
    }
  };

  const saveState = async () => {
    setIsSaving(true);
    try {
      await idbSaveState({
        days: days.map(d => ({
          id: d.id,
          name: d.name,
          rounds: d.rounds.map((r, i) => ({
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
        })),
        actives: actives.map(a => ({ id: a.id, name: a.name })),
        activeDayId,
        activeRoundId,
        chainLengthLimit,
        commentActiveOverrides,
      });
      toast.success("Saved locally");
    } catch (err) {
      console.error(err);
      toast.error("Save failed — " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  const backupFileRef = useRef<HTMLInputElement>(null);

  const handleExportBackup = async () => {
    try {
      await exportFullBackup();
      toast.success("Backup downloaded");
    } catch {
      toast.error("Failed to export backup");
    }
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await importFullBackup(file);
      toast.success("Backup imported — reloading…");
      setTimeout(() => window.location.reload(), 800);
    } catch {
      toast.error("Could not read backup file. Make sure it's a valid MatchOps backup.");
    }
    e.target.value = "";
  };

  // ── Master Export (multi-sheet Excel) ─────────────────────────────────────
  const addAutoFilter = (ws: XLSX.WorkSheet) => {
    const ref = ws['!ref'];
    if (!ref) return;
    const range = XLSX.utils.decode_range(ref);
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: range.e.c } }) };
  };

  const handleMasterExport = (sortMode: "round" | "id") => {
    try {
      const wb = XLSX.utils.book_new();

      // Build pnmId → idNumber lookup across all days/rounds
      const pnmIdNumberLookup = new Map<string, string>();
      for (const day of days) {
        for (const round of day.rounds) {
          for (const pnm of round.pnms) {
            if (!pnmIdNumberLookup.has(pnm.id)) {
              pnmIdNumberLookup.set(pnm.id, pnm.idNumber);
            }
          }
        }
      }

      // One sheet per day — one row per unique PNM, round matches as extra columns
      for (const day of days) {
        if (day.rounds.length === 0) continue;

        // Collect unique PNMs (keyed by pnm.id) tracking first-round index
        const pnmFirstRound = new Map<string, number>();
        const pnmMeta = new Map<string, { idNumber: string; name: string }>();
        for (let ri = 0; ri < day.rounds.length; ri++) {
          for (const pnm of day.rounds[ri].pnms) {
            if (!pnmMeta.has(pnm.id)) {
              pnmMeta.set(pnm.id, { idNumber: pnm.idNumber, name: pnm.name });
              pnmFirstRound.set(pnm.id, ri);
            }
          }
        }

        let pnmOrder = Array.from(pnmMeta.keys());
        if (sortMode === "id") {
          pnmOrder.sort((a, b) => {
            const na = parseInt(pnmMeta.get(a)!.idNumber) || 0;
            const nb = parseInt(pnmMeta.get(b)!.idNumber) || 0;
            return na - nb;
          });
        } else {
          // Sort by first round, then by ID# within same round
          pnmOrder.sort((a, b) => {
            const ra = pnmFirstRound.get(a) ?? 0;
            const rb = pnmFirstRound.get(b) ?? 0;
            if (ra !== rb) return ra - rb;
            const na = parseInt(pnmMeta.get(a)!.idNumber) || 0;
            const nb = parseInt(pnmMeta.get(b)!.idNumber) || 0;
            return na - nb;
          });
        }

        // Header: ID# — PNM Name | Round1 M1 | Round1 M2 | Round2 M1 | Round2 M2 | …
        const header: string[] = ["ID# — PNM Name"];
        for (const round of day.rounds) {
          header.push(`${round.name} — M1`, `${round.name} — M2`);
        }
        const rows: (string | number)[][] = [header];

        for (const pnmId of pnmOrder) {
          const meta = pnmMeta.get(pnmId)!;
          const row: (string | number)[] = [`${meta.idNumber} — ${meta.name}`];
          for (const round of day.rounds) {
            const pnm = round.pnms.find(p => p.id === pnmId);
            row.push(pnm?.matchedWith ? (activeNameById.get(pnm.matchedWith) ?? pnm.matchedWith) : "");
            row.push(pnm?.secondMatch ? (activeNameById.get(pnm.secondMatch) ?? pnm.secondMatch) : "");
          }
          rows.push(row);
        }

        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 30 }, ...day.rounds.flatMap(() => [{ wch: 20 }, { wch: 20 }])];
        addAutoFilter(ws);
        XLSX.utils.book_append_sheet(wb, ws, day.name.slice(0, 31));
      }

      // Actives sheet
      const activesWs = XLSX.utils.aoa_to_sheet([
        ["Name"],
        ...actives.map(a => [a.name]),
      ]);
      activesWs['!cols'] = [{ wch: 25 }];
      addAutoFilter(activesWs);
      XLSX.utils.book_append_sheet(wb, activesWs, "Actives");

      // Reviews sheet — one row per PNM, actives combined with commas
      const reviewsByPnm = new Map<string, typeof reviews>();
      for (const r of reviews) {
        const bucket = reviewsByPnm.get(r.pnmId) ?? [];
        bucket.push(r);
        reviewsByPnm.set(r.pnmId, bucket);
      }
      const reviewRows: (string | number)[][] = [
        ["ID# — PNM Name", "Reviewer(s)", "Star Rating(s)", "Notes"],
      ];
      for (const [pnmId, pnmReviews] of reviewsByPnm) {
        const idNum = pnmIdNumberLookup.get(pnmId) ?? "";
        const pnmName = pnmReviews[0].pnmName;
        const reviewers = pnmReviews.map(r => r.activeName).join(", ");
        const stars = pnmReviews.map(r => r.stars ? `${r.stars}/5` : "—").join(", ");
        const notes = pnmReviews.map(r => r.note?.trim() || "—").join(" | ");
        reviewRows.push([`${idNum} — ${pnmName}`, reviewers, stars, notes]);
      }
      const reviewsWs = XLSX.utils.aoa_to_sheet(reviewRows);
      reviewsWs['!cols'] = [{ wch: 30 }, { wch: 30 }, { wch: 18 }, { wch: 50 }];
      addAutoFilter(reviewsWs);
      XLSX.utils.book_append_sheet(wb, reviewsWs, "Reviews");

      // Hidden state sheet for re-import
      const statePayload = {
        days: days.map(d => ({
          id: d.id, name: d.name,
          rounds: d.rounds.map((r, i) => ({
            id: r.id, name: r.name, sortOrder: r.sortOrder ?? i,
            pnms: r.pnms.map(p => ({
              id: p.id, name: p.name, idNumber: p.idNumber,
              matchedWith: p.matchedWith ?? null,
              secondMatch: p.secondMatch ?? null,
            })),
          })),
        })),
        actives: actives.map(a => ({ id: a.id, name: a.name })),
        activeDayId, activeRoundId, chainLengthLimit, commentActiveOverrides,
        reviews: reviews.map(r => ({ ...r })),
      };
      const stateWs = XLSX.utils.aoa_to_sheet([
        ["MatchOps Session Data — do not edit this sheet"],
        [JSON.stringify(statePayload)],
      ]);
      XLSX.utils.book_append_sheet(wb, stateWs, "_MATCHOPS_STATE_");

      const date = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `matchops-session-${date}.xlsx`);
      toast.success("Session exported — open in Excel to view all days");
    } catch (err) {
      toast.error("Export failed: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const masterImportFileRef = useRef<HTMLInputElement>(null);

  const handleMasterImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const arrayBuffer = await file.arrayBuffer();
      const wb = XLSX.read(arrayBuffer, { type: "array" });
      const stateSheet = wb.Sheets["_MATCHOPS_STATE_"];
      if (!stateSheet) {
        toast.error("Not a MatchOps session file — missing state sheet.");
        return;
      }
      const rows = XLSX.utils.sheet_to_json<string[]>(stateSheet, { header: 1 });
      const jsonStr = (rows[1] as any)?.[0] as string | undefined;
      if (!jsonStr) {
        toast.error("Could not read session data from this file.");
        return;
      }
      const payload = JSON.parse(jsonStr);
      await idbSaveState({
        days: payload.days,
        actives: payload.actives,
        activeDayId: payload.activeDayId,
        activeRoundId: payload.activeRoundId,
        chainLengthLimit: payload.chainLengthLimit,
        commentActiveOverrides: payload.commentActiveOverrides ?? {},
      });
      if (Array.isArray(payload.reviews)) {
        for (const r of payload.reviews) {
          await idbUpsertReview({
            id: r.id, pnmId: r.pnmId, activeId: r.activeId,
            activeName: r.activeName, pnmName: r.pnmName,
            stars: r.stars, note: r.note,
          });
        }
      }
      toast.success("Session imported — reloading…");
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      toast.error("Import failed: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const activeSummary = useMemo(() => {
    const conversations: Record<string, { pnmName: string; pnmIdNumber: string; roundName: string }[]> = {};
    actives.forEach(a => { conversations[a.id] = []; });
    rounds.forEach(round => {
      round.pnms.forEach(pnm => {
        if (pnm.matchedWith && conversations[pnm.matchedWith] !== undefined) {
          conversations[pnm.matchedWith].push({ pnmName: pnm.name, pnmIdNumber: pnm.idNumber, roundName: round.name });
        }
        if (pnm.secondMatch && conversations[pnm.secondMatch] !== undefined) {
          conversations[pnm.secondMatch].push({ pnmName: pnm.name, pnmIdNumber: pnm.idNumber, roundName: round.name });
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

  const DAY_TAB_STYLE: Record<string, { dot: string; activeTop: string; activeText: string }> = {
    sisterhood:   { dot: "bg-violet-500", activeTop: "shadow-[inset_0_3px_0_#7c3aed]", activeText: "text-violet-700" },
    philanthropy: { dot: "bg-rose-500",   activeTop: "shadow-[inset_0_3px_0_#f43f5e]", activeText: "text-rose-700"   },
    preference:   { dot: "bg-amber-500",  activeTop: "shadow-[inset_0_3px_0_#f59e0b]", activeText: "text-amber-700"  },
  };

  return (
    <div className="h-screen bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96)_38%,_rgba(241,245,249,1))] flex flex-col font-sans overflow-hidden text-[12px] text-slate-800">

      {/* ── Day tab bar ── */}
      <div className="shrink-0 bg-slate-100 border-b border-slate-200 px-3 pt-1.5 flex items-end gap-0.5" style={{ zIndex: 30, position: 'relative' }}>
        <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-slate-400 mr-2 pb-2 shrink-0">Day</span>
        {days.map(day => {
          const style = DAY_TAB_STYLE[day.id] ?? DAY_TAB_STYLE.sisterhood;
          const isActive = day.id === activeDayId && specialView === null;
          const totalPnms = day.rounds.reduce((s, r) => s + r.pnms.length, 0);
          const matchedCount = day.rounds.reduce((s, r) => s + r.pnms.filter(p => p.matchedWith).length, 0);
          return (
            <button
              key={day.id}
              onClick={() => handleSwitchDay(day.id)}
              data-testid={`tab-day-${day.id}`}
              className={`-mb-px flex items-center gap-1.5 px-3.5 py-2 text-[11px] font-semibold rounded-t-md border transition-colors ${
                isActive
                  ? `bg-white border-slate-200 border-b-white ${style.activeTop} ${style.activeText} z-10`
                  : "bg-slate-50 border-slate-200/70 text-slate-500 hover:bg-white hover:text-slate-700"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? style.dot : "bg-slate-300"}`} />
              <span>{day.name}</span>
              {totalPnms > 0 && (
                <span className={`text-[9px] font-bold px-1 ${isActive ? "text-current opacity-60" : "text-slate-400"}`}>
                  {matchedCount}/{totalPnms}
                </span>
              )}
            </button>
          );
        })}
        {/* Match Summary tab */}
        <button
          onClick={() => setSpecialView("master")}
          data-testid="tab-day-master"
          className={`-mb-px ml-1 flex items-center gap-1.5 px-3.5 py-2 text-[11px] font-semibold rounded-t-md border transition-colors ${
            specialView === "master"
              ? "bg-white border-slate-200 border-b-white shadow-[inset_0_3px_0_#64748b] text-slate-700 z-10"
              : "bg-slate-50 border-slate-200/70 text-slate-400 hover:bg-white hover:text-slate-600"
          }`}
        >
          <BarChart2 className="w-3 h-3 shrink-0" />
          Match Summary
        </button>
        {/* Active Rank List tab */}
        <button
          onClick={() => setSpecialView("rank")}
          data-testid="tab-day-rank"
          className={`-mb-px flex items-center gap-1.5 px-3.5 py-2 text-[11px] font-semibold rounded-t-md border transition-colors ${
            specialView === "rank"
              ? "bg-white border-slate-200 border-b-white shadow-[inset_0_3px_0_#f59e0b] text-amber-700 z-10"
              : "bg-slate-50 border-slate-200/70 text-slate-400 hover:bg-white hover:text-slate-600"
          }`}
        >
          <Star className="w-3 h-3 shrink-0" />
          Active Rank List
        </button>
      </div>

      {specialView === "master" ? (
        <MasterSummaryView days={days} actives={actives} />
      ) : specialView === "rank" ? (
        <ActiveRankListView actives={actives} reviews={reviews} days={days} />
      ) : (
      <>
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

        {/* RIGHT: Backup + Save + Undo */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportBackup}
            className="h-7 rounded-none border-slate-300 bg-white px-2.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-800"
            data-testid="button-export-backup"
            title="Download a full backup of all data"
          >
            <Download className="mr-1.5 h-3 w-3" />
            Backup
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => backupFileRef.current?.click()}
            className="h-7 rounded-none border-slate-300 bg-white px-2.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-800"
            data-testid="button-import-backup"
            title="Restore data from a backup file"
          >
            <Upload className="mr-1.5 h-3 w-3" />
            Restore
          </Button>
          <input
            ref={backupFileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportBackup}
            data-testid="input-backup-file"
          />
          <div className="h-5 w-px bg-slate-200 mx-0.5" />
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
                    {isToolsMenuOpen ? 'Export Round CSV' : null}
                  </Button>

                  <Dialog open={isMasterExportOpen} onOpenChange={setIsMasterExportOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className={`h-10 text-[11px] rounded-none w-full bg-sky-50/95 hover:bg-sky-100 border-sky-300 text-sky-700 font-semibold shadow-[0_12px_24px_-22px_rgba(14,165,233,0.35)] ${isToolsMenuOpen ? 'justify-start px-3.5' : 'justify-center px-0'}`} data-testid="button-master-export">
                        <Download className={`w-3 h-3 ${isToolsMenuOpen ? 'mr-2' : ''}`} />
                        {isToolsMenuOpen ? 'Export All Days (.xlsx)' : null}
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-sm rounded-none">
                      <DialogHeader>
                        <DialogTitle>Export All Days</DialogTitle>
                        <DialogDescription>
                          Choose how PNMs are sorted in the Excel file. Every column will also have a sort/filter arrow so you can re-sort in Excel at any time.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="flex flex-col gap-3 pt-2">
                        <Button
                          className="w-full rounded-none h-14 flex flex-col items-start px-4 bg-sky-600 hover:bg-sky-700 text-white"
                          onClick={() => { setIsMasterExportOpen(false); handleMasterExport("round"); }}
                          data-testid="button-export-sort-round"
                        >
                          <span className="font-semibold text-sm">Sort by Round</span>
                          <span className="text-xs font-normal opacity-80">Round 1 PNMs first, then Round 2, etc. — within each round sorted by ID#</span>
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full rounded-none h-14 flex flex-col items-start px-4 border-sky-300 text-sky-700 hover:bg-sky-50"
                          onClick={() => { setIsMasterExportOpen(false); handleMasterExport("id"); }}
                          data-testid="button-export-sort-id"
                        >
                          <span className="font-semibold text-sm">Sort by ID#</span>
                          <span className="text-xs font-normal opacity-70">All PNMs in numeric ID order regardless of round</span>
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>

                  <Button variant="outline" size="sm" className={`h-10 text-[11px] rounded-none w-full bg-amber-50/95 hover:bg-amber-100 border-amber-300 text-amber-700 font-semibold shadow-[0_12px_24px_-22px_rgba(245,158,11,0.35)] ${isToolsMenuOpen ? 'justify-start px-3.5' : 'justify-center px-0'}`} onClick={() => masterImportFileRef.current?.click()} data-testid="button-master-import">
                    <Upload className={`w-3 h-3 ${isToolsMenuOpen ? 'mr-2' : ''}`} />
                    {isToolsMenuOpen ? 'Import Session (.xlsx)' : null}
                  </Button>
                  <input ref={masterImportFileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleMasterImport} data-testid="input-master-import-file" />

                  <Dialog open={isBumpChainsOpen} onOpenChange={setIsBumpChainsOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className={`h-10 text-[11px] rounded-none w-full bg-purple-50/95 hover:bg-purple-100 border-purple-200 text-purple-700 shadow-[0_12px_24px_-22px_rgba(168,85,247,0.35)] ${isToolsMenuOpen ? 'justify-start px-3.5' : 'justify-center px-0'}`} data-testid="button-view-chains">
                        <ListOrdered className={`w-3 h-3 ${isToolsMenuOpen ? 'mr-2' : ''}`} />
                        {isToolsMenuOpen ? 'View Chains' : null}
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col rounded-none overflow-hidden">
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
                      <div className="overflow-y-auto flex-1 min-h-0 py-2 space-y-2">
                        {chainAnalysis.chains.length > 0 ? chainAnalysis.chains.map((chain, idx) => {
                          const borderCls = chain.isCycle
                            ? 'border-orange-300 bg-orange-50'
                            : chain.isOverLimit
                            ? 'border-red-300 bg-red-50'
                            : 'border-slate-100 bg-slate-50 text-slate-700';
                          const nameCls = chain.isCycle
                            ? 'text-orange-700'
                            : chain.isOverLimit
                            ? 'text-red-700'
                            : 'text-slate-800';
                          const arrowCls = chain.isCycle
                            ? 'text-orange-300 px-1'
                            : chain.isOverLimit
                            ? 'text-red-300 px-1'
                            : 'text-slate-300 px-1';
                          const restCls = chain.isCycle
                            ? 'text-orange-600'
                            : chain.isOverLimit
                            ? 'text-red-700'
                            : 'text-slate-500';
                          return (
                            <div key={idx} className={`p-3 border text-sm font-medium shadow-sm flex flex-col gap-1 ${borderCls}`}>
                              {chain.isCycle && (
                                <div className="flex items-center gap-1.5 mb-1">
                                  <AlertTriangle className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-orange-600">Cycle — no free starter</span>
                                  <span className="text-[10px] text-orange-500 normal-case font-normal">Everyone in this loop is already seated. Reassign one M2 to break it.</span>
                                </div>
                              )}
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex flex-wrap items-center">
                                  <span className={`font-bold ${nameCls}`}>{chain.starterName}</span>
                                  <span className={arrowCls}>→</span>
                                  <span className={restCls}>{chain.handoffDisplay}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {chain.isOverLimit && !chain.isCycle && <AlertTriangle className="w-4 h-4 text-red-500" />}
                                  <Badge variant="outline" className={`text-[10px] rounded-none ${chain.isCycle ? 'bg-orange-100 text-orange-700 border-orange-200' : chain.isOverLimit ? 'bg-red-100 text-red-700 border-red-200' : ''}`}>
                                    {chain.count}
                                  </Badge>
                                </div>
                              </div>
                            </div>
                          );
                        }) : (
                          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                            <ListOrdered className="w-8 h-8 mb-2 opacity-50" />
                            <p className="text-sm">No complete bump chains found yet.</p>
                            <p className="text-xs">Match more PNMs to generate chains.</p>
                          </div>
                        )}
                      </div>
                    </DialogContent>
                  </Dialog>

                  {/* Fix Cycles — only shown when cycles exist */}
                  {chainAnalysis.cycleCount > 0 && (
                    <Dialog open={isCycleResolverOpen} onOpenChange={setIsCycleResolverOpen}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className={`h-10 text-[11px] rounded-none w-full bg-orange-50/95 hover:bg-orange-100 border-orange-300 text-orange-700 shadow-[0_12px_24px_-22px_rgba(234,88,12,0.35)] ${isToolsMenuOpen ? 'justify-start px-3.5' : 'justify-center px-0'}`} data-testid="button-fix-cycles">
                          <AlertTriangle className={`w-3 h-3 ${isToolsMenuOpen ? 'mr-2' : ''}`} />
                          {isToolsMenuOpen ? `Fix Cycles (${chainAnalysis.cycleCount})` : null}
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-xl max-h-[80vh] flex flex-col rounded-none overflow-hidden">
                        <DialogHeader>
                          <DialogTitle>Resolve Bump Cycles</DialogTitle>
                          <DialogDescription>
                            Each cycle below has no free active to start the chain. Click a replacement M2 to break it.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="overflow-y-auto flex-1 min-h-0 space-y-6 py-2">
                          {chainAnalysis.chains.filter(c => c.isCycle).map((cycle, cycleIdx) => {
                            // For each active in the cycle, find the PNM they are M1 for —
                            // that PNM's M2 is the edge that closes the cycle and is the fixable point.
                            const fixPoints = cycle.activeIds.map(activeId => {
                              const pnm = activeRound.pnms.find(p => p.matchedWith === activeId);
                              if (!pnm || !pnm.secondMatch) return null;
                              const m1Name = activeNameById.get(activeId) || activeId;
                              const m2Name = activeNameById.get(pnm.secondMatch) || pnm.secondMatch;
                              // Available replacements: not currently used as M2 anywhere, not the PNM's own M1
                              const available = actives.filter(a =>
                                !usedActivesSlot2.has(a.id) &&
                                a.id !== activeId &&
                                a.id !== pnm.secondMatch
                              );
                              return { pnm, m1Name, m2Name, available };
                            }).filter(Boolean) as { pnm: PNM; m1Name: string; m2Name: string; available: Active[] }[];

                            return (
                              <div key={cycleIdx} className="border border-orange-200 bg-orange-50/50 p-4 space-y-3">
                                <div className="flex items-center gap-2">
                                  <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0" />
                                  <span className="text-sm font-bold text-orange-700">
                                    Cycle {cycleIdx + 1}: {cycle.activeIds.map(id => activeNameById.get(id) || id).join(' ↔ ')}
                                  </span>
                                </div>
                                <p className="text-[11px] text-orange-600">
                                  Pick any row below and click a replacement to assign a new M2 for that PNM, breaking the cycle.
                                </p>
                                <div className="space-y-3">
                                  {fixPoints.map(({ pnm, m1Name, m2Name, available }) => (
                                    <div key={pnm.id} className="bg-white border border-orange-100 p-3 space-y-2">
                                      <div className="text-[11px] text-slate-600">
                                        <span className="font-semibold text-slate-800">{pnm.name}</span>
                                        <span className="text-[9px] font-mono text-slate-400 ml-1.5">ID: {pnm.idNumber}</span>
                                        <span className="text-slate-400"> · M1: </span>
                                        <span className="font-medium text-sky-700">{m1Name}</span>
                                        <span className="text-slate-400"> · current M2: </span>
                                        <span className="font-medium text-violet-700 line-through decoration-red-400">{m2Name}</span>
                                      </div>
                                      {available.length > 0 ? (
                                        <div className="flex flex-wrap gap-1.5">
                                          {available.map(a => (
                                            <button
                                              key={a.id}
                                              onClick={() => {
                                                pushUndoState();
                                                setRounds(prev => prev.map(r => {
                                                  if (r.id !== activeRoundId) return r;
                                                  return {
                                                    ...r,
                                                    pnms: r.pnms.map(p => {
                                                      if (p.id !== pnm.id) return p;
                                                      return { ...p, secondMatch: a.id, status: 'matched' as const };
                                                    }),
                                                  };
                                                }));
                                                toast.success(`Assigned ${a.name} as M2 for ${pnm.name}`);
                                                if (chainAnalysis.cycleCount <= 1) setIsCycleResolverOpen(false);
                                              }}
                                              className="px-2.5 py-1 text-[11px] font-medium bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 hover:border-green-400 transition-colors rounded-none"
                                              data-testid={`button-replace-${pnm.id}-${a.id}`}
                                            >
                                              {a.name}
                                            </button>
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="text-[11px] text-slate-400 italic">No unassigned M2 actives available — clear another M2 slot first.</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </DialogContent>
                    </Dialog>
                  )}

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
                      {activeRound.pnms.filter((pnm) => isBump2Enabled ? (pnm.matchedWith && pnm.secondMatch) : pnm.matchedWith).length} / {activeRound.pnms.length} fully matched
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
                      <TableHead className="py-1 h-8 text-[10px] uppercase font-bold bg-slate-50/95">
                        <div className="flex items-center gap-2">
                          <span className={isBump2Enabled ? '' : 'text-slate-300'}>Bump Match 2</span>
                          <button
                            onClick={() => setIsBump2Enabled(v => !v)}
                            className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 border transition-colors ${isBump2Enabled ? 'bg-violet-100 border-violet-300 text-violet-700 hover:bg-violet-200' : 'bg-slate-100 border-slate-300 text-slate-400 hover:bg-slate-200'}`}
                            data-testid="button-toggle-bump2"
                            title={isBump2Enabled ? 'Disable Bump Match 2' : 'Enable Bump Match 2'}
                          >
                            {isBump2Enabled ? 'On' : 'Off'}
                          </button>
                        </div>
                      </TableHead>
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
                              onToggleLock={handleToggleLock}
                              onHoverStart={() => setHoveredPnmId(pnm.id)}
                              onHoverEnd={() => setHoveredPnmId(current => current === pnm.id ? null : current)}
                              isHighlighted={isHighlighted}
                              isDimmed={hasLinkedHighlight && !isHighlighted}
                              dropPreview1={dropWarnings.get(`${pnm.id}-1`)}
                              dropPreview2={dropWarnings.get(`${pnm.id}-2`)}
                              highlightedActiveIds={highlightedActiveIds}
                              isBump2Enabled={isBump2Enabled}
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
                                    <span className="flex flex-col leading-tight">
                                      <span>{p.pnmName}</span>
                                      <span className="text-[8px] font-mono text-slate-400">ID: {p.pnmIdNumber}</span>
                                    </span>
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
                  commentActiveOverrides={commentActiveOverrides}
                  setCommentActiveOverrides={setCommentActiveOverrides}
                  deleteReview={deleteReview}
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
                {isBump2Enabled && (
                  <>
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
                  </>
                )}
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
      </>
      )}
      <Toaster position="top-center" richColors />
    </div>
  );
}
