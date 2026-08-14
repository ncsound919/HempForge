// Vercel catch-all API function: mounts the full Express app so every route
// works in production (billing, COA intake, audit, literature, autonomy, etc).
//
// The request URL passed to a Vercel function is the original path (e.g.
// /api/billing/webhook), which matches the routes the SPA calls. Background
// cron jobs are skipped on Vercel (see server.ts IS_VERCEL gate) — long-lived
// schedulers stay on Docker; Vercel Cron can drive /api/* if needed.
import type { IncomingMessage, ServerResponse } from "http";
import { buildApp } from "../server.js";

let cachedApp: any = null;

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (!cachedApp) {
    cachedApp = await buildApp();
  }
  await cachedApp(req, res);
}
