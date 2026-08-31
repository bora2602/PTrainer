# AGENTS.md — PTrainer

Instructions for coding agents (Codex, and any other agent that reads this file).

**Read [`CLAUDE.md`](CLAUDE.md) first.** It is the source of truth for architecture, tech
stack, data model, API conventions, security rules, and the definition of done. Everything
in it applies to you. This file adds only the git/GitHub operating details.

## Version control — the working agreement

**Never run `git commit`, `git push`, `git commit --amend`, or push tags/branches without
asking first and getting an explicit yes.** This holds even when the work is finished and
the tests pass. Staging changes and proposing a commit message is welcome; writing to
history is the maintainer's call.

Corollary: don't create a commit just to "save progress," and don't push a branch to share
it, unless you were asked to.

## GitHub setup on this machine

The repo is on GitHub at `bora2602/PTrainer`. Default branch: `main`.

- **`origin` uses SSH**, not HTTPS: `git@github.com:bora2602/PTrainer.git`
- Auth is an ed25519 key at `~/.ssh/id_ed25519`, already registered on the `bora2602`
  GitHub account. It has **no passphrase**, so pushes and fetches are non-interactive.
- Verify auth with: `ssh -T git@github.com` → should greet `Hi bora2602!`

Do not switch `origin` back to an HTTPS URL. HTTPS has no stored credential in the macOS
keychain, so it fails with `could not read Username for 'https://github.com'`.

## Tooling that is NOT available

Don't suggest these or write instructions that depend on them:

- **`gh` (GitHub CLI) is not installed.** Use plain `git` over SSH for push/pull/fetch.
  For anything needing the GitHub API, ask the maintainer rather than assuming `gh` works.
- **Homebrew (`brew`) is not installed.** Never tell the maintainer to `brew install X`.
  macOS ships `git`, `ssh`, `ssh-keygen`, and `curl` at `/usr/bin` — prefer those.

## Sandbox note

Agent sandboxes often block SSH and macOS keychain access. A `git push`, `git pull`, or
`git fetch` that fails with `Device not configured` or `could not read Username` is usually
sandbox isolation, not broken credentials. Re-run the network command with escalated /
unsandboxed permissions before concluding auth is misconfigured — and re-check with
`ssh -T git@github.com`.

## Routine sync

```sh
git fetch --all --prune      # safe, run freely
git status -sb               # check divergence before proposing anything
git pull --ff-only origin main
```

Prefer `--ff-only` on pull. If it refuses because the branches diverged, stop and ask how
the maintainer wants it reconciled — do not merge or rebase on your own initiative.
