// The Waitlister MCP tool layer. src/index.ts (the `waitlister-mcp` bin) runs
// it over stdio with the key from env; test/tools.test.mjs runs it over an
// in-memory transport with a mocked fetch. No Node-only APIs in this file.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  Waitlister,
  WaitlisterError,
  type WaitlistScope,
  type UpdateLandingPageParams,
} from "waitlister";
import { VERSION } from "./version.js";

export { VERSION };

export interface WaitlisterServerOptions {
  /** A configured SDK client: an account key or a legacy per-waitlist key. */
  client: Waitlister;
  /** Default waitlist for the waitlist-scoped tools (WAITLISTER_WAITLIST_KEY). */
  defaultWaitlistKey?: string;
  /**
   * Name of the env var that sets the default waitlist, mentioned in tool
   * descriptions and errors. Omitted, the text names no env var.
   */
  waitlistKeyEnvVar?: string;
}

// ─── Tool annotations ───────────────────────────────────────────────────────
//
// Every tool declares a title and all four hints. The Anthropic and OpenAI
// directories both review these: Anthropic requires a title plus
// readOnlyHint/destructiveHint on every tool (destructive tools always prompt
// in Claude); OpenAI wants openWorldHint true for anything that publishes
// content or messages people outside the account. Semantics follow the MCP
// spec: destructive = may overwrite or remove existing data, not just add;
// open world = reaches beyond the user's own account. When a case is
// borderline we declare the riskier value.

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// Subscriber tags: named case-insensitively or by id (`tag_…`). Limits mirror
// the dashboard: 20 tags per waitlist, 30 characters per name.
const tagName = z.string().min(1).max(30);
const tagNames = z.array(tagName).max(20);

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

// ─── Landing-page shapes ────────────────────────────────────────────────────
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

// ─── Server ─────────────────────────────────────────────────────────────────

export function createWaitlisterServer({
  client: wl,
  defaultWaitlistKey,
  waitlistKeyEnvVar,
}: WaitlisterServerOptions): McpServer {
  const server = new McpServer({ name: "waitlister", version: VERSION });

  // The host names itself in the initialize handshake, which lands after
  // connect() — so hook the notification rather than reading it inline. The SDK
  // sanitizes the value; a host names itself whatever it likes.
  server.server.oninitialized = () => {
    const host = server.server.getClientVersion();
    if (!host?.name) return;
    wl.setAgent(host.version ? `${host.name}/${host.version}` : host.name);
  };

  /** Resolve the waitlist scope for a tool call: explicit param > configured default. */
  function scopeFor(waitlistKey?: string): WaitlistScope {
    const key = waitlistKey ?? defaultWaitlistKey;
    if (!key) {
      throw new Error(
        "No waitlist specified. Pass `waitlist_key` (find keys with the list_waitlists tool)" +
          (waitlistKeyEnvVar ? ` or set the ${waitlistKeyEnvVar} environment variable.` : ".")
      );
    }
    return wl.waitlist(key);
  }

  // Shared parameter: which waitlist a scoped tool targets.
  const waitlistKeyParam = z
    .string()
    .optional()
    .describe(
      "The waitlist key (12 characters, from list_waitlists or the dashboard)." +
        (waitlistKeyEnvVar ? ` Optional if ${waitlistKeyEnvVar} is set.` : "")
    );

  // ─── Tool: Create Waitlist ────────────────────────────────────────────────

  server.registerTool(
    "create_waitlist",
    {
      title: "Create waitlist",
      description:
        "Create a new waitlist on your Waitlister account (requires an account key, works on every plan within its waitlist cap). Returns the waitlist key and a form_action_url that collects signups immediately. Pass landing_page to also provision the hosted landing page (as a draft — go live with publish_landing_page) in the same call. Note: waitlist names and URL slugs are unique across all of Waitlister — a taken name/slug is rejected with guidance to pick another.",
      inputSchema: {
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
      // Additive, private until something is published. Not idempotent: a
      // second call is a second waitlist (or a taken-name rejection).
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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

  // ─── Tool: Get Account ────────────────────────────────────────────────────

  server.registerTool(
    "get_account",
    {
      title: "Get account",
      description:
        "Check the configured API key and what this account may do — the cheapest first call, and the one to make when anything looks misconfigured. Returns the account, the plan name, whether the general API is available, how many waitlists the account has against its cap, whether creating another would succeed right now (can_create — a true dry run, so check it before create_waitlist rather than discovering the cap from an error), remaining AI credits, and the key's name/created/last-used. An invalid or revoked key fails here cleanly, which distinguishes a dead key from a malformed request. Requires an account key (wl_acct_…) and works on every plan. Never returns the key itself.",
      inputSchema: {},
      annotations: READ,
    },
    async () => run(() => wl.me())
  );

  // ─── Tool: List Waitlists ─────────────────────────────────────────────────

  server.registerTool(
    "list_waitlists",
    {
      title: "List waitlists",
      description:
        "List every waitlist your account owns, with subscriber and view counts (requires an account key).",
      inputSchema: {},
      annotations: READ,
    },
    async () => run(() => wl.waitlists.list())
  );

  // ─── Tool: Get Stats ──────────────────────────────────────────────────────

  server.registerTool(
    "get_stats",
    {
      title: "Get waitlist stats",
      description:
        "Get a waitlist's subscriber and view counters. Works on every plan. Counters update asynchronously (within seconds of a signup or delete).",
      inputSchema: { waitlist_key: waitlistKeyParam },
      annotations: READ,
    },
    async ({ waitlist_key }) => run(() => scopeFor(waitlist_key).stats())
  );

  // ─── Tool: Add Subscriber ─────────────────────────────────────────────────

  server.registerTool(
    "add_subscriber",
    {
      title: "Add subscriber",
      description:
        "Add a new subscriber to a waitlist. Returns their position, referral code, and sign-up token. Idempotent per email: an existing email returns is_new_sign_up: false with their current position, not an error. If the waitlist uses double opt-in or welcome emails, the subscriber is emailed, exactly as with a form signup. Works on every plan.",
      inputSchema: {
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
      // Additive and idempotent per email, but open world: a double opt-in
      // or welcome email goes to the subscriber, who is outside the account.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
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

  // ─── Tool: List Subscribers ───────────────────────────────────────────────

  server.registerTool(
    "list_subscribers",
    {
      title: "List subscribers",
      description:
        "Retrieve a paginated list of a waitlist's subscribers (each with its tags), sortable by position, points, date, referral_count, or email, and optionally filtered to one tag. Requires the Growth plan or higher.",
      inputSchema: {
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
        tag: tagName
          .optional()
          .describe("Only subscribers with this tag: a tag name (case-insensitive) or id. See list_tags"),
        waitlist_key: waitlistKeyParam,
      },
      annotations: READ,
    },
    async ({ limit, page, sort_by, sort_dir, tag, waitlist_key }) =>
      run(() =>
        scopeFor(waitlist_key).subscribers.list({
          limit,
          page,
          sortBy: sort_by,
          sortDir: sort_dir,
          tag,
        })
      )
  );

  // ─── Tool: Get Subscriber ─────────────────────────────────────────────────

  server.registerTool(
    "get_subscriber",
    {
      title: "Get subscriber",
      description:
        "Retrieve detailed information about a specific subscriber by their ID or email address — position, points, referral info, tags, metadata, location, and more. Requires the Growth plan or higher.",
      inputSchema: {
        id_or_email: z.string().describe("The subscriber's unique ID or email address"),
        waitlist_key: waitlistKeyParam,
      },
      annotations: READ,
    },
    async ({ id_or_email, waitlist_key }) =>
      run(() => scopeFor(waitlist_key).subscribers.get(id_or_email))
  );

  // ─── Tool: Update Subscriber ──────────────────────────────────────────────

  server.registerTool(
    "update_subscriber",
    {
      title: "Update subscriber",
      description:
        "Update an existing subscriber's name, phone, points, custom metadata, and/or tags. Only include fields you want to change; updating points triggers a queue position recalculation. Tags are named case-insensitively (or by id): add_tags and remove_tags change some, tags replaces the whole set. A tag name the waitlist doesn't have yet is created, so call list_tags first and reuse an existing name rather than creating a near-duplicate. Requires the Growth plan or higher.",
      inputSchema: {
        id_or_email: z.string().describe("The subscriber's unique ID or email address"),
        name: z.string().optional().describe("Updated name"),
        phone: z.string().optional().describe("Updated phone number"),
        points: z.number().optional().describe("Updated points value"),
        metadata: z
          .record(z.string())
          .optional()
          .describe("Custom fields to add or update (merged with existing metadata)"),
        add_tags: tagNames
          .optional()
          .describe("Tags to add, by name or id. New names create a tag (max 20 per waitlist, 30 characters each)"),
        remove_tags: tagNames
          .optional()
          .describe("Tags to remove, by name or id. Tags the subscriber doesn't have are ignored"),
        tags: tagNames
          .optional()
          .describe("Replace the subscriber's tags with exactly this set ([] removes all). Not combinable with add_tags/remove_tags"),
        waitlist_key: waitlistKeyParam,
      },
      // Overwrites existing values (tags replaces the set), and points changes
      // reorder the queue.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id_or_email, name, phone, points, metadata, add_tags, remove_tags, tags, waitlist_key }) =>
      run(() =>
        scopeFor(waitlist_key).subscribers.update(id_or_email, {
          name,
          phone,
          points,
          metadata,
          addTags: add_tags,
          removeTags: remove_tags,
          tags,
        })
      )
  );

  // ─── Tool: Delete Subscriber ──────────────────────────────────────────────

  server.registerTool(
    "delete_subscriber",
    {
      title: "Delete subscriber",
      description:
        "Permanently delete a subscriber (and their email history) from a waitlist by ID or email address. This cannot be undone. Counters and queue positions update asynchronously within a few seconds. Requires the Growth plan or higher.",
      inputSchema: {
        id_or_email: z.string().describe("The subscriber's unique ID or email address"),
        waitlist_key: waitlistKeyParam,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id_or_email, waitlist_key }) =>
      run(() => scopeFor(waitlist_key).subscribers.delete(id_or_email))
  );

  // ─── Tool: List Tags ──────────────────────────────────────────────────────

  server.registerTool(
    "list_tags",
    {
      title: "List tags",
      description:
        "List a waitlist's subscriber tags (the dashboard's Tags column) and how many subscribers have each. Use these names with list_subscribers' tag filter and update_subscriber's add_tags/remove_tags. Requires the Growth plan or higher.",
      inputSchema: {
        waitlist_key: waitlistKeyParam,
      },
      annotations: READ,
    },
    async ({ waitlist_key }) => run(() => scopeFor(waitlist_key).tags.list())
  );

  // ─── Tool: Log View ───────────────────────────────────────────────────────

  server.registerTool(
    "log_view",
    {
      title: "Log page view",
      description:
        "Record a view of a waitlist page — useful for tracking engagement and conversion rates when you host your own landing page.",
      inputSchema: {
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
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ visitor_id, referring_domain, waitlist_key }) =>
      run(() =>
        scopeFor(waitlist_key).analytics.logView({
          visitorId: visitor_id,
          metadata: referring_domain ? { referring_domain } : undefined,
        })
      )
  );

  // ─── Landing-page tools ───────────────────────────────────────────────────

  server.registerTool(
    "get_landing_page",
    {
      title: "Get landing page",
      description:
        "Get the structured view of a waitlist's hosted landing page: status (draft/published/unpublished), page_type (standard or ai), copy fields, theme, SEO, the live URL (null until published), and view/signup analytics. AI-built pages also return remaining AI credits. Works on every plan. 404 if the waitlist has no page yet — create one with create_landing_page.",
      inputSchema: { waitlist_key: waitlistKeyParam },
      annotations: READ,
    },
    async ({ waitlist_key }) => run(() => scopeFor(waitlist_key).landingPage.get())
  );

  server.registerTool(
    "create_landing_page",
    {
      title: "Create landing page",
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
      // A private draft, and an existing page is never overwritten (409).
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
      title: "Update landing page",
      description:
        "Update any subset of the landing page's structured fields. On a published page the change goes live immediately. IMPORTANT: on an AI-built page (page_type \"ai\"), the copy/structure fields (headline, description, button_text, collect_name, collect_phone, background) return a 409 error — edit those with generate_landing_page and is_edit: true; theme and seo still work here on both page types. Works on every plan.",
      inputSchema: { ...landingPageContentShape, waitlist_key: waitlistKeyParam },
      // Overwrites copy, and on a published page the change is public at once.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ waitlist_key, ...content }) =>
      run(() => scopeFor(waitlist_key).landingPage.update(toLandingPageParams(content)))
  );

  server.registerTool(
    "publish_landing_page",
    {
      title: "Publish landing page",
      description:
        "Publish the landing page to its live URL (https://waitlister.me/p/{slug}, or the waitlist's custom domain), making it publicly visible. Publishing validates the page has an email field, a submit button, and a headline of at least 3 characters. API publishes skip the custom social-share (OG) image; publishing once from the dashboard generates it. To take a page offline, use unpublish_landing_page. Works on every plan.",
      inputSchema: {
        // Before 1.5.0 this tool also unpublished. The parameter stays so an
        // old call can't be silently stripped by input validation and publish
        // a page the caller meant to take down.
        unpublish: z
          .boolean()
          .optional()
          .describe("Removed in 1.5.0 — use unpublish_landing_page. Passing true is refused and changes nothing."),
        waitlist_key: waitlistKeyParam,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ unpublish, waitlist_key }) =>
      unpublish
        ? errorResponse(
            new Error(
              "publish_landing_page no longer unpublishes, and nothing was changed. To take the page offline, call unpublish_landing_page."
            )
          )
        : run(() => scopeFor(waitlist_key).landingPage.publish())
  );

  server.registerTool(
    "unpublish_landing_page",
    {
      title: "Unpublish landing page",
      description:
        "Take the published landing page offline (status becomes \"unpublished\"); its URL stops serving the page and stops collecting signups. The page and its subscribers are kept, and publish_landing_page brings it back. Works on every plan.",
      inputSchema: { waitlist_key: waitlistKeyParam },
      // Removes a public page from the internet. Re-publishable, but per both
      // directories an undo path doesn't make an action non-destructive.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ waitlist_key }) => run(() => scopeFor(waitlist_key).landingPage.unpublish())
  );

  server.registerTool(
    "generate_landing_page",
    {
      title: "Generate landing page with AI",
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
      // Replaces the page's content (and spends a credit), but the result is
      // a draft, so nothing public changes until publish_landing_page.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async ({ prompt, is_edit, waitlist_key }) =>
      run(() => scopeFor(waitlist_key).landingPage.generate({ prompt, isEdit: is_edit }))
  );

  return server;
}
