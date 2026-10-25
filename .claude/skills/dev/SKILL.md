---
name: dev
description: Build a feature or fix a bug in Inventory, from a fresh branch off main to an open pull request.
disable-model-invocation: true
argument-hint: <what to build or fix>
---

Take one change to the Inventory app from a fresh branch off `main` to an open pull request. The request is `$ARGUMENTS`, or the user's message. Talk to the user in the language they write in.

The run has four **gates**: points where you end your turn and wait for the user's answer. A gate opens only on the user's word.

## 1. Kind and branch

- Decide whether the request is a feature (`feat/`) or a bug fix (`fix/`); ask when it could be either.
- Name the branch `<feat|fix>/<short-kebab-case-english>`, e.g. `feat/item-csv-export`, `fix/location-search-diacritics`.
- Start from a clean tree (`git status --porcelain` empty); otherwise ask the user what happens to the changes.
- Pull `main` and branch from it: `git switch main && git pull --ff-only origin main && git switch -c <branch>`. When `main` is checked out in another worktree (the switch fails), use `git fetch origin main && git switch -c <branch> --no-track origin/main`.

Done when `git status -sb` shows the new branch at the tip of `origin/main`.

## 2. Plan on Opus

**Gate: Opus.** Your model is named in your system prompt. On anything but Opus, ask the user to pick Opus in the model menu and write back. A session cannot switch its own model.

Call EnterPlanMode, then:

- Read what the change touches: the relevant CLAUDE.md and SPEC.md sections and the code. For a bug, find the cause in the code (reproduce it when you can) and name the test that goes red on it before the fix.
- Ask with AskUserQuestion, round after round, until no ambiguity is left: behaviour, edge cases, roles, Czech UI texts and placement, empty and error states, data model. Put your recommended option first. What SPEC.md §12 lists as open is always asked. Done when every decision in the plan is either written in SPEC.md / CLAUDE.md or answered by the user.
- Write the plan: what changes and why; a change to the data model or architecture called out at the top (CLAUDE.md wants those proposed first); the commits in order, each small and green (schema, repository, service with tests, routes with tests, UI, as in the CLAUDE.md working agreement); the tests for every rule; the SPEC.md / CLAUDE.md sections the change makes stale (Status, Commands, the module's paragraph).
- Present it with ExitPlanMode. On requested changes, revise and present again.

## 3. Implement on Sonnet

**Gate: Sonnet.** Once the plan is approved, ask the user to pick Sonnet in the model menu and write back. Continue when your model is Sonnet.

- Follow the plan. When it proves wrong, agree the change with the user before taking another route.
- Commit after each plan step, in the format of the CLAUDE.md Commits section (no AI trailers, the commit-msg hook always runs). Before each commit, typecheck and the tests of the touched area pass.
- Run checks on Node 24. The tool shell may start on Node 20 (`node -v`), so prefix commands with `source ~/.nvm/nvm.sh && nvm use >/dev/null &&`. DB tests need Docker running.

Done when every planned commit is in and the full check below is green. Tell the user what to try and how to run it locally (CLAUDE.md Commands: `pnpm db:up`, the API and web dev servers).

**Gate: user OK.** Wait until the user says it works. Fix what they report, commit, and ask again.

## 4. Check, review, pull request

The full check is the CI job's list:

```bash
pnpm lint && pnpm typecheck && pnpm --filter api db:check && pnpm build && pnpm test
```

1. Run the full check. Fix what is red, commit, rerun until green.
2. Ask the user to type `/review high --fix`: the built-in review at effort high, applying its findings to the working tree. The alias `/review` always reaches the built-in review; the name `code-review` belongs to the user's own skill. Wait for the findings.
3. Read the diff of the applied fixes, run the full check again and commit them (`fix(<scope>): …`). Report every finding left unfixed, with the reason.
4. Green check and no open finding: **Gate: PR.** Ask whether to open the pull request.
5. On yes: `git push -u origin <branch>`, then `gh pr create --base main` with a Conventional Commits title and a body written with the `pr` skill.
6. Give the user the PR link and their next steps:
   - open the pull request and check the changes on GitHub;
   - wait for the CI checks on GitHub to go green (Lint, typecheck, test; Dependency audit; Secret scan; Semgrep), and come back here if one fails;
   - then merge into `main`, which deploys to production automatically.
