// Convex backend for image storage used by the reverse-image tool.
//
// We accept base64 from the client and store via ctx.storage.store inside
// an action so the engine pages can fetch a publicly reachable URL.
//
// The Inquisitor treats this as an EPHEMERAL host: every upload is recorded
// in the `hostedImages` table, and a scheduled cron (`src/convex/crons.ts`)
// purges entries older than HOSTED_TTL_MS — deleting both the row and the
// underlying storage blob. No image content or search history is retained
// beyond that window.

import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

/** Images remain publicly reachable for this long after upload. */
export const HOSTED_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const storeImage = action({
  args: {
    base64: v.string(),
    mimeType: v.string(),
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, { base64, mimeType, fileName }) => {
    const binary = atob(base64);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
    const blob = new Blob([buffer], { type: mimeType });
    const storageId = await ctx.storage.store(blob);
    // Track the upload so the cleanup cron can expire it later.
    await ctx.runMutation(internal.inquiries.recordHosted, {
      storageId,
      bytes: blob.size,
      fileName,
    });
    return {
      storageId,
      url: await ctx.storage.getUrl(storageId),
      fileName: fileName ?? null,
      bytes: blob.size,
    };
  },
});

export const recordHosted = internalMutation({
  args: {
    storageId: v.string(),
    bytes: v.number(),
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, { storageId, bytes, fileName }) => {
    await ctx.db.insert("hostedImages", {
      storageId,
      bytes,
      fileName,
      createdAt: Date.now(),
    });
  },
});

export const listStaleHosted = internalQuery({
  args: { before: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { before, limit }) => {
    return ctx.db
      .query("hostedImages")
      .withIndex("by_createdAt", (q) => q.lte("createdAt", before))
      .order("asc")
      .take(limit ?? 200);
  },
});

export const deleteHostedRecord = internalMutation({
  args: { id: v.id("hostedImages") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

/** Expire every hosted image older than HOSTED_TTL_MS. Runs from a cron. */
export const purgeHostedImages = internalAction({
  handler: async (ctx): Promise<{ purged: number; scanned: number; before: number }> => {
    const before = Date.now() - HOSTED_TTL_MS;
    const stale = await ctx.runQuery(internal.inquiries.listStaleHosted, { before });
    let purged = 0;
    const storageDelete = ctx.storage.delete.bind(ctx.storage);
    for (const doc of stale) {
      try {
        // storageId is a branded StorageId at runtime; the registry stores it
        // as a plain string so we cast via the delete param type.
        await storageDelete(doc.storageId as Parameters<typeof storageDelete>[0]);
      } catch {
        // Blob may already be gone; still drop the registry row.
      }
      await ctx.runMutation(internal.inquiries.deleteHostedRecord, { id: doc._id });
      purged += 1;
    }
    return { purged, scanned: stale.length, before };
  },
});

/** Public, privacy-scrubbed list of recent host activity (no blobs, no names). */
export const recentInquiries = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("hostedImages")
      .order("desc")
      .take(Math.min(limit ?? 20, 50));
    return rows.map((r) => ({ createdAt: r.createdAt, bytes: r.bytes }));
  },
});
