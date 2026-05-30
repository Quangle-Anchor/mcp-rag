# Session Management — Tool Specifications

<!-- BEGIN TOOL 88: configure_app -->

## Tool 88: `configure_app`

Allows the user to specify the App ID of the Mendix application to work with. The App ID is stored in session state and reused by other tools.

### Input

```json
{
  "appId": "string (required) — Mendix App ID (project ID)"
}
```

### Behavior

- Store `appId` in server state.
- Validate format (non-empty string).
- Call `MendixPlatformClient.getApp(appId)` to confirm the app exists.

### Output

```
Configured app: <appId>
```

---

<!-- END TOOL 88: configure_app -->

<!-- BEGIN TOOL 87: configure_token -->

## Tool 87: `configure_token`

Allows the user to provide a Mendix Personal Access Token (PAT). The token is stored in server state and used to initialize the `MendixPlatformClient`.

Token can be created at: https://warden.mendix.com

### Input

```json
{
  "token": "string (required) — Mendix Personal Access Token"
}
```

### Behavior

- Store the token in server state.
- Call `setPlatformConfig({ mendixToken: token })` to apply it to the Platform SDK.
- Re-initialize `MendixPlatformClient` with the new token.

### Output

```
Access token configured successfully.
```

---

<!-- END TOOL 87: configure_token -->

<!-- BEGIN TOOL 89: open_working_copy -->

## Tool 89: `open_working_copy`

Open an online working copy from the configured app on the specified branch and store the handle in session state. Builder tools (`create_module`, `create_enumeration`, `create_page`, `add_widget`, `set_widget_property`, `create_microflow`, `create_association`, `create_cross_module_association`) will operate on this same working copy until `commit_working_copy` is called.

Prerequisite: `configure_token` → `configure_app` must be called first.

Session state exists only in-memory within the MCP server process; if the server crashes between `open_working_copy` and `commit_working_copy`, the handle is lost and the full chain must be re-run (`configure_token → configure_app → open_working_copy`). The working copy on the Platform server will be abandoned (not auto-deleted).

### Input

```json
{
  "branchName": "string (optional, default: main) — Branch to open the working copy on. This value is stored in the session and used as the default in commit_working_copy (no need to pass it again).",
  "commitId": "string (optional) — Specific commit ID to base the working copy on."
}
```

### Behavior

1. If a working copy is already open in the session, return the current handle with `reused: true` (do not re-open). **Note:** the `branchName` parameter in this call is ignored — the current working copy retains the branch it was opened with. To change branch, the working copy must be committed (or session lost) and a new working copy opened.
2. Call `App.createTemporaryWorkingCopy(branchName, { commitId? })` to create a temporary working copy.
3. Call `OnlineWorkingCopy.openModel()` to get the `IModel` instance.
4. Store `workingCopy`, `model`, `branchName` in shared session state.

### Output

Returns plain text (MCP `textResult`):

```
# When opening new:
Opened working copy: <workingCopyId> (branch: <branchName>).

# When reusing:
Reusing open working copy: <workingCopyId> (branch: <branchName>).
```

### Error Cases

- `configure_token` not called → throw `No access token configured. Call configure_token first.`
- `configure_app` not called → throw `No app configured. Call configure_app first.`
- SDK/network error when creating temporary working copy → error from Platform SDK is propagated directly.
- `branchName` does not exist on the Teams server → the Platform SDK error is propagated directly. The branch must already exist; see caveat below.

### Caveat — branches must be created out-of-band

Neither `mendixplatformsdk` nor `mendixmodelsdk` exposes an API to create a new branch on the Teams server. The Platform SDK's repository surface (`App.getRepository()` / `RepositoriesClient`) is read-only for branches: `getBranches`, `getBranch`, `getBranchCommits`, plus working-copy create/commit — there is no `createBranch` / `newBranch` method. `createTemporaryWorkingCopy(branchName, …)` and `commitToRepository(branchName, …)` both require the branch to already exist (the latter even rejects a different target branch unless `force: true` is passed).

Consequence: `open_working_copy { branchName: "feature/foo" }` will fail unless `feature/foo` already exists on the Teams server. To create a new branch, do one of the following **outside** the MCP server:

- Studio Pro → Version Control → Branch Line Manager → Create branch line.
- Mendix Developer Portal → app's Team Server / Repository page.
- For Git-backed repos, push a new branch via a Git client to the Team Server's Git endpoint.

Once the branch exists, pass its name to `open_working_copy` and the rest of the working-copy lifecycle works normally.

**Convention for AI callers (Claude Code in this repo).** Before calling `open_working_copy`, callers should resolve the branch as follows:

1. Read `.env` at the repo root and look for `WORKING_BRANCH_NAME`. If set and non-empty, pass it as `branchName`.
2. Otherwise default to `"main"`, but **warn the user and prompt for confirmation** before opening the working copy — committing to `main` by accident is hard to undo and, per the caveat above, the SDK cannot create or roll back branches for you.

See `CLAUDE.md` → "Working branch selection" for the full agent-side protocol.

---

<!-- END TOOL 89: open_working_copy -->

<!-- BEGIN TOOL 90: commit_working_copy -->

## Tool 90: `commit_working_copy`

Flush in-memory model changes to the online working copy, commit the working copy to the repository, and clear the handle from the session. Used to finalize a multi-step editing session.

Prerequisite: `open_working_copy` must be called first.

### Input

```json
{
  "commitMessage": "string (optional, default: 'Update via mx-connect') — Commit message.",
  "branchName": "string (optional) — Override branch name. Defaults to the branch the working copy was opened on."
}
```

### Behavior

1. Call `model.flushChanges()` to push all in-memory changes to the working copy.
2. Call `workingCopy.commitToRepository(branchName, { commitMessage })` to commit.
3. Clear the handle (`workingCopy`, `model`, `branchName`) from session state so the next session opens a fresh working copy.

### Output

Returns plain text (MCP `textResult`):

```
Committed working copy <workingCopyId> to branch <branchName>. Message: "<commitMessage>"
```

> **Note:** The `workingCopyId` in the response refers to the working copy that has been committed and closed/abandoned on the Platform — it cannot be reopened via other tools.

### Error Cases

- No working copy is open → throw `No working copy is open in this session. Call open_working_copy first.`
- Network/auth error when calling `flushChanges()` or `commitToRepository()` → error from Platform SDK is propagated directly; the session handle is **not** cleared (clearing only runs after a successful commit), so the caller may retry `commit_working_copy`.

---

<!-- END TOOL 90: commit_working_copy -->

<!-- BEGIN TOOL 91: discard_working_copy -->

## Tool 91: `discard_working_copy`

Abandon the current session's working copy **without committing**. Clears the in-memory session handle so that the next `open_working_copy` creates a fresh working copy instead of reusing the broken one.

Prerequisite: `open_working_copy` must be called first.

### When to use

This tool is the recovery path for the case where `commit_working_copy` cannot succeed and cannot be retried. The canonical scenario:

1. The caller builds up state in the working copy across many tool calls.
2. A builder call (e.g. `set_calculated_attribute`, `update_attribute`) leaves the in-memory model in a state the SDK considers structurally invalid — but the _individual builder call_ returned success.
3. `commit_working_copy` calls `flushChanges()`, which throws a hard SDK error like `"Cannot unset required part property"`.
4. The session handle is preserved (per `commit_working_copy`'s contract) so the caller can retry — but the in-memory model is in the same broken state, so every retry throws the same error.
5. There is no SDK-level "rollback" — `mendixmodelsdk` cannot undo the bad mutation without reopening from the repository.
6. Without `discard_working_copy`, the only escape was to crash / restart the MCP server.

`discard_working_copy` gives the caller a documented way out: drop the handle, open a fresh working copy, and re-do the parts of the session that should survive.

### Input

```json
{
  "reason": "string (optional) — Free-text reason recorded in the response. Recommended so a future reader of the session log can understand why the working copy was abandoned."
}
```

### Behavior

1. Read and capture `workingCopyId` and `branchName` from session state (for the response message).
2. Call `clearWorkingCopy()` — sets `state.workingCopy`, `state.workingCopyId`, `state.model`, and `state.branchName` all to `null`.
3. Return.

The tool does NOT call any Mendix Platform API. `mendixplatformsdk@5.x` exposes no method to delete or release a temporary working copy — there is no `deleteTemporaryWorkingCopy`, no `OnlineWorkingCopy.close()`, no `OnlineWorkingCopy.delete()`. The platform server reclaims abandoned temporary working copies on its own GC schedule.

### Output

Returns plain text (MCP `textResult`):

```
Discarded working copy <workingCopyId> (branch: <branchName>). Reason: <reason>. The Mendix platform will reclaim the abandoned working copy on its own GC schedule. Call open_working_copy to start a fresh session-bound working copy.
```

### Error Cases

- No working copy is open → throw `No working copy is open in this session. Call open_working_copy first.`

### Caveat

This tool addresses the _session-state_ side of working-copy abandonment, not the _platform-side_ resource leak. If a caller routinely opens and discards working copies in tight succession, the platform may end up with many short-lived working copies pending GC. Treat `discard_working_copy` as a recovery path, not a normal-flow operation.

<!-- END TOOL 91: discard_working_copy -->
