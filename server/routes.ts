import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  getFullState,
  saveFullState,
  createSnapshot,
  getSnapshots,
  restoreSnapshot,
  deleteSnapshot,
  getAllReviews,
  upsertReview,
  deleteReview,
  type FullState,
} from "./storage";

// ── Validation schemas ────────────────────────────────────────────────────────

const pnmStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  idNumber: z.string(),
  matchedWith: z.string().nullable().optional(),
  secondMatch: z.string().nullable().optional(),
});

const roundStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
  pnms: z.array(pnmStateSchema),
});

const fullStateSchema = z.object({
  rounds: z.array(roundStateSchema),
  actives: z.array(z.object({ id: z.string(), name: z.string() })),
  activeRoundId: z.string(),
  chainLengthLimit: z.number().int(),
});

// ── Route registration ────────────────────────────────────────────────────────

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // GET /api/state
  // Load the full planner state from the database.
  // Returns null when the database is empty (first launch).
  app.get("/api/state", async (_req: Request, res: Response) => {
    try {
      const state = await getFullState();
      res.json(state); // null on first launch — frontend falls back to mock data
    } catch (err) {
      console.error("GET /api/state error:", err);
      res.status(500).json({ error: "Failed to load state" });
    }
  });

  // PUT /api/state
  // Replace the entire planner state in the database.
  // Called whenever the frontend wants to persist its current state.
  app.put("/api/state", async (req: Request, res: Response) => {
    const parsed = fullStateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid state", details: parsed.error.flatten() });
      return;
    }
    try {
      await saveFullState(parsed.data as FullState);
      res.json({ ok: true });
    } catch (err) {
      console.error("SAVE STATE ERROR:", err);
      res.status(500).json({
        error: "Failed to save state",
        details: err instanceof Error ? err.message : err
      });
    }
  });

  // GET /api/snapshots
  // List all snapshots (id, label, createdAt only — no payload).
  app.get("/api/snapshots", async (_req: Request, res: Response) => {
    try {
      const list = await getSnapshots();
      res.json(list);
    } catch (err) {
      console.error("GET /api/snapshots error:", err);
      res.status(500).json({ error: "Failed to load snapshots" });
    }
  });

  // POST /api/snapshots
  // Save the current state as a named snapshot.
  // Body: { label: string, payload: FullState }
  app.post("/api/snapshots", async (req: Request, res: Response) => {
    const bodySchema = z.object({
      label: z.string().min(1),
      payload: fullStateSchema,
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid snapshot body", details: parsed.error.flatten() });
      return;
    }
    try {
      const id = randomUUID();
      const snapshot = await createSnapshot(id, parsed.data.label, parsed.data.payload as FullState);
      res.status(201).json(snapshot);
    } catch (err) {
      console.error("POST /api/snapshots error:", err);
      res.status(500).json({ error: "Failed to create snapshot" });
    }
  });

  // POST /api/snapshots/:id/restore
  // Return the payload of a snapshot so the frontend can load it.
  // Does NOT automatically overwrite live state — frontend decides what to do.
  app.post("/api/snapshots/:id/restore", async (req: Request, res: Response) => {
    try {
      const payload = await restoreSnapshot(String(req.params.id));
      if (!payload) {
        res.status(404).json({ error: "Snapshot not found" });
        return;
      }
      res.json(payload);
    } catch (err) {
      console.error("POST /api/snapshots/:id/restore error:", err);
      res.status(500).json({ error: "Failed to restore snapshot" });
    }
  });

  // DELETE /api/snapshots/:id
  // Permanently delete a snapshot.
  app.delete("/api/snapshots/:id", async (req: Request, res: Response) => {
    try {
      await deleteSnapshot(String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      console.error("DELETE /api/snapshots/:id error:", err);
      res.status(500).json({ error: "Failed to delete snapshot" });
    }
  });

  // GET /api/reviews
  // Load all reviews.
  app.get("/api/reviews", async (_req: Request, res: Response) => {
    try {
      const reviews = await getAllReviews();
      res.json(reviews);
    } catch (err) {
      console.error("GET /api/reviews error:", err);
      res.status(500).json({ error: "Failed to load reviews" });
    }
  });

  // PUT /api/reviews/:id
  // Upsert a review for a (pnmId, activeId) pair.
  const reviewBodySchema = z.object({
    pnmId: z.string(),
    activeId: z.string(),
    activeName: z.string(),
    pnmName: z.string(),
    stars: z.number().int().min(1).max(5),
    note: z.string().default(""),
  });
  app.put("/api/reviews/:id", async (req: Request, res: Response) => {
    const parsed = reviewBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid review body", details: parsed.error.flatten() });
      return;
    }
    try {
      const review = await upsertReview({ id: String(req.params.id), ...parsed.data });
      res.json(review);
    } catch (err) {
      console.error("PUT /api/reviews/:id error:", err);
      res.status(500).json({ error: "Failed to save review" });
    }
  });

  // DELETE /api/reviews/:id
  app.delete("/api/reviews/:id", async (req: Request, res: Response) => {
    try {
      await deleteReview(String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      console.error("DELETE /api/reviews/:id error:", err);
      res.status(500).json({ error: "Failed to delete review" });
    }
  });

  return httpServer;
}
