# Agent Note: Delete and unarchive archived sessions

Status: implemented

English | [中文](2026-08-10-delete-and-unarchive-archived-sessions.zh.md)

## Problem

Archiving a session only hid it: `workspaceRegistry.archiveSession` added the id to a registry-global archive set, and every grouping surface excluded it, but the session's durable log, its workspace accounting slot, and its search index entry all remained. There was no unarchive surface and no way to delete the underlying session data at all — the "Known Limitations" section said session deletion was an absent capability, and `SessionPersistence` was documented as append-only with no removal primitive. A user who archived a session to reclaim it later had no restore path, and one who wanted the data gone had no delete path.

## Decision

Deletion and unarchive become real, documented operations that compose the existing archive set with a new durable-delete primitive.

### Durable session deletion

`SessionPersistence.delete(id)` is the destructive counterpart to archiving. It is a default method on the abstract service that rejects loudly (mirroring `readRaw`); the JSONL and SQLite backends override it. `PersistenceCoordinator.delete` runs on the id's serialization chain so it cannot interleave with a concurrent append, then clears the preparation cache, ownerless state, and any retirement tail and calls the backend's `deleteStored` hook. The JSONL backend locates the session's unique log via `findLog`, removes the session-owned directory, and syncs the surviving project directory; a created-but-never-materialized session has no artifact and resolves as a no-op. The SQLite backend deletes the header row with a new `delete-session.sql` (`DELETE FROM sessions WHERE id = ?`), and the `ON DELETE CASCADE` foreign key drops every child event row.

`WorkspaceRegistry.deleteSession(id)` orchestrates the registry side: it rejects only an id whose agent loop is still running (`WorkspaceSessionInUseError`, because in-flight write-behind would recreate the artifact), rejects an unknown id (`WorkspaceUnknownSessionError`), releases an attached-but-idle session through its owning lifecycle (`ctx.agents.release`) so the live entry goes with the log — flushing that entry instead when its owner delegated no release capability — then removes the session from the archive set, detaches it from every workspace account through the entity's `detachSession` (so the snapshot and domain/changed stream stay consistent), and finally calls `sessionPersistence.delete`. Attaching a session is not itself "in use", so an archived-but-idle session is deletable; an unknown session misses on `WorkspaceUnknownSessionError`. See the later [bug-fix note](../bug-fix/2026-08-31-delete-archived-session-in-use-guard.md) and the [live-entry release note](../bug-fix/2026-09-10-session-delete-releases-the-live-entry.md).

### Unarchive

`WorkspaceRegistry.unarchiveSession(id)` removes an archived session from the archive set and nothing else: the log and accounting slot remain, so the session reappears in its prior position. It is idempotent for an id that is not archived.

### Wire, client, and UI

`workspace.unarchiveSession` and `workspace.deleteSession` are unary RPCs returning the full updated archive set (the same full-snapshot posture as `workspace.archiveSession`), with `session-in-use` and `session-not-found` error codes. The client runtime exposes `unarchiveSession`/`deleteSession` on `IWorkspaces`/`WorkspaceRuntime`/`WorkspaceManager`; a successful delete adds a `SessionsPort.refresh()` so the deleted row leaves the session list. The sidebar session-row menu gains "Unarchive session" and "Delete session"; `tree.deriveArchivedSessions` emits an "Archived" section so archived sessions remain reachable and actionable, and the `sessionVisible` guard stays true for non-archived rows.

## Alternatives considered

**Keep archiving non-destructive with no delete path.** That left archived data permanently on disk with no product way to remove it — the reported gap.

**Make delete bound to a live source via the agent handle's dispose.** A live owner's teardown is deliberately owned by the creating fiber, so forcing a host-side dispose would race its write-behind and re-create the artifact. Rejecting a live-bound id at the registry is safer and still covers the archived (persisted, non-running) case. The successor keeps that rejection for a running loop and lets the owner itself perform the teardown for an idle one ([live-entry release note](../bug-fix/2026-09-10-session-delete-releases-the-live-entry.md)).

**Return the session row through a new host stream frame on delete.** The client already removes rows on `host/session-removed` and the session list is re-pulled on reconnect; routing deletion through `SessionsPort.refresh()` avoids a new frame and keeps the delete self-contained on the client.

## Verification

New unit tests exercise the coordinator and both backends' `delete` (absent-id no-op, materialized removal, cascade cleanup), and the workspace registry's `unarchiveSession` (idempotence) and `deleteSession` (archive/account removal, live-in-use rejection, unknown rejection, persistence delete). All affected packages typecheck under `tsc -b`.

## Consequences

Archiving remains a pure hide; only `deleteSession` removes durable data, and it does so irrecoverably and only for a non-live session. Deleting a session that a workspace still accounted for detaches it there, so the workspace's `sessionIds` shrinks and its `updatedAt` advances through the entity write path. The default `SessionPersistence.delete` throws for backends without a delete primitive, so an unsupported backend fails loudly rather than appearing to succeed.
