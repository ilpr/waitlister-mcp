#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Configuration
const API_BASE = "https://waitlister.me/api/v1";
const API_KEY = process.env.WAITLISTER_API_KEY;
const WAITLIST_KEY = process.env.WAITLISTER_WAITLIST_KEY;

if (!API_KEY) {
  console.error("Error: WAITLISTER_API_KEY environment variable is required.");
  process.exit(1);
}

if (!WAITLIST_KEY) {
  console.error(
    "Error: WAITLISTER_WAITLIST_KEY environment variable is required."
  );
  process.exit(1);
}

// Helper: make authenticated API requests
async function apiRequest(
  path: string,
  options: RequestInit = {}
): Promise<unknown> {
  const url = `${API_BASE}/waitlist/${WAITLIST_KEY}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY!,
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    const errorMessage =
      typeof data === "object" && data !== null && "message" in data
        ? (data as { message: string }).message
        : `API error: ${response.status} ${response.statusText}`;
    throw new Error(errorMessage);
  }

  return data;
}

// Helper: format response for MCP
function textResponse(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

// Create server
const server = new McpServer({
  name: "waitlister",
  version: "1.0.0",
});

// ─── Tool: Add Subscriber ───────────────────────────────────────────────────

server.tool(
  "add_subscriber",
  "Add a new subscriber to your Waitlister waitlist. Returns their position, referral code, and sign-up token.",
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
  },
  async ({ email, name, phone, referred_by, metadata }) => {
    const body: Record<string, unknown> = { email };
    if (name) body.name = name;
    if (phone) body.phone = phone;
    if (referred_by || metadata) {
      body.metadata = {
        ...(metadata || {}),
        ...(referred_by ? { referred_by } : {}),
      };
    }

    const data = await apiRequest("/sign-up", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return textResponse(data);
  }
);

// ─── Tool: List Subscribers ─────────────────────────────────────────────────

server.tool(
  "list_subscribers",
  "Retrieve a paginated list of subscribers from your waitlist. Supports sorting by position, points, date, referral_count, or email.",
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
  },
  async ({ limit, page, sort_by, sort_dir }) => {
    const params = new URLSearchParams({
      limit: limit.toString(),
      page: page.toString(),
      sort_by,
      sort_dir,
    });

    const data = await apiRequest(`/subscribers?${params.toString()}`);
    return textResponse(data);
  }
);

// ─── Tool: Get Subscriber ───────────────────────────────────────────────────

server.tool(
  "get_subscriber",
  "Retrieve detailed information about a specific subscriber by their ID or email address. Returns position, points, referral info, metadata, location, and more.",
  {
    id_or_email: z
      .string()
      .describe(
        "The subscriber's unique ID or email address"
      ),
  },
  async ({ id_or_email }) => {
    const encoded = encodeURIComponent(id_or_email);
    const data = await apiRequest(`/subscribers/${encoded}`);
    return textResponse(data);
  }
);

// ─── Tool: Update Subscriber ────────────────────────────────────────────────

server.tool(
  "update_subscriber",
  "Update an existing subscriber's information. You can update their name, phone, points, and/or custom metadata. Only include fields you want to change.",
  {
    id_or_email: z
      .string()
      .describe(
        "The subscriber's unique ID or email address"
      ),
    name: z.string().optional().describe("Updated name"),
    phone: z.string().optional().describe("Updated phone number"),
    points: z.number().optional().describe("Updated points value"),
    metadata: z
      .record(z.string())
      .optional()
      .describe(
        "Custom fields to add or update (merged with existing metadata)"
      ),
  },
  async ({ id_or_email, name, phone, points, metadata }) => {
    const body: Record<string, unknown> = {};
    if (name !== undefined) body.name = name;
    if (phone !== undefined) body.phone = phone;
    if (points !== undefined) body.points = points;
    if (metadata !== undefined) body.metadata = metadata;

    const encoded = encodeURIComponent(id_or_email);
    const data = await apiRequest(`/subscribers/${encoded}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });

    return textResponse(data);
  }
);

// ─── Tool: Log View ─────────────────────────────────────────────────────────

server.tool(
  "log_view",
  "Record a view of your waitlist page. Useful for tracking engagement and calculating conversion rates.",
  {
    visitor_id: z
      .string()
      .optional()
      .describe(
        "Unique identifier for the visitor (prevents duplicate counts)"
      ),
    referring_domain: z
      .string()
      .optional()
      .describe("Domain that referred the view"),
  },
  async ({ visitor_id, referring_domain }) => {
    const body: Record<string, unknown> = {};
    if (visitor_id) body.visitor_id = visitor_id;
    if (referring_domain) {
      body.metadata = { referring_domain };
    }

    const data = await apiRequest("/log-view", {
      method: "POST",
      body: JSON.stringify(body),
    });

    return textResponse(data);
  }
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
