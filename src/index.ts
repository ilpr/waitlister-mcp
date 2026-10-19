#!/usr/bin/env node

// stdio entry point (the `waitlister-mcp` bin). The tools live in ./server.ts,
// which the tests also drive over an in-memory transport.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Waitlister, ACCOUNT_KEY_PREFIX } from "waitlister";
import { createWaitlisterServer, VERSION } from "./server.js";

// ─── Configuration ──────────────────────────────────────────────────────────
//
// Two auth modes (the SDK handles both):
// - Account key (recommended): WAITLISTER_ACCOUNT_KEY (wl_acct_…, account
//   Settings → API keys). One key for every waitlist you own, and unlocks
//   create_waitlist / list_waitlists. Works on every plan (subscriber data
//   tools still require Growth+).
// - Legacy per-waitlist key: WAITLISTER_API_KEY + WAITLISTER_WAITLIST_KEY
//   (Growth+). Existing configurations keep working unchanged.
//
// WAITLISTER_WAITLIST_KEY, when set, is the default waitlist for the
// waitlist-scoped tools; with an account key each tool can also target any
// owned waitlist via its optional `waitlist_key` parameter.

const ACCOUNT_KEY = process.env.WAITLISTER_ACCOUNT_KEY;
const API_KEY = process.env.WAITLISTER_API_KEY;
const DEFAULT_WAITLIST_KEY = process.env.WAITLISTER_WAITLIST_KEY;

if (!ACCOUNT_KEY && !API_KEY) {
  console.error(
    "Error: set WAITLISTER_ACCOUNT_KEY (recommended — wl_acct_…, from account " +
      "Settings → API keys, works on every plan) or WAITLISTER_API_KEY + " +
      "WAITLISTER_WAITLIST_KEY (per-waitlist key, Growth plan+)."
  );
  process.exit(1);
}

if (!ACCOUNT_KEY && API_KEY && !API_KEY.startsWith(ACCOUNT_KEY_PREFIX) && !DEFAULT_WAITLIST_KEY) {
  console.error(
    "Error: WAITLISTER_API_KEY is a per-waitlist key, so WAITLISTER_WAITLIST_KEY " +
      "is also required. (Account keys — wl_acct_… — don't need it.)"
  );
  process.exit(1);
}

// Identify ourselves on every API call. Without this an MCP tool call is
// byte-identical to any other SDK call, so nothing server-side can measure what
// agents actually do — see the AX notes in the marketing engine's ax.md. The
// host that drives us is added at initialize (see createWaitlisterServer).
const CLIENT = { name: "waitlister-mcp", version: VERSION };

const wl = ACCOUNT_KEY
  ? new Waitlister({ accountKey: ACCOUNT_KEY, waitlistKey: DEFAULT_WAITLIST_KEY, client: CLIENT })
  : new Waitlister({ apiKey: API_KEY, waitlistKey: DEFAULT_WAITLIST_KEY, client: CLIENT });

// ─── Start Server ───────────────────────────────────────────────────────────

async function main() {
  const server = createWaitlisterServer({
    client: wl,
    defaultWaitlistKey: DEFAULT_WAITLIST_KEY,
    waitlistKeyEnvVar: "WAITLISTER_WAITLIST_KEY",
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Waitlister MCP server ${VERSION} running on stdio`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
