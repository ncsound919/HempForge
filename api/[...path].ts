// Vercel catch-all API function: mounts the full Express app so every route
// works in production (billing, COA intake, audit, literature, autonomy, etc).
//
// Imports the PRE-BUILT esbuild bundle (dist/server.mjs) rather than the raw
// server.ts. Vercel transpiles an out-of-api/ TS import to a bare `server.js`
// but does NOT bundle its transitive graph, so Node ESM then cannot resolve the
// relative specifiers (ERR_MODULE_NOT_FOUND on ./src/services/...). The bundle
// is self-contained (only bare node_modules specifiers remain), which the
// runtime resolves from node_modules.
import type { IncomingMessage, ServerResponse } from "http";
import { buildApp } from "../dist/server.mjs";

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
