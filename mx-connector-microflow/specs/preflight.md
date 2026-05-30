# Pre-flight — Read Once Per Session

> **Audience:** every caller of `mx-connect` tools (Claude, subagents, humans, standalone scripts).
> **Status:** mandatory. Read once at session start. The rules here are not duplicated in per-tool spec files.

This file consolidates two things that must be true **before** any write tool
runs against a Mendix project:

1. The session-state lifecycle (`configure_token → configure_app →
open_working_copy → builder tools → commit_working_copy`).
2. The branch resolution protocol (which Teams-server branch to operate on).

Per-tool input schemas for `configure_token` / `configure_app` /
`open_working_copy` / `commit_working_copy` live in
[`tools/session_management.md`](tools/session_management.md). This file
covers _when_ and _why_, not the JSON shape.

---

## 1. Session lifecycle

Every write tool in `mx-connect` enforces this chain:

```
configure_token → configure_app → open_working_copy → [builders…] → commit_working_copy
```

| Step                  | Purpose                                                                                   | When to call                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `configure_token`     | Store the Mendix Personal Access Token in server state.                                   | First call of a session. Token is created at <https://warden.mendix.com> with scope `mx:modelsdk:edit`. |
| `configure_app`       | Bind the session to a Mendix App (project) ID.                                            | After `configure_token`. The App ID lives in the Sprintr portal under the app's General settings.       |
| `open_working_copy`   | Create an online working copy on a Teams-server branch and load the `IModel` into memory. | After `configure_app`. See §2 for branch selection.                                                     |
| Builder tools         | Apply changes to the in-memory model. None of them flush to the Platform server.          | Any number of times, in any order, while a working copy is open.                                        |
| `commit_working_copy` | `flushChanges()` → `commitToRepository()` → clear the session handle.                     | Once you are done with the working copy.                                                                |

### Key invariants

- **Session state is in-memory only.** `src/session.ts` holds one
  `OnlineWorkingCopy` + `IModel` handle at a time. A server crash between
  `open_working_copy` and `commit_working_copy` loses the handle — the full
  chain must be re-run. The working copy on the Platform server is abandoned
  (it is **not** auto-deleted).
- **`open_working_copy` is idempotent within a session.** If a working copy
  is already open, the tool returns the current handle with `reused: true`.
  The `branchName` parameter on the second call is **ignored** — the
  current working copy retains the branch it was originally opened with.
- **`commit_working_copy` flushes + commits + clears.** Builder tools keep
  changes in the Model SDK's in-memory graph; nothing is persisted to the
  repository until commit. After a successful commit, the handle is cleared
  and the next session opens a fresh working copy.
- **Read-only tools** (`read_domain_model`, `read_microflow_details`,
  `read_page_details`, `query_model_elements`, `list_*`) still require a
  working copy to be open, but do not require the branch-resolution prompt
  in §2.

---

## 2. Branch resolution protocol

Neither `mendixplatformsdk` nor `mendixmodelsdk` exposes an API to create a
new branch on the Teams server. `open_working_copy` will **fail** if the
branch does not already exist. Committing to `main` by accident is hard to
undo. Therefore, before every call to `open_working_copy` (or any standalone
script that opens a working copy), the caller resolves the branch as
follows:

1. **Read `.env` at the repo root and look for `WORKING_BRANCH_NAME`.**
   If it is set to a non-empty value, pass it as `branchName` to
   `open_working_copy`. Do not prompt the user — the env var is the durable
   authorization for that branch.
2. **If `WORKING_BRANCH_NAME` is missing or empty, default to `"main"` — but
   warn the user and prompt for confirmation before proceeding.** The
   warning must make clear that (a) no `WORKING_BRANCH_NAME` was found in
   `.env`, (b) the next action will write to `main`, and (c) the user can
   abort and either set `WORKING_BRANCH_NAME` or pass a different branch
   name explicitly. Only call `open_working_copy` after the user confirms.

### Session-wide acknowledgement

If the user has already told the caller which branch to use in the current
session (e.g. "use `feature/foo`"), treat that as confirmation and skip the
prompt for the rest of the session. The check applies **only** the first
time `open_working_copy` would default to `main`.

### Creating a new branch

The Platform SDK's repository surface (`App.getRepository()` /
`RepositoriesClient`) is read-only for branches: `getBranches`, `getBranch`,
`getBranchCommits`, plus working-copy create/commit — there is no
`createBranch` / `newBranch` method. To create a new branch, do one of the
following **outside** the MCP server:

- Studio Pro → Version Control → Branch Line Manager → Create branch line.
- Mendix Developer Portal → app's Team Server / Repository page.
- For Git-backed repos, push a new branch via a Git client to the Team
  Server's Git endpoint.

Once the branch exists, pass its name to `open_working_copy` and the rest
of the working-copy lifecycle works normally.

---

## 3. After commit

`commit_working_copy` clears the in-memory handle. The next builder call
will throw `"No working copy is open in this session. Call
open_working_copy first."` — start a fresh `open_working_copy` for the
next round of changes.

To change the target branch mid-session, you must `commit_working_copy`
(or accept losing the session) and then `open_working_copy` again with a
different `branchName`.

---

## See also

- [`specs_index.md`](specs_index.md) — tool → file → line range lookup.
- [`tools/session_management.md`](tools/session_management.md) — per-tool
  input schemas for `configure_token` / `configure_app` /
  `open_working_copy` / `commit_working_copy`.
- [`rules/`](rules/) — advisory planning rules; read only when your work
  touches the rule's scope.
- `../CLAUDE.md` — repo-level conventions and credentials.
