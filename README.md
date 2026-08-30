# Waitlister MCP Server — `@waitlister/mcp`

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that connects AI assistants like Claude, Cursor, and Windsurf to the [Waitlister](https://waitlister.me) API. Create waitlists and manage subscribers through natural language.

> This is the official package, superseding `waitlister-mcp` (1.0.x). Existing `waitlister-mcp` configurations keep working, but new setups should use `@waitlister/mcp` — it adds account-key support, waitlist creation, stats, and deletion, and works on every plan.

## What Can You Do With This?

Once connected, you can ask your AI assistant things like:

- "Is my Waitlister key working, and can I create another waitlist?"
- "Create a waitlist for my new product and give me the signup form URL"
- "Launch my waitlist with a landing page — dark theme — and publish it"
- "Change the page headline to 'Join 500+ others'"
- "Generate a landing page: bold, dev-tool aesthetic" (AI builder, 1 credit)
- "Add test@gmail.com to my waitlist"
- "How many subscribers do I have?"
- "Look up the subscriber john@acme.com"
- "Update John's points to 500"
- "Show me the top 10 subscribers by referral count"

## Tools

| Tool | Description | Plan |
| --- | --- | --- |
| `get_account` | Check the key and what the account may do: plan, waitlist count vs cap, whether the next `create_waitlist` would succeed, AI credits. Read-only | Every plan (account key) |
| `create_waitlist` | Create a new waitlist; returns its key + a form URL that collects signups immediately. Optionally provisions its landing page (draft) in the same call | Every plan (account key) |
| `list_waitlists` | List every waitlist you own, with subscriber/view counts | Every plan (account key) |
| `get_stats` | Subscriber + view counters for a waitlist (cheap social proof) | Every plan |
| `add_subscriber` | Add a new subscriber to a waitlist | Every plan |
| `list_subscribers` | List subscribers with pagination and sorting | Growth+ |
| `get_subscriber` | Get details for a specific subscriber by ID or email | Growth+ |
| `update_subscriber` | Update a subscriber's name, phone, points, or metadata | Growth+ |
| `delete_subscriber` | Permanently delete a subscriber (irreversible) | Growth+ |
| `log_view` | Record a waitlist page view for analytics | Every plan |
| `get_landing_page` | Structured view of the hosted landing page: status, copy, theme, SEO, live URL, analytics | Every plan |
| `create_landing_page` | Create the page from structured fields (draft; one page per waitlist) | Every plan |
| `update_landing_page` | Update copy/theme/background/SEO; live pages update immediately | Every plan |
| `publish_landing_page` | Go live at `waitlister.me/p/{slug}` (or unpublish) | Every plan |
| `generate_landing_page` | AI-generate or AI-edit the whole page from a prompt (**1 AI credit per call**, ~20–50s) | Every plan |

**AI pages vs standard pages:** after `generate_landing_page`, the page's copy lives inside the generated page — `update_landing_page` rejects copy/structure fields with guidance to use `generate_landing_page` + `is_edit` instead (`theme` and `seo` still update normally). Generated pages are saved as drafts, and the AI conversation carries over to the dashboard's AI chat.

## Prerequisites

- Node.js 18+
- A [Waitlister](https://waitlister.me) account — the free plan works
- An **account API key** (recommended), or a per-waitlist API key (Growth plan+)

### Getting Your Key

**Account key (recommended — works on every plan, covers every waitlist you own):**

1. Log in to [Waitlister](https://waitlister.me)
2. Go to **Settings** → **API keys** → create a key (`wl_acct_…`)

**Per-waitlist key (legacy, Growth plan+):** waitlist → **Integrations** → **API access**. You'll also need the **waitlist key** from the waitlist's settings.

## Installation

### Using npx (recommended)

No installation needed — just configure your MCP client:

```json
{
  "mcpServers": {
    "waitlister": {
      "command": "npx",
      "args": ["-y", "@waitlister/mcp"],
      "env": {
        "WAITLISTER_ACCOUNT_KEY": "wl_acct_your-key"
      }
    }
  }
}
```

With an account key you can optionally add `"WAITLISTER_WAITLIST_KEY": "your-waitlist-key"` to set a default waitlist — otherwise each tool call can target any waitlist you own via its `waitlist_key` parameter (ask the assistant to run `list_waitlists` first).

<details>
<summary>Legacy per-waitlist configuration (still supported)</summary>

```json
{
  "mcpServers": {
    "waitlister": {
      "command": "npx",
      "args": ["-y", "@waitlister/mcp"],
      "env": {
        "WAITLISTER_API_KEY": "your-api-key",
        "WAITLISTER_WAITLIST_KEY": "your-waitlist-key"
      }
    }
  }
}
```

</details>

### Global install

```bash
npm install -g @waitlister/mcp
```

Then configure with `"command": "waitlister-mcp"` and the same `env`.

## Setup by Client

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows) with the JSON above.

### Cursor

Go to **Settings** → **MCP** → **Add new MCP server** and use the same configuration.

### Claude Code

```bash
claude mcp add waitlister --env WAITLISTER_ACCOUNT_KEY=wl_acct_your-key -- npx -y @waitlister/mcp
```

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `WAITLISTER_ACCOUNT_KEY` | One of the two keys | Account API key (`wl_acct_…`, Settings → API keys). Every plan; every waitlist you own; unlocks `create_waitlist`/`list_waitlists`. |
| `WAITLISTER_API_KEY` | One of the two keys | Per-waitlist API key (Growth+). Requires `WAITLISTER_WAITLIST_KEY`. |
| `WAITLISTER_WAITLIST_KEY` | With `WAITLISTER_API_KEY`; optional otherwise | Default waitlist for the waitlist-scoped tools. |

## Notes

- **Uniqueness:** waitlist names and URL slugs are unique across all of Waitlister. `create_waitlist` rejects a taken name/slug with a message telling you what to change.
- **Async counters:** signups and deletions update `get_stats` counters and queue positions within a few seconds, not instantly.
- **Plan gating:** creating waitlists, adding subscribers, and stats work on every plan (lower rate limits on free plans). Reading/updating/deleting subscriber data requires Growth or higher — see [rate limits](https://waitlister.me/docs/api/rate-limits).
- Built on the official [`waitlister`](https://www.npmjs.com/package/waitlister) SDK (typed errors, automatic retries with backoff).

## Development

```bash
git clone https://github.com/ilpr/waitlister-mcp.git
cd waitlister-mcp
npm install
npm run build
```

Test with the MCP Inspector:

```bash
WAITLISTER_ACCOUNT_KEY=wl_acct_your-key npm run inspect
```

## Links

- [Waitlister](https://waitlister.me) — create waitlists for your product launches
- [API Documentation](https://waitlister.me/docs/api)
- [MCP Protocol](https://modelcontextprotocol.io/)

## Privacy

Full policy: https://waitlister.me/privacy-policy

**What this extension collects.** Nothing on its own. It runs locally on your machine and
holds no database, no telemetry, and no analytics. It stores only the credential you
enter — your Waitlister account API key — which Claude Desktop keeps in your operating
system's secure credential storage.

**What it sends, and where.** The extension sends the API requests you ask it to make,
over HTTPS, to the Waitlister API at `https://waitlister.me/api/v1`, authenticated with
your key. That means the arguments you (or Claude, on your instruction) pass to a tool:
for example a waitlist name, landing-page copy, or a subscriber's email address when you
add one. Nothing is sent anywhere else. There are no third-party analytics, error
trackers, or intermediary services in the path.

**How requests identify themselves.** Like any SDK, those requests carry identification
headers so Waitlister can tell agent traffic from ordinary API traffic and support it
properly: this package's name and version (`waitlister-mcp/1.4.0`), the SDK version, the
Node version, and the name and version your MCP host announces in the protocol handshake
(e.g. `claude-ai/0.1.0`). No prompt text, no file paths, no machine or user identifiers.
Nothing extra is sent — these ride along on requests you already made.

**How that data is used and retained.** Data reaching the Waitlister API is handled under
the Waitlister privacy policy linked above — the same terms that apply when you use the
web dashboard. Waitlist and subscriber records persist in your Waitlister account until
you delete them, from the dashboard or with the `delete_subscriber` tool. The extension
itself retains nothing after a request completes.

**Third-party sharing.** Waitlister does not sell your data. Landing-page designs
requested through `generate_landing_page` are produced by Waitlister's AI page builder,
which passes your design prompt to a third-party model provider; see the privacy policy
for the current subprocessor list.

**Your controls.** Revoke the API key at any time in Waitlister under Settings → API
keys, which immediately stops this extension from reaching your account. Uninstalling the
extension removes the stored key from your machine. Account and data deletion requests
follow the process in the privacy policy.

**Contact.** https://waitlister.me/contact

## License

MIT — see [LICENSE](LICENSE).
