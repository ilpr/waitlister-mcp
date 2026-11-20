---
name: waitlister-launch
description: Launch a product waitlist with Waitlister. Use when the user wants to create a waitlist, build or publish a waitlist landing page, make a launch or coming-soon page, collect pre-launch signups, add someone to a waitlist, check signup numbers, or manage subscribers, referrals and tags.
---

# Launch a waitlist with Waitlister

Waitlister is waitlist software for product launches: a hosted landing page, signups with
queue positions, and a referral program where referrals move people up the list. Signups
see their position on paid plans, and the referral program is off until the owner turns it
on (also paid plans).

## 1. Check the key first

Call `get_account` before anything else. It is read-only and tells you whether the key
works, the plan, and `waitlists.can_create`. Check `can_create` before a setup instead of
finding the plan's waitlist cap from an error halfway through.

If the call fails, or no Waitlister tools are available, follow the `waitlister-setup`
skill.

## 2. Launch a waitlist in one step

`create_waitlist` creates the waitlist and its landing page in a single call. Prefer it
over creating them separately:

- `name`: the product name (required).
- `landing_page`: pass `{ headline, description, button_text, collect_name, theme }` to
  get a hosted page as a draft in the same call. `headline` is required, 3 to 120
  characters.

Then `publish_landing_page` takes the page live at `waitlister.me/p/{slug}`. Give the user
the live URL. Also tell them that `form_action_url` from the create response collects
signups from a form on any site, once that site's domain is whitelisted in the waitlist's
settings.

## 3. Design the page with AI, if they want one

`generate_landing_page` builds a complete custom design from a natural-language prompt.
Tell the user two things before you call it:

- It uses one AI credit per call (shared with the dashboard's AI builder).
- It takes up to about a minute.

Don't call it again for small wording changes, because each call spends a credit. Get the
design brief right first, then call it once.

After generating, the page is an AI page: its copy lives inside the generated design, so
`update_landing_page` rejects the copy fields (`headline`, `description`, `button_text`,
`collect_name`, `collect_phone`, `background`) with a 409. Change those with another
`generate_landing_page` call with `is_edit: true`. `theme` and `seo` still update normally
on both page types.

## 4. What stays out of reach

Custom domains, branding removal, tracking IDs and image uploads are dashboard-only on
every plan, by design. If the user asks for one of those, point them to the dashboard at
https://waitlister.me instead of trying a tool call. Some of them also need a paid plan in
the dashboard, so don't promise one is available on the user's plan.

Subscriber management (`list_subscribers`, `get_subscriber`, `update_subscriber`,
`delete_subscriber`, `list_tags`) needs the Growth plan or higher. Creating waitlists,
building and publishing pages, adding signups and reading stats work on every plan.

For tags, call `list_tags` before `update_subscriber` with `add_tags`, and reuse an
existing name. A name the waitlist doesn't have yet becomes a new tag, and a waitlist holds
at most 20 tags. Recoloring and deleting tags are dashboard-only.

`delete_subscriber` can't be undone. Confirm with the user before you call it.

## 5. Check before saying it's done

1. Fetch the published URL and confirm the page renders with the user's copy.
2. Tell the user that pages stay drafts until published: nothing is public until
   `publish_landing_page` runs, and `unpublish_landing_page` takes it offline again.
3. Signup email validation rejects fake addresses, so test a signup with a real one.
