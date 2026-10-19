---
name: waitlister-getting-started
description: Set up Waitlister and launch a waitlist from chat. Use when the user wants to create a waitlist, build or publish a waitlist landing page, collect pre-launch signups, or when a Waitlister tool fails because no API key is configured. Trigger phrases include "create a waitlist", "set up a waitlist for my product", "make a launch page", "collect signups before launch", "publish my waitlist page".
---

# Getting started with Waitlister

Waitlister is waitlist software for product launches: a hosted landing page, signups with
queue positions, and a referral program where referrals move people up the list.

## 1. Make sure there's an API key

Every tool here needs `WAITLISTER_ACCOUNT_KEY` set in the environment. If a tool call
fails with an authentication error, or the user has never used Waitlister here before,
walk them through it:

1. Create a free account at https://waitlister.me (no credit card).
2. Go to **Settings → API keys** and create an **account API key** — it starts with
   `wl_acct_`.
3. Set it as `WAITLISTER_ACCOUNT_KEY` in the environment and restart the session.

Account keys work on **every plan, including free**, and can create waitlists on their
own — the user never needs to touch the dashboard to get started.

Never ask the user to paste the key into the chat. If they do anyway, tell them to
revoke it in Settings → API keys and issue a new one.

**Confirm the key with `get_account` before doing anything else.** It is read-only and
answers three things in one call: whether the key is alive (an invalid or revoked key
fails here, so a dead key stops looking like a malformed request), the plan, and
`waitlists.can_create` — whether the next `create_waitlist` would actually succeed. Check
that rather than discovering the plan's waitlist cap from an error partway through a setup.

## 2. Launch a waitlist in one step

`create_waitlist` provisions the waitlist and its landing page in a single call — prefer
this over creating them separately:

- `name` — the product name (required).
- `landing_page` — pass `{ headline, description, button_text, collect_name, theme }` to
  get a hosted page as a draft in the same call. `headline` is required, 3–120 characters.

Then `publish_landing_page` takes it live at `waitlister.me/p/{slug}`. Report the live URL
back to the user, and mention that `form_action_url` from the create response already
collects signups on any site (the domain must be whitelisted in the waitlist's settings).

## 3. Design the page with AI, if they want one

`generate_landing_page` builds a complete custom design from a natural-language prompt.
Two things to tell the user before calling it:

- It **uses one AI credit per call** (shared with the dashboard AI builder).
- It takes up to about a minute.

Don't call it repeatedly for small wording tweaks — that spends a credit each time. Get
the design brief right first, then call once.

After generating, the page is an **AI page**: its copy lives inside the generated design,
so `update_landing_page` rejects copy fields (`headline`, `description`, `button_text`,
`collect_name`, `collect_phone`, `background`) with a 409. Change those with another
`generate_landing_page` call and `is_edit: true`. `theme` and `seo` still update normally
on both page types.

## 4. What stays out of reach

Custom domains, branding removal, tracking IDs, and image uploads are dashboard-only on
every plan, by design. If the user asks for one of those, point them at the dashboard
rather than trying a tool call.

Subscriber management (`list_subscribers`, `get_subscriber`, `update_subscriber`,
`delete_subscriber`, `list_tags`) needs the Growth plan or higher. Creating waitlists,
building and publishing pages, adding signups, and reading stats work on every plan.

Tagging: call `list_tags` before `update_subscriber` with `add_tags`, and reuse an
existing name. A name the waitlist doesn't have yet becomes a new tag, and a waitlist
holds at most 20. Recoloring and deleting tags are dashboard-only.

## 5. Verify before saying it's done

1. Fetch the published URL and confirm the page renders with the user's copy.
2. Tell them pages stay **drafts until published** — nothing is public until
   `publish_landing_page` runs. `unpublish_landing_page` takes it back offline.
3. Signup email validation rejects fake addresses, so test with a real one.
