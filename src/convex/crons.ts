// Scheduled jobs — currently a single sweep that expires hosted image blobs
// older than HOSTED_TTL_MS (see src/convex/inquiries.ts). This is what makes
// the Inquisitor's image host genuinely ephemeral: no blob lives forever.

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "purge-expired-hosted-images",
  { hours: 6 },
  internal.inquiries.purgeHostedImages,
);

export default crons;
