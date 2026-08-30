#!/usr/bin/env node

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  Waitlister,
  WaitlisterError,
  ACCOUNT_KEY_PREFIX,
  type WaitlistScope,
  type UpdateLandingPageParams,
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

// Read from package.json rather than a constant, so the version this server
// reports can never drift from the version that was published.
const { version: MCP_VERSION } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

// Identify ourselves on every API call. Without this an MCP tool call is
// byte-identical to any other SDK call, so nothing server-side can measure what
// agents actually do — see the AX notes in the marketing engine's ax.md. The
// host that drives us is added at initialize (main() below).
const CLIENT = { name: "waitlister-mcp", version: MCP_VERSION };

const wl = ACCOUNT_KEY
  ? new Waitlister({ accountKey: ACCOUNT_KEY, waitlistKey: DEFAULT_WAITLIST_KEY, client: CLIENT })
  : new Waitlister({ apiKey: API_KEY, waitlistKey: DEFAULT_WAITLIST_KEY, client: CLIENT });

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
  version: "1.3.0",
});

// ─── Tool: Create Waitlist ──────────────────────────────────────────────────

server.tool(
  "create_waitlist",
  "Create a new waitlist on your Waitlister account (requires an account key, works on every plan within its waitlist cap). Returns the waitlist key and a form_action_url that collects signups immediately. Pass landing_page to also provision the hosted landing page (as a draft — go live with publish_landing_page) in the same call. Note: waitlist names and URL slugs are unique across all of Waitlister — a taken name/slug is rejected with guidance to pick another.",
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
    landing_page: z
      .object({
        headline: z
          .string()
          .min(3)
          .max(120)
          .describe("The page's main title (3-120 characters, plain text)"),
        description: z.string().max(1000).optional(),
        button_text: z.string().max(40).optional(),
        collect_name: z.boolean().optional(),
        collect_phone: z.boolean().optional(),
        theme: z.enum(["light", "dark"]).optional(),
      })
      .optional()
      .describe(
        "Also create the hosted landing page (draft) in the same request. headline required. More fields (background, SEO) via update_landing_page afterwards."
      ),
  },
  async ({
    name,
    slug,
    description,
    category,
    referral_rewards_enabled,
    validate_emails,
    landing_page,
  }) =>
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
        ...(landing_page !== undefined
          ? {
              landingPage: {
                headline: landing_page.headline,
                description: landing_page.description,
                buttonText: landing_page.button_text,
                collectName: landing_page.collect_name,
                collectPhone: landing_page.collect_phone,
                theme: landing_page.theme,
              },
            }
          : {}),
      })
    )
);

// ─── Tool: Get Account ──────────────────────────────────────────────────────

server.registerTool(
  "get_account",
  {
    description:
      "Check the configured API key and what this account may do — the cheapest first call, and the one to make when anything looks misconfigured. Returns the account, the plan name, whether the general API is available, how many waitlists the account has against its cap, whether creating another would succeed right now (can_create — a true dry run, so check it before create_waitlist rather than discovering the cap from an error), remaining AI credits, and the key's name/created/last-used. An invalid or revoked key fails here cleanly, which distinguishes a dead key from a malformed request. Requires an account key (wl_acct_…) and works on every plan. Never returns the key itself.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => run(() => wl.me())
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

// ─── Landing-page tools ─────────────────────────────────────────────────────
//
// Works on every plan. One page per waitlist; pages are drafts until
// published. Two page types: "standard" (built from the structured fields
// below, editable in the dashboard's drag-and-drop editor) and "ai" (built by
// generate_landing_page — its copy lives inside the generated page, so the
// structured copy fields 409 on update; use generate with is_edit instead;
// theme and seo update fine on both types).

const landingPageContentShape = {
  headline: z
    .string()
    .min(3)
    .max(120)
    .optional()
    .describe("The page's main title (3-120 characters, plain text — no HTML)"),
  description: z
    .string()
    .max(1000)
    .optional()
    .describe("Supporting copy under the headline (max 1000 characters, plain text)"),
  button_text: z
    .string()
    .max(40)
    .optional()
    .describe('Submit-button label (max 40 characters, default "Join the waitlist")'),
  collect_name: z
    .boolean()
    .optional()
    .describe("Add (true) or remove (false) a name input on the signup form"),
  collect_phone: z
    .boolean()
    .optional()
    .describe("Add (true) or remove (false) a phone input on the signup form"),
  background: z
    .object({
      type: z.enum(["color", "gradient"]),
      value: z
        .string()
        .describe(
          'Hex color (e.g. "#0F172A") or CSS gradient string (e.g. "linear-gradient(to right, #0F172A, #1E293B)")'
        ),
    })
    .optional()
    .describe("Page background (image backgrounds are dashboard-only)"),
  theme: z.enum(["light", "dark"]).optional().describe("Page theme"),
  seo: z
    .object({
      title: z.string().max(70).optional(),
      description: z.string().max(200).optional(),
      keywords: z.array(z.string().max(40)).max(10).optional(),
      og_title: z.string().max(70).optional(),
      og_description: z.string().max(200).optional(),
    })
    .optional()
    .describe("Search/social metadata for the hosted page"),
};

type LandingPageContentArgs = {
  headline?: string;
  description?: string;
  button_text?: string;
  collect_name?: boolean;
  collect_phone?: boolean;
  background?: { type: "color" | "gradient"; value: string };
  theme?: "light" | "dark";
  seo?: {
    title?: string;
    description?: string;
    keywords?: string[];
    og_title?: string;
    og_description?: string;
  };
};

function toLandingPageParams(args: LandingPageContentArgs): UpdateLandingPageParams {
  return {
    headline: args.headline,
    description: args.description,
    buttonText: args.button_text,
    collectName: args.collect_name,
    collectPhone: args.collect_phone,
    background: args.background,
    theme: args.theme,
    ...(args.seo
      ? {
          seo: {
            title: args.seo.title,
            description: args.seo.description,
            keywords: args.seo.keywords,
            ogTitle: args.seo.og_title,
            ogDescription: args.seo.og_description,
          },
        }
      : {}),
  };
}

server.registerTool(
  "get_landing_page",
  {
    description:
      "Get the structured view of a waitlist's hosted landing page: status (draft/published/unpublished), page_type (standard or ai), copy fields, theme, SEO, the live URL (null until published), and view/signup analytics. AI-built pages also return remaining AI credits. Works on every plan. 404 if the waitlist has no page yet — create one with create_landing_page.",
    inputSchema: { waitlist_key: waitlistKeyParam },
    annotations: { readOnlyHint: true },
  },
  async ({ waitlist_key }) => run(() => scopeFor(waitlist_key).landingPage.get())
);

server.registerTool(
  "create_landing_page",
  {
    description:
      "Create the waitlist's hosted landing page from structured fields, as a draft (nothing goes live until publish_landing_page). One page per waitlist — returns a 409 error if one already exists (use update_landing_page then). headline is required. Works on every plan. Tip: when creating a new waitlist AND its page, use create_waitlist's landing_page parameter instead — one call.",
    inputSchema: {
      ...landingPageContentShape,
      headline: z
        .string()
        .min(3)
        .max(120)
        .describe("The page's main title (3-120 characters, plain text — no HTML)"),
      waitlist_key: waitlistKeyParam,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ waitlist_key, ...content }) =>
    run(() =>
      scopeFor(waitlist_key).landingPage.create({
        ...toLandingPageParams(content),
        headline: content.headline,
      })
    )
);

server.registerTool(
  "update_landing_page",
  {
    description:
      "Update any subset of the landing page's structured fields. On a published page the change goes live immediately. IMPORTANT: on an AI-built page (page_type \"ai\"), the copy/structure fields (headline, description, button_text, collect_name, collect_phone, background) return a 409 error — edit those with generate_landing_page and is_edit: true; theme and seo still work here on both page types. Works on every plan.",
    inputSchema: { ...landingPageContentShape, waitlist_key: waitlistKeyParam },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async ({ waitlist_key, ...content }) =>
    run(() => scopeFor(waitlist_key).landingPage.update(toLandingPageParams(content)))
);

server.registerTool(
  "publish_landing_page",
  {
    description:
      "Publish the landing page to its live URL (https://waitlister.me/p/{slug}, or the waitlist's custom domain) — or take it offline with unpublish: true. Publishing validates the page has an email field, a submit button, and a headline of at least 3 characters. API publishes skip the custom social-share (OG) image; publishing once from the dashboard generates it. Works on every plan.",
    inputSchema: {
      unpublish: z
        .boolean()
        .optional()
        .describe("true takes the page offline instead of publishing it"),
      waitlist_key: waitlistKeyParam,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async ({ unpublish, waitlist_key }) =>
    run(() =>
      unpublish
        ? scopeFor(waitlist_key).landingPage.unpublish()
        : scopeFor(waitlist_key).landingPage.publish()
    )
);

server.registerTool(
  "generate_landing_page",
  {
    description:
      "Generate a complete custom landing page from a natural-language prompt with Waitlister's AI builder (same engine as the dashboard), or edit the existing AI page with is_edit: true. COSTS 1 AI CREDIT per call (shared with the dashboard AI builder; errors with the balance when out of credits) — don't call repeatedly for small tweaks a human should review. Synchronous, typically 20-50 seconds. The result is saved as a draft: review in the dashboard or go live with publish_landing_page. The AI conversation is saved, so the dashboard's AI chat continues where this left off. After generating, the page is an AI page — see update_landing_page for what that changes.",
    inputSchema: {
      prompt: z
        .string()
        .max(2000)
        .describe('What to build or change, in natural language (e.g. "dark, bold, dev-tool aesthetic")'),
      is_edit: z
        .boolean()
        .optional()
        .describe(
          "true edits the existing AI page instead of generating a fresh one (409 if there is no AI page yet)"
        ),
      waitlist_key: waitlistKeyParam,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ prompt, is_edit, waitlist_key }) =>
    run(() => scopeFor(waitlist_key).landingPage.generate({ prompt, isEdit: is_edit }))
);

// ─── Start Server ───────────────────────────────────────────────────────────

async function main() {
  // The host only names itself in the initialize handshake, which lands after
  // connect() — so hook the notification rather than reading it inline. The SDK
  // sanitizes the value; a host names itself whatever it likes.
  server.server.oninitialized = () => {
    const host = server.server.getClientVersion();
    if (!host?.name) return;
    wl.setAgent(host.version ? `${host.name}/${host.version}` : host.name);
  };

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Waitlister MCP server ${MCP_VERSION} running on stdio`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
