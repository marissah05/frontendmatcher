import { sql } from "drizzle-orm";
import { pgTable, text, integer, timestamp, jsonb, smallint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ── Rounds ────────────────────────────────────────────────────────────────────
export const rounds = pgTable("rounds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  dayId: text("day_id").notNull().default("sisterhood"),
  dayName: text("day_name").notNull().default("Sisterhood Day"),
});

export const insertRoundSchema = createInsertSchema(rounds);
export type InsertRound = z.infer<typeof insertRoundSchema>;
export type Round = typeof rounds.$inferSelect;

// ── Actives ───────────────────────────────────────────────────────────────────
export const actives = pgTable("actives", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const insertActiveSchema = createInsertSchema(actives);
export type InsertActive = z.infer<typeof insertActiveSchema>;
export type Active = typeof actives.$inferSelect;

// ── PNMs ──────────────────────────────────────────────────────────────────────
export const pnms = pgTable("pnms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  idNumber: text("id_number").notNull(),
  roundId: text("round_id").notNull().references(() => rounds.id, { onDelete: "cascade" }),
  matchedWith: text("matched_with"),
  secondMatch: text("second_match"),
});

export const insertPnmSchema = createInsertSchema(pnms);
export type InsertPnm = z.infer<typeof insertPnmSchema>;
export type Pnm = typeof pnms.$inferSelect;

// ── Snapshots ─────────────────────────────────────────────────────────────────
export const snapshots = pgTable("snapshots", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  payload: jsonb("payload").notNull(),
});

export const insertSnapshotSchema = createInsertSchema(snapshots).omit({ createdAt: true });
export type InsertSnapshot = z.infer<typeof insertSnapshotSchema>;
export type Snapshot = typeof snapshots.$inferSelect;

// ── PNM Reviews ───────────────────────────────────────────────────────────────
// One review per (pnmId, activeId) pair. Stars 1–5, note is free text.
export const pnmReviews = pgTable("pnm_reviews", {
  id: text("id").primaryKey(),
  pnmId: text("pnm_id").notNull(),
  activeId: text("active_id").notNull(),
  activeName: text("active_name").notNull(),
  pnmName: text("pnm_name").notNull(),
  stars: smallint("stars").notNull(),
  note: text("note").notNull().default(""),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertReviewSchema = createInsertSchema(pnmReviews).omit({ updatedAt: true });
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type PnmReview = typeof pnmReviews.$inferSelect;
