#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  Waitlister,
  WaitlisterError,
  ACCOUNT_KEY_PREFIX,
  type WaitlistScope,
} from "waitlister";

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

const wl = ACCOUNT_KEY
  ? new Waitlister({ accountKey: ACCOUNT_KEY, waitlistKey: DEFAULT_WAITLIST_KEY })
  : new Waitlister({ apiKey: API_KEY, waitlistKey: DEFAULT_WAITLIST_KEY });

/** Resolve the waitlist scope for a tool call: explicit param > env default. */
function scopeFor(waitlistKey?: string): WaitlistScope {
  const key = waitlistKey ?? DEFAULT_WAITLIST_KEY;
  if (!key) {
    throw new Error(
      "No waitlist specified. Pass `waitlist_key` (find keys with the " +
        "list_waitlists tool) or set the WAITLISTER_WAITLIST_KEY environment variable."
    );
  }
  return wl.waitlist(key);
}

// ─── MCP response helpers ───────────────────────────────────────────────────

function textResponse(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResponse(error: unknown) {
  const message =
    error instanceof WaitlisterError || error instanceof Error
      ? error.message
      : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

/** Run a tool body, mapping SDK errors to clean MCP error responses. */
async function run(fn: () => Promise<unknown>) {
  try {
    return textResponse(await fn());
  } catch (error) {
    return errorResponse(error);
  }
}

// Shared parameter: which waitlist a scoped tool targets.
const waitlistKeyParam = z
  .string()
  .optional()
  .describe(
    "The waitlist key (12 characters, from list_waitlists or the dashboard). " +
      "Optional if WAITLISTER_WAITLIST_KEY is set."
  );

// ─── Server ─────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "waitlister",
  version: "1.1.0",
});

// ─── Tool: Create Waitlist ──────────────────────────────────────────────────

server.tool(
  "create_waitlist",
  "Create a new waitlist on your Waitlister account (requires an account key, works on every plan within its waitlist cap). Returns the waitlist key and a form_action_url that collects signups immediately. Note: waitlist names and URL slugs are unique across all of Waitlister — a taken name/slug is rejected with guidance to pick another.",
  {
    name: z.string().describe("The product/waitlist name"),
    slug: z
      .string()
      .optional()
      .describe("URL slug (derived from name when omitted; must be globally unique)"),
    description: z.string().optional().describe("Internal description"),
    category: z.string().optional().describe("Product category"),
    referral_rewards_enabled: z
      .boolean()
      .optional()
      .describe("Enable the referral program (points for signups and referrals)"),
    validate_emails: z
      .boolean()
      .optional()
      .describe("Validate email deliverability at signup (default true)"),
  },
  async ({ name, slug, description, category, referral_rewards_enabled, validate_emails }) =>
    run(() =>
      wl.waitlists.create({
        name,
        slug,
        description,
        category,
        ...(referral_rewards_enabled !== undefined
          ? { referralRewards: { enabled: referral_rewards_enabled } }
          : {}),
        validateEmails: validate_emails,
      })
    )
);

// ─── Tool: List Waitlists ───────────────────────────────────────────────────

server.tool(
  "list_waitlists",
  "List every waitlist your account owns, with subscriber and view counts (requires an account key).",
  {},
  async () => run(() => wl.waitlists.list())
);

// ─── Tool: Get Stats ────────────────────────────────────────────────────────

server.tool(
  "get_stats",
  "Get a waitlist's subscriber and view counters — cheap social proof, works on every plan. Counters update asynchronously (within seconds of a signup or delete).",
  { waitlist_key: waitlistKeyParam },
  async ({ waitlist_key }) => run(() => scopeFor(waitlist_key).stats())
);

// ─── Tool: Add Subscriber ───────────────────────────────────────────────────

server.tool(
  "add_subscriber",
  "Add a new subscriber to a waitlist. Returns their position, referral code, and sign-up token. Idempotent per email: an existing email returns is_new_sign_up: false with their current position, not an error. Works on every plan.",
  {
    email: z.string().email().describe("The subscriber's email address"),
    name: z.string().optional().describe("The subscriber's name"),
    phone: z.string().optional().describe("The subscriber's phone number"),
    referred_by: z
      .string()
      .optional()
      .describe("Referral code of the person who referred this subscriber"),
    metadata: z
      .record(z.string())
      .optional()
      .describe(
        "Additional custom fields to store with the subscriber (e.g. company, role)"
      ),
    waitlist_key: waitlistKeyParam,
  },
  async ({ email, name, phone, referred_by, metadata, waitlist_key }) =>
    run(() =>
      scopeFor(waitlist_key).signUp({
        email,
        name,
        phone,
        referredBy: referred_by,
        metadata,
      })
    )
);

// ─── Tool: List Subscribers ─────────────────────────────────────────────────

server.tool(
  "list_subscribers",
  "Retrieve a paginated list of a waitlist's subscribers, sortable by position, points, date, referral_count, or email. Requires the Growth plan or higher.",
  {
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Number of results to return (1-100, default 20)"),
    page: z
      .number()
      .min(1)
      .default(1)
      .describe("Page number for pagination (default 1)"),
    sort_by: z
      .enum(["position", "points", "date", "referral_count", "email"])
      .default("date")
      .describe("Field to sort by (default: date)"),
    sort_dir: z
      .enum(["asc", "desc"])
      .default("desc")
      .describe("Sort direction (default: desc)"),
    waitlist_key: waitlistKeyParam,
  },
  async ({ limit, page, sort_by, sort_dir, waitlist_key }) =>
    run(() =>
      scopeFor(waitlist_key).subscribers.list({
        limit,
        page,
        sortBy: sort_by,
        sortDir: sort_dir,
      })
    )
);

// ─── Tool: Get Subscriber ───────────────────────────────────────────────────

server.tool(
  "get_subscriber",
  "Retrieve detailed information about a specific subscriber by their ID or email address — position, points, referral info, metadata, location, and more. Requires the Growth plan or higher.",
  {
    id_or_email: z.string().describe("The subscriber's unique ID or email address"),
    waitlist_key: waitlistKeyParam,
  },
  async ({ id_or_email, waitlist_key }) =>
    run(() => scopeFor(waitlist_key).subscribers.get(id_or_email))
);

// ─── Tool: Update Subscriber ────────────────────────────────────────────────

server.tool(
  "update_subscriber",
  "Update an existing subscriber's name, phone, points, and/or custom metadata. Only include fields you want to change; updating points triggers a queue position recalculation. Requires the Growth plan or higher.",
  {
    id_or_email: z.string().describe("The subscriber's unique ID or email address"),
    name: z.string().optional().describe("Updated name"),
    phone: z.string().optional().describe("Updated phone number"),
    points: z.number().optional().describe("Updated points value"),
    metadata: z
      .record(z.string())
      .optional()
      .describe("Custom fields to add or update (merged with existing metadata)"),
    waitlist_key: waitlistKeyParam,
  },
  async ({ id_or_email, name, phone, points, metadata, waitlist_key }) =>
    run(() =>
      scopeFor(waitlist_key).subscribers.update(id_or_email, {
        name,
        phone,
        points,
        metadata,
      })
    )
);

// ─── Tool: Delete Subscriber ────────────────────────────────────────────────

server.tool(
  "delete_subscriber",
  "Permanently delete a subscriber (and their email history) from a waitlist by ID or email address. This cannot be undone. Counters and queue positions update asynchronously within a few seconds. Requires the Growth plan or higher.",
  {
    id_or_email: z.string().describe("The subscriber's unique ID or email address"),
    waitlist_key: waitlistKeyParam,
  },
  async ({ id_or_email, waitlist_key }) =>
    run(() => scopeFor(waitlist_key).subscribers.delete(id_or_email))
);

// ─── Tool: Log View ─────────────────────────────────────────────────────────

server.tool(
  "log_view",
  "Record a view of a waitlist page — useful for tracking engagement and conversion rates when you host your own landing page.",
  {
    visitor_id: z
      .string()
      .optional()
      .describe("Unique identifier for the visitor (prevents duplicate counts)"),
    referring_domain: z
      .string()
      .optional()
      .describe("Domain that referred the view"),
    waitlist_key: waitlistKeyParam,
  },
  async ({ visitor_id, referring_domain, waitlist_key }) =>
    run(() =>
      scopeFor(waitlist_key).analytics.logView({
        visitorId: visitor_id,
        metadata: referring_domain ? { referring_domain } : undefined,
      })
    )
);

// ─── Start Server ───────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Waitlister MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
