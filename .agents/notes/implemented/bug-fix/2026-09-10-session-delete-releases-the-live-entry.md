# Agent Note: Releasing the live entry when a Session is deleted

Status: implemented

English | [中文](2026-09-10-session-delete-releases-the-live-entry.zh.md)

## Problem

Deleting an attached idle Session removed everything except the live object. `WorkspaceRegistry.deleteSession` dropped the archive-set entry, detached every Workspace account, and deleted the durable log, while the session's store entry stayed live because its owning fiber owns the teardown ([the in-use guard note](2026-08-31-delete-archived-session-in-use-guard.md)).

That note assumed a live leftover stays off the session list. It does not: `SessionCorpus.listSessions` returns the union of persisted headers and `ctx.sessions.list()` live sessions, so the deleted session keeps appearing. The observable flow is: archive a Session, delete it from the Archived section, and it returns under Ungrouped — the delete detached it from its Workspace, and the live object keeps it listed. Deleting again is a silent no-op, because the log is already gone and `sessionPersistence.delete` treats an absent id as nothing to remove; the Web client reports the rejection only through `console.warn`.

Draining the write path was not enough either. The leftover live entry can append again — a schedule, an inbox delivery, or a stale client — which recreates a partially-removed log for a Session the user deleted.

## Decision

`WorkspaceRegistry.deleteSession` retires the live entry through the Session's owning lifecycle before removing the artifact.

- `AgentRegistry.enter(agent, owner, release?)` records an optional release capability on the entry. The agent loop passes its memoized `dispose` — the same closure its `AgentHandle` returns — so an entry can be torn down without the caller holding the handle.
- `AgentRegistry.release(id)` runs that capability when the id is live and the entry has one. Teardown stays owned by the creating fiber: the registry delegates to the owner's disposer instead of deleting store entries itself, so the ordered stop-and-drain, handle close, scope unwind, and paired detaches remain the single dispose path.
- The delete calls `ctx.agents.release(sessionId)` after the running-loop guard and before the artifact goes. A live entry whose owner delegated no capability (no agent factory produced it) still gets the former `sessions.flush` drain, and the registry README records that limit.

An id that is not live, or an entry `AgentRegistry.register` created, resolves `release` without doing anything — deletion proceeds and behaves as before.

## Alternatives considered

**Filter deleted ids out of the session list.** Hides the row for the next refresh without retiring anything: the deleted Session stays live, and any later append recreates its log under a Session the user believes is gone.

**Detach the store entry from the registry directly.** A `SessionStore.release(id)` would remove the entry behind its owner's back, racing the write handle the owner still holds; the entry is explicitly single-shot and owned by the creating fiber, so a second removal path breaks that invariant rather than closing the gap.

**Refuse the delete when no release capability exists.** Fails loud on exotic compositions where a live Session was entered outside the agent factory, turning a working (if incomplete) delete into a blocked one. Draining the buffer and documenting the limit keeps the operation usable.

## Consequences

Deleting an attached idle Session now leaves no trace: the archive set, Workspace accounts, log, live session entry, and live agent all go, and the row cannot return on the next list refresh or reload. The user-visible symptom — an undeletable Ungrouped Session that survives archive and delete — is closed.

`AgentRegistry.release` is the first teardown path that does not require the `AgentHandle`, so the handle is no longer the only route to a single agent's teardown. The capability is delegated at creation and stays owner-supplied; the registry never invents one.

Callers decide liveness: `release` will tear down a running loop if asked. The delete path owns that guard, so `deleteSession` still refuses an in-flight Session with `WorkspaceSessionInUseError`.

## Testing

- `packages/core/agent/tests/agent.spec.ts` covers `release` on a live capability-bearing entry, a `register` entry, and an unknown id.
- `packages/core/agent-loop/tests/scope-lifecycle.spec.ts` releases an agent created through the registry and asserts both registries drop it, the paired disposal events fire in order, and the handle's own dispose stays idempotent.
- `packages/workspace/workspace/tests/workspace.spec.ts` pins the released-entry path (release called, no flush, store entry gone) and the drain-only fallback.
- `apps/web/tests/workspace-management.e2e.ts` archives and deletes the seeded Session through the real browser and host, then reloads and asserts no row remains, with `ctx.agents`/`ctx.sessions`/persistence all empty for the id.
