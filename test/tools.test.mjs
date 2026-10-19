// Tool-surface tests: run the real server over an in-memory MCP transport with
// a mocked fetch — no network, no API key. These guard what directory reviews
// check (titles, hints, no upsell copy), the publish/unpublish split and the
// tag params.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Waitlister } from "waitlister";
import { createWaitlisterServer, VERSION } from "../build/server.js";

/** A fetch mock that replays scripted responses and records requests. */
function mockFetch(responses = []) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined });
    const next = responses.shift() ?? { status: 200, body: { data: {} } };
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  fn.calls = calls;
  return fn;
}

async function connect({ fetch = mockFetch(), ...options } = {}) {
  const wl = new Waitlister({ accountKey: "wl_acct_test", fetch });
  const server = createWaitlisterServer({ client: wl, ...options });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-host", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, fetch };
}

const EXPECTED_TOOLS = [
  "add_subscriber",
  "create_landing_page",
  "create_waitlist",
  "delete_subscriber",
  "generate_landing_page",
  "get_account",
  "get_landing_page",
  "get_stats",
  "get_subscriber",
  "list_subscribers",
  "list_tags",
  "list_waitlists",
  "log_view",
  "publish_landing_page",
  "unpublish_landing_page",
  "update_landing_page",
  "update_subscriber",
];

test("serves exactly the expected tools", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED_TOOLS);
});

test("every tool has a title and all four hints (directory review requirement)", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  for (const tool of tools) {
    assert.ok(tool.title, `${tool.name}: missing title`);
    for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
      assert.equal(typeof tool.annotations?.[hint], "boolean", `${tool.name}: ${hint} not declared`);
    }
  }
});

test("hints match each tool's behaviour", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  const names = (hint) => tools.filter((t) => t.annotations[hint]).map((t) => t.name).sort();

  assert.deepEqual(names("readOnlyHint"), [
    "get_account",
    "get_landing_page",
    "get_stats",
    "get_subscriber",
    "list_subscribers",
    "list_tags",
    "list_waitlists",
  ]);
  assert.deepEqual(names("destructiveHint"), [
    "delete_subscriber",
    "generate_landing_page",
    "unpublish_landing_page",
    "update_landing_page",
    "update_subscriber",
  ]);
  // Reaches beyond the account: public pages, or email to the subscriber
  assert.deepEqual(names("openWorldHint"), [
    "add_subscriber",
    "publish_landing_page",
    "unpublish_landing_page",
    "update_landing_page",
  ]);
});

test("no tool description promotes upgrades or links a checkout page", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  for (const tool of tools) {
    assert.doesNotMatch(tool.description, /upgrade|\/pricing|\/upgrade/i, tool.name);
  }
});

test("unpublish_landing_page sends the unpublish request", async () => {
  const { client, fetch } = await connect();
  const result = await client.callTool({ name: "unpublish_landing_page", arguments: { waitlist_key: "abc123def456" } });
  assert.ok(!result.isError, JSON.stringify(result));
  assert.equal(fetch.calls.length, 1);
  assert.match(fetch.calls[0].url, /\/api\/v1\/waitlist\/abc123def456\/landing-page\/publish$/);
  assert.equal(fetch.calls[0].method, "POST");
  assert.deepEqual(fetch.calls[0].body, { unpublish: true });
});

test("publish_landing_page publishes, and refuses the removed unpublish flag without calling the API", async () => {
  const { client, fetch } = await connect();

  const refused = await client.callTool({
    name: "publish_landing_page",
    arguments: { unpublish: true, waitlist_key: "abc123def456" },
  });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /unpublish_landing_page/);
  assert.match(refused.content[0].text, /nothing was changed/);
  assert.equal(fetch.calls.length, 0, "a refused call must not reach the API");

  const published = await client.callTool({ name: "publish_landing_page", arguments: { waitlist_key: "abc123def456" } });
  assert.ok(!published.isError, JSON.stringify(published));
  assert.equal(fetch.calls.length, 1);
  assert.match(fetch.calls[0].url, /\/landing-page\/publish$/);
  assert.notEqual(fetch.calls[0].body?.unpublish, true);
});

test("update_subscriber sends tag changes in the API's snake_case", async () => {
  const subscriber = { id: "s1", tags: [{ id: "tag_1", name: "beta", color: "blue" }] };
  const { client, fetch } = await connect({
    fetch: mockFetch([
      { body: { success: true, data: { subscriber } } },
      { body: { success: true, data: { subscriber } } },
    ]),
  });

  const result = await client.callTool({
    name: "update_subscriber",
    arguments: { id_or_email: "ada@example.com", add_tags: ["beta"], remove_tags: ["waiting"], waitlist_key: "abc123def456" },
  });
  assert.ok(!result.isError, JSON.stringify(result));
  assert.equal(fetch.calls[0].method, "PUT");
  assert.match(fetch.calls[0].url, /\/waitlist\/abc123def456\/subscribers\/ada%40example\.com$/);
  assert.deepEqual(fetch.calls[0].body, { add_tags: ["beta"], remove_tags: ["waiting"] });
  assert.match(result.content[0].text, /"name": "beta"/);

  // Replacing the set with [] must reach the API (it clears), not be dropped
  await client.callTool({ name: "update_subscriber", arguments: { id_or_email: "s1", tags: [], waitlist_key: "abc123def456" } });
  assert.deepEqual(fetch.calls[1].body, { tags: [] });
});

test("update_subscriber rejects tag names over 30 characters without calling the API", async () => {
  const { client, fetch } = await connect();
  const result = await client.callTool({
    name: "update_subscriber",
    arguments: { id_or_email: "s1", add_tags: ["x".repeat(31)], waitlist_key: "abc123def456" },
  });
  assert.equal(result.isError, true);
  assert.equal(fetch.calls.length, 0);
});

test("list_subscribers passes the tag filter; list_tags reads the tag list", async () => {
  const { client, fetch } = await connect({
    fetch: mockFetch([
      { body: { success: true, data: { subscribers: [], total: 0, page: 1, limit: 20, pages: 0 } } },
      { body: { success: true, data: { tags: [{ id: "tag_1", name: "beta", color: "blue", subscriber_count: 3 }], max: 20 } } },
    ]),
  });

  await client.callTool({ name: "list_subscribers", arguments: { tag: "Beta", waitlist_key: "abc123def456" } });
  assert.equal(new URL(fetch.calls[0].url).searchParams.get("tag"), "Beta");

  const tags = await client.callTool({ name: "list_tags", arguments: { waitlist_key: "abc123def456" } });
  assert.ok(!tags.isError, JSON.stringify(tags));
  assert.equal(fetch.calls[1].method, "GET");
  assert.match(fetch.calls[1].url, /\/api\/v1\/waitlist\/abc123def456\/tags$/);
  assert.match(tags.content[0].text, /"subscriber_count": 3/);
});

test("a plan-gated tool on a free account returns the neutral plan wording", async () => {
  const { client } = await connect({
    fetch: mockFetch([{ status: 403, body: { message: "This endpoint requires the Growth or Business plan" } }]),
  });
  const result = await client.callTool({ name: "list_tags", arguments: { waitlist_key: "abc123def456" } });
  assert.equal(result.isError, true);
  const text = result.content[0].text;
  assert.match(text, /an API limit; the dashboard isn't affected/);
  assert.match(text, /https:\/\/waitlister\.me\/pricing\.md/);
  // No upgrade prompt, no checkout/pricing page link
  assert.doesNotMatch(text, /upgrade/i);
  assert.doesNotMatch(text, /\/pricing(?!\.md)|\/upgrade/);
});

test("without waitlistKeyEnvVar, no text points the user at an environment variable", async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  for (const tool of tools) {
    assert.doesNotMatch(JSON.stringify(tool), /WAITLISTER_/, tool.name);
  }
  const result = await client.callTool({ name: "get_stats", arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Pass `waitlist_key`/);
  assert.doesNotMatch(result.content[0].text, /environment variable/);
});

test("stdio mode names the env var for the default waitlist", async () => {
  const { client } = await connect({ waitlistKeyEnvVar: "WAITLISTER_WAITLIST_KEY" });
  const result = await client.callTool({ name: "get_stats", arguments: {} });
  assert.match(result.content[0].text, /WAITLISTER_WAITLIST_KEY environment variable/);
});

test("reported version matches package.json", async () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, pkg.version);
  const { client } = await connect();
  assert.equal(client.getServerVersion()?.version, pkg.version);
});
