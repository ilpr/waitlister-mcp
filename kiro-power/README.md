# Waitlister Power for Kiro

Create product-launch waitlists, publish hosted landing pages and manage signups from Kiro.
The Power runs the official Waitlister MCP server, [`@waitlister/mcp`](https://www.npmjs.com/package/@waitlister/mcp),
and adds two skills: one that sets it up and one that launches a waitlist.

## What you can ask for

- "Is my Waitlister key working, and can I create another waitlist?"
- "Create a waitlist for my new product and give me the signup form URL"
- "Launch my waitlist with a landing page, dark theme, and publish it"
- "Generate a landing page: bold, dev-tool look" (AI builder, 1 credit)
- "How many subscribers do I have?"
- "Tag everyone with 3+ referrals as beta, then list who's tagged beta" (Growth plan or higher)

## Install

1. In Kiro, open **Powers** and choose **Add Custom Power**, then **Import power from GitHub**
   (newer versions call it **Import power from a repository URL**).
2. Paste this URL:

   ```
   https://github.com/ilpr/waitlister-mcp/tree/main/kiro-power
   ```

## Set up

You need Node.js 18 or later and a [Waitlister](https://waitlister.me) account. The free plan
works.

1. In Waitlister, verify your email, then go to **Settings → API keys** and create an account
   key (`wl_acct_…`).
2. Save it as the environment variable `WAITLISTER_ACCOUNT_KEY`.
   - macOS or Linux: add `export WAITLISTER_ACCOUNT_KEY="wl_acct_your_key"` to your shell
     startup file (`~/.zshrc` or `~/.bashrc`).
   - Windows: search the Start menu for "Edit environment variables for your account" and add
     it there.
3. Approve `WAITLISTER_ACCOUNT_KEY` when Kiro shows its security warning, or add it under the
   `Mcp Approved Env Vars` setting.
4. Quit Kiro and open it again. On macOS, if the server still doesn't connect, start Kiro
   from a terminal so it gets your shell's environment.

If something doesn't connect, ask Kiro to set up Waitlister. The `waitlister-setup` skill
checks each step in order.

## Tools

The server has 17 tools. Creating waitlists, building and publishing landing pages
(including AI-generated ones), adding signups and reading stats work on every plan. Reading,
updating, deleting and tagging subscribers need the Growth plan or higher. The full list is in
the [main README](https://github.com/ilpr/waitlister-mcp#tools).

## Privacy

Full policy: https://waitlister.me/privacy-policy

### What the server collects

The server collects nothing on its own. It runs on your machine and has no database,
telemetry or analytics. Your key lives in the environment variable you set, and Kiro hands
it to the server when it starts.

### What it sends, and where

The server sends only the API requests you ask for, over HTTPS, to the Waitlister API at
`https://waitlister.me/api/v1`, authenticated with your key. A request includes the
arguments passed to the tool, such as a waitlist name, landing-page copy, or the email
address of a subscriber you add. Nothing is sent anywhere else.

### How requests identify themselves

Requests carry identification headers so Waitlister can tell agent traffic from other API
traffic: the server's name and version (`waitlister-mcp/1.5.0`), the SDK version, the Node
version, and the name and version Kiro announces when it connects. These headers carry no
prompt text, file paths, or machine or user identifiers.

### How the data is used

Data that reaches the Waitlister API is handled under the Waitlister privacy policy, the
same terms as the web dashboard. Waitlist and subscriber records stay in your account until
you delete them. Waitlister does not sell your data. Designs requested through
`generate_landing_page` are made by Waitlister's AI page builder, which sends your design
prompt to a third-party model provider. The privacy policy lists the current subprocessors.

### Your controls

You can revoke the key at any time under **Settings → API keys**, which immediately stops the
server from reaching your account. To take the key off your machine, delete
`WAITLISTER_ACCOUNT_KEY` from your shell startup file or your Windows environment variables.

## Support

Contact Waitlister at https://waitlister.me/contact.

## License

MIT. See [LICENSE](https://github.com/ilpr/waitlister-mcp/blob/main/LICENSE).
