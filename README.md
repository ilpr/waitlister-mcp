# Waitlister MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that connects AI assistants like Claude, Cursor, and Windsurf to the [Waitlister](https://waitlister.me) API. Manage your waitlist subscribers through natural language.

## What Can You Do With This?

Once connected, you can ask your AI assistant things like:

- "Add test@gmail.com to my waitlist"
- "How many subscribers do I have?"
- "Look up the subscriber john@acme.com"
- "Update John's points to 500"
- "Show me the top 10 subscribers by referral count"

## Tools

| Tool | Description |
| --- | --- |
| `add_subscriber` | Add a new subscriber to your waitlist |
| `list_subscribers` | List subscribers with pagination and sorting |
| `get_subscriber` | Get details for a specific subscriber by ID or email |
| `update_subscriber` | Update a subscriber's name, phone, points, or metadata |
| `log_view` | Record a waitlist page view for analytics |

## Prerequisites

- Node.js 18+
- A [Waitlister](https://waitlister.me) account on the **Growth** or **Business** plan (API access required)
- Your **API key** and **waitlist key** from the Waitlister dashboard

### Getting Your Keys

1. Log in to [Waitlister](https://waitlister.me)
2. Go to **Integrations** → **API access** → **Generate API key**
3. Your **waitlist key** is found in your waitlist settings

## Installation

### Using npx (recommended)

No installation needed — just configure your MCP client:

```json
{
  "mcpServers": {
    "waitlister": {
      "command": "npx",
      "args": ["-y", "waitlister-mcp"],
      "env": {
        "WAITLISTER_API_KEY": "your-api-key",
        "WAITLISTER_WAITLIST_KEY": "your-waitlist-key"
      }
    }
  }
}
```

### Global install

```bash
npm install -g waitlister-mcp
```

Then configure:

```json
{
  "mcpServers": {
    "waitlister": {
      "command": "waitlister-mcp",
      "env": {
        "WAITLISTER_API_KEY": "your-api-key",
        "WAITLISTER_WAITLIST_KEY": "your-waitlist-key"
      }
    }
  }
}
```

## Setup by Client

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "waitlister": {
      "command": "npx",
      "args": ["-y", "waitlister-mcp"],
      "env": {
        "WAITLISTER_API_KEY": "your-api-key",
        "WAITLISTER_WAITLIST_KEY": "your-waitlist-key"
      }
    }
  }
}
```

### Cursor

Go to **Settings** → **MCP** → **Add new MCP server** and use the same configuration above.

### Claude Code

```bash
claude mcp add waitlister -- npx -y waitlister-mcp
```

Then set the environment variables `WAITLISTER_API_KEY` and `WAITLISTER_WAITLIST_KEY`.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `WAITLISTER_API_KEY` | Yes | Your Waitlister API key |
| `WAITLISTER_WAITLIST_KEY` | Yes | Your unique waitlist key |

## Tool Reference

### add_subscriber

Add a new subscriber to your waitlist.

**Parameters:**

- `email` (string, required) — Subscriber's email address
- `name` (string, optional) — Subscriber's name
- `phone` (string, optional) — Subscriber's phone number
- `referred_by` (string, optional) — Referral code of the person who referred them
- `metadata` (object, optional) — Custom fields (e.g. `{ "company": "Acme" }`)

### list_subscribers

Retrieve a paginated list of subscribers.

**Parameters:**

- `limit` (number, default 20) — Results per page (1–100)
- `page` (number, default 1) — Page number
- `sort_by` (string, default "date") — Sort field: `position`, `points`, `date`, `referral_count`, `email`
- `sort_dir` (string, default "desc") — Sort direction: `asc` or `desc`

### get_subscriber

Get detailed info for a specific subscriber.

**Parameters:**

- `id_or_email` (string, required) — Subscriber's ID or email address

### update_subscriber

Update a subscriber's information.

**Parameters:**

- `id_or_email` (string, required) — Subscriber's ID or email address
- `name` (string, optional) — Updated name
- `phone` (string, optional) — Updated phone number
- `points` (number, optional) — Updated points value
- `metadata` (object, optional) — Custom fields to add/update (merged with existing)

### log_view

Record a waitlist page view.

**Parameters:**

- `visitor_id` (string, optional) — Unique visitor identifier (prevents duplicate counts)
- `referring_domain` (string, optional) — Referring domain

## Rate Limits

Rate limits depend on your Waitlister plan:

| Plan | Subscriber Endpoints | Log View Endpoint |
| --- | --- | --- |
| Growth | 60 requests/min | 200 requests/min |
| Business | 120 requests/min | 400 requests/min |

## Development

```bash
git clone https://github.com/waitlister/waitlister-mcp.git
cd waitlister-mcp
npm install
npm run build
```

Test with the MCP Inspector:

```bash
WAITLISTER_API_KEY=your-key WAITLISTER_WAITLIST_KEY=your-key npm run inspect
```

## Links

- [Waitlister](https://waitlister.me) — Create waitlists for your product launches
- [API Documentation](https://waitlister.me/docs/api)
- [MCP Protocol](https://modelcontextprotocol.io/)

## License

MIT
