import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import {
  rounds, actives, pnms, snapshots, pnmReviews,
  type Round, type Active, type Pnm, type Snapshot, type PnmReview,
} from "@shared/schema";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface PnmState {
  id: string;
  name: string;
  idNumber: string;
  matchedWith?: string | null;
  secondMatch?: string | null;
}

export interface RoundState {
  id: string;
  name: string;
  sortOrder: number;
  pnms: PnmState[];
}

export interface DayState {
  id: string;
  name: string;
  rounds: RoundState[];
}

export interface FullState {
  days: DayState[];
  actives: { id: string; name: string }[];
  activeDayId: string;
  activeRoundId: string;
  chainLengthLimit: number;
}

const DAY_ORDER = ["sisterhood", "philanthropy", "preference"];

// ── getFullState ──────────────────────────────────────────────────────────────

export async function getFullState(): Promise<FullState | null> {
  const [allRounds, allActives, allPnms] = await Promise.all([
    db.select().from(rounds).orderBy(rounds.sortOrder),
    db.select().from(actives),
    db.select().from(pnms),
  ]);

  if (allRounds.length === 0 && allActives.length === 0) {
    return null;
  }

  // Group rounds by day
  const dayMap = new Map<string, { name: string; rounds: RoundState[] }>();
  for (const r of allRounds) {
    if (!dayMap.has(r.dayId)) {
      dayMap.set(r.dayId, { name: r.dayName, rounds: [] });
    }
    dayMap.get(r.dayId)!.rounds.push({
      id: r.id,
      name: r.name,
      sortOrder: r.sortOrder,
      pnms: allPnms
        .filter((p) => p.roundId === r.id)
        .map((p) => ({
          id: p.id,
          name: p.name,
          idNumber: p.idNumber,
          matchedWith: p.matchedWith ?? undefined,
          secondMatch: p.secondMatch ?? undefined,
        })),
    });
  }

  // Build days in canonical order, filling in empty days
  const DAY_NAMES: Record<string, string> = {
    sisterhood: "Sisterhood Day",
    philanthropy: "Philanthropy Day",
    preference: "Preference Day",
  };
  const days: DayState[] = DAY_ORDER.map((dayId) => ({
    id: dayId,
    name: dayMap.get(dayId)?.name ?? DAY_NAMES[dayId] ?? dayId,
    rounds: dayMap.get(dayId)?.rounds ?? [],
  }));

  const firstRoundId = allRounds[0]?.id ?? "";
  const firstDayId = allRounds[0]?.dayId ?? "sisterhood";

  return {
    days,
    actives: allActives.map((a) => ({ id: a.id, name: a.name })),
    activeDayId: firstDayId,
    activeRoundId: firstRoundId,
    chainLengthLimit: 6,
  };
}

// ── saveFullState ─────────────────────────────────────────────────────────────

export async function saveFullState(state: FullState): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(1)`);
    await tx.execute(sql`TRUNCATE TABLE pnms, rounds, actives RESTART IDENTITY CASCADE`);

    if (state.actives.length > 0) {
      await tx.insert(actives).values(
        state.actives.map((a) => ({ id: a.id, name: a.name }))
      );
    }

    const allRounds = state.days.flatMap((day) =>
      day.rounds.map((r) => ({
        id: r.id,
        name: r.name,
        sortOrder: r.sortOrder,
        dayId: day.id,
        dayName: day.name,
      }))
    );

    if (allRounds.length > 0) {
      await tx.insert(rounds).values(allRounds);
    }

    const allPnms = state.days.flatMap((day) =>
      day.rounds.flatMap((r) =>
        r.pnms.map((p) => ({
          id: p.id,
          name: p.name,
          idNumber: p.idNumber,
          roundId: r.id,
          matchedWith: p.matchedWith ?? null,
          secondMatch: p.secondMatch ?? null,
        }))
      )
    );

    const seen = new Set<string>();
    const uniquePnms = allPnms.filter((pnm) => {
      if (seen.has(pnm.id)) {
        console.warn("Duplicate PNM IDs detected", pnm.id);
        return false;
      }
      seen.add(pnm.id);
      return true;
    });

    if (uniquePnms.length > 0) {
      await tx.insert(pnms).values(uniquePnms);
    }
  });
}

// ── createSnapshot ────────────────────────────────────────────────────────────

export async function createSnapshot(id: string, label: string, payload: object): Promise<Snapshot> {
  const [snapshot] = await db
    .insert(snapshots)
    .values({ id, label, payload })
    .returning();
  return snapshot;
}

// ── getSnapshots ──────────────────────────────────────────────────────────────

export async function getSnapshots(): Promise<Omit<Snapshot, "payload">[]> {
  const rows = await db
    .select({
      id: snapshots.id,
      label: snapshots.label,
      createdAt: snapshots.createdAt,
    })
    .from(snapshots)
    .orderBy(snapshots.createdAt);
  return rows;
}

// ── restoreSnapshot ───────────────────────────────────────────────────────────

export async function restoreSnapshot(id: string): Promise<object | null> {
  const [row] = await db
    .select({ payload: snapshots.payload })
    .from(snapshots)
    .where(eq(snapshots.id, id));
  return row ? row.payload : null;
}

// ── deleteSnapshot ────────────────────────────────────────────────────────────

export async function deleteSnapshot(id: string): Promise<void> {
  await db.delete(snapshots).where(eq(snapshots.id, id));
}

// ── getReviewsForPnm ──────────────────────────────────────────────────────────
export async function getReviewsForPnm(pnmId: string): Promise<PnmReview[]> {
  return db.select().from(pnmReviews).where(eq(pnmReviews.pnmId, pnmId));
}

// ── getAllReviews ─────────────────────────────────────────────────────────────
export async function getAllReviews(): Promise<PnmReview[]> {
  return db.select().from(pnmReviews);
}

// ── upsertReview ──────────────────────────────────────────────────────────────
export async function upsertReview(data: {
  id: string;
  pnmId: string;
  activeId: string;
  activeName: string;
  pnmName: string;
  stars: number;
  note: string;
}): Promise<PnmReview> {
  const [row] = await db
    .insert(pnmReviews)
    .values({ ...data, stars: data.stars as unknown as number & { __brand: "smallint" } })
    .onConflictDoUpdate({
      target: pnmReviews.id,
      set: {
        stars: sql`excluded.stars`,
        note: sql`excluded.note`,
        activeName: sql`excluded.active_name`,
        pnmName: sql`excluded.pnm_name`,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return row;
}

// ── deleteReview ──────────────────────────────────────────────────────────────
export async function deleteReview(id: string): Promise<void> {
  await db.delete(pnmReviews).where(eq(pnmReviews.id, id));
}
