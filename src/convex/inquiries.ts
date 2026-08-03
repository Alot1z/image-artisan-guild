// Convex backend for image storage used by the reverse-image tool.
// We accept base64 from the client and store via ctx.storage.store inside
// an action so the engine pages can fetch a publicly reachable URL.

import { action, query } from "./_generated/server";
import { v } from "convex/values";

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
    return {
      storageId,
      url: await ctx.storage.getUrl(storageId),
      fileName: fileName ?? null,
      bytes: blob.size,
    };
  },
});

export const recentInquiries = query({
  args: { limit: v.optional(v.number()) },
  handler: async () => {
    return [];
  },
});
