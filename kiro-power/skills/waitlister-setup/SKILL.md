---
name: waitlister-setup
description: Configure the Waitlister Power after installing it. Use when Waitlister tools are missing, the Waitlister MCP server shows "Failed to connect", a Waitlister tool fails with an authentication error, WAITLISTER_ACCOUNT_KEY is missing or not approved, or the user asks how to set up Waitlister in Kiro.
---

# Set up the Waitlister Power

The Waitlister MCP server runs on the user's machine through `npx` and reads one secret,
`WAITLISTER_ACCOUNT_KEY`, from the environment Kiro was started with. Kiro IDE needs four
things before the server starts:

1. Node.js 18 or later, so `npx` resolves for the process that launched Kiro.
2. `WAITLISTER_ACCOUNT_KEY` set in that process's environment.
3. `WAITLISTER_ACCOUNT_KEY` on Kiro's list of approved variables.
4. A full restart of Kiro after steps 2 and 3.

If any one of them is missing, the server fails the same way. Work through the steps in
order instead of guessing which one it is.

## 1. Check Node.js

Run `node --version`. It must print v18 or later.

If the command fails or the version is older, tell the user to install the current LTS
from https://nodejs.org, then restart the terminal and Kiro. Ask before running any
install command yourself.

## 2. Get an account key

1. Create a free account at https://waitlister.me and verify the email address. Waitlister
   won't create a key for an unverified account.
2. Go to **Settings → API keys** and create an **account API key**. It starts with
   `wl_acct_`.

Account keys work on every plan, including free, and can create waitlists on their own.
The user doesn't need the dashboard to get started.

Never ask the user to paste the key into the chat. If they paste it anyway, tell them to
revoke it under **Settings → API keys** and create a new one.

## 3. Put the key in the environment Kiro starts with

Tell the user to edit the file directly instead of typing the key at a prompt, so the key
stays out of shell history.

- **macOS or Linux:** add this line to the shell startup file (`~/.zshrc` for zsh,
  `~/.bashrc` for bash):

  ```shell
  export WAITLISTER_ACCOUNT_KEY="wl_acct_your_key"
  ```

- **Windows:** open the Start menu, search for "Edit environment variables for your
  account", choose **New**, and enter `WAITLISTER_ACCOUNT_KEY` as the name and the key as
  the value.

Kiro CLI users must open a new terminal, or `source` the startup file, before they start
Kiro.

## 4. Approve the variable in Kiro IDE

Kiro expands only approved environment variables in MCP configuration. Until
`WAITLISTER_ACCOUNT_KEY` is approved, the server doesn't receive the key.

When Kiro finds an unapproved variable, it shows a security warning that lists it. The user
can approve `WAITLISTER_ACCOUNT_KEY` from that warning. To add it by hand:

1. Open Kiro settings.
2. Search for `Mcp Approved Env Vars`.
3. Add `WAITLISTER_ACCOUNT_KEY`.

## 5. Restart Kiro completely

Tell the user to quit Kiro and start it again. A variable set while Kiro was open usually
doesn't reach it until Kiro is reopened.

On macOS, a Kiro started from the Dock or Finder may not see variables from `~/.zshrc`,
and may not find `npx`. If the server still fails after a restart, tell the user to start
Kiro from a terminal:

```shell
source ~/.zshrc
kiro
```

If the terminal can't find `kiro`, install Kiro's `kiro` shell command from the Command
Palette first.

## 6. Confirm the connection

Call `get_account`. It is read-only and answers three things in one call: whether the key
works, the plan, and `waitlists.can_create` (whether the next `create_waitlist` would
succeed).

- **The call fails with an authentication error:** the key is wrong or revoked. Check that
  the variable holds the full `wl_acct_…` key. If it does, create a new key and repeat
  step 3.
- **No Waitlister tools are available at all:** the server didn't start. It exits at
  startup when the key is missing or wasn't expanded (not approved, or Kiro not
  restarted), so go back through steps 1 to 5. Check that the variable name is spelled
  exactly `WAITLISTER_ACCOUNT_KEY`.

When `get_account` succeeds, report the plan and whether the user can create a waitlist,
then continue with what they asked for.
