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

export interface FullState {
  rounds: RoundState[];
  actives: { id: string; name: string }[];
  activeRoundId: string;
  chainLengthLimit: number;
}

// ── getFullState ──────────────────────────────────────────────────────────────
// Loads all rounds, their PNMs, and the actives pool from the database.
// Returns null when the database is empty (first launch).

export async function getFullState(): Promise<FullState | null> {
  const [allRounds, allActives, allPnms] = await Promise.all([
    db.select().from(rounds).orderBy(rounds.sortOrder),
    db.select().from(actives),
    db.select().from(pnms),
  ]);

  if (allRounds.length === 0 && allActives.length === 0) {
    return null; // nothing saved yet
  }

  const roundStates: RoundState[] = allRounds.map((r) => ({
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
  }));

  return {
    rounds: roundStates,
    actives: allActives.map((a) => ({ id: a.id, name: a.name })),
    activeRoundId: allRounds[0]?.id ?? "",
    chainLengthLimit: 6,
  };
}

// ── saveFullState ─────────────────────────────────────────────────────────────
// Replaces ALL data in the database with the provided state.
// Runs inside a transaction so it's all-or-nothing.
// Order matters: actives → rounds → pnms (FK round_id must exist first).

export async function saveFullState(state: FullState): Promise<void> {
  await db.transaction(async (tx) => {
    // 0. Acquire advisory lock so only one save transaction runs at a time.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(1)`);

    // 1. Wipe existing data atomically — TRUNCATE + CASCADE handles FK order
    //    automatically and is guaranteed to leave no rows behind.
    await tx.execute(sql`TRUNCATE TABLE pnms, rounds, actives RESTART IDENTITY CASCADE`);

    // 2. Insert actives
    if (state.actives.length > 0) {
      await tx.insert(actives).values(
        state.actives.map((a) => ({ id: a.id, name: a.name }))
      );
    }

    // 3. Insert rounds
    if (state.rounds.length > 0) {
      await tx.insert(rounds).values(
        state.rounds.map((r) => ({
          id: r.id,
          name: r.name,
          sortOrder: r.sortOrder,
        }))
      );
    }

    // 4. Insert all PNMs (round_id already exists at this point)
    const allPnms = state.rounds.flatMap((r) =>
      r.pnms.map((p) => ({
        id: p.id,
        name: p.name,
        idNumber: p.idNumber,
        roundId: r.id,
        matchedWith: p.matchedWith ?? null,
        secondMatch: p.secondMatch ?? null,
      }))
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
// Saves the current full state as a named snapshot for later restore.

export async function createSnapshot(id: string, label: string, payload: FullState): Promise<Snapshot> {
  const [snapshot] = await db
    .insert(snapshots)
    .values({ id, label, payload })
    .returning();
  return snapshot;
}

// ── getSnapshots ──────────────────────────────────────────────────────────────
// Lists all snapshots ordered newest-first. Payload is NOT included (too large
// for a list view — only fetch it when actually restoring).

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
// Returns the full payload of a snapshot so the frontend can load it.
// Returns null if the snapshot doesn't exist.

export async function restoreSnapshot(id: string): Promise<FullState | null> {
  const [row] = await db
    .select({ payload: snapshots.payload })
    .from(snapshots)
    .where(eq(snapshots.id, id));
  return row ? (row.payload as FullState) : null;
}

// ── deleteSnapshot ────────────────────────────────────────────────────────────
// Permanently deletes a snapshot by ID.

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
// Creates or updates a review for a given (pnmId, activeId) pair.
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
