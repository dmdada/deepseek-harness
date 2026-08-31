# Agent Note: Allow deleting an archived session that is attached but idle

Status: implemented

English

## Problem

`WorkspaceRegistry.deleteSession` rejected any session still attached to the
live sessions store, not just one whose loop was in flight:

```ts
if (this.ctx.get('sessions')?.get(sessionId) !== undefined) {
  throw new WorkspaceSessionInUseError(sessionId)
}
```

The feature note (`2026-08-10-delete-and-unarchive-archived-sessions.md`) states
the intent is to reject *in-flight* owners, and it explicitly assumes an archived
session is a persisted, non-running one. That assumption fails in the normal
product flow: archiving only adds the id to the registry archive set and does not
close or detach the session, so a session archived in the same app session stays
attached to the live store. Deleting it then trips the `session/in-use` guard and
never actually removes it. The user-visible symptom is an archived conversation
that "will not delete"; the frontend swallows the rejection into a `console.warn`.

## Decision

Narrow the guard to genuinely in-flight work and drain residual buffered events
before removing the artifact.

- `deleteSession` rejects only when `ctx.agents.get(sessionId)?.status ===
  'running'`. Merely being attached (including an archived session) is not "in
  use"; the note's intended "in-flight owners" is now what the guard measures.
- A session still attached but idle is flushed (`sessions.flush`) before the
  artifact is removed. The live store entry is owned by the creating fiber and
  cannot be detached from here, but draining its buffer means a later write-behind
  has nothing pending and cannot resurrect the deleted log.

`WorkspaceUnknownSessionError` gained a required `operation` parameter so the
same class reports the right verb (`cannot archive session` vs `cannot delete
session`); earlier it always said "cannot archive session" even on a delete.

## Alternatives considered

**Detach (dispose) the attached session from the registry before delete.** The
session teardown is deliberately owned by the creating fiber and forcing a
host-side dispose races its write-behind (the feature note already rejected
this). Keeping the owning fiber alive while flushing the entry is the safe
bounded version.

**Keep the broad guard and close the session on archive.** Shifts the behavior to
a different surface and would silently detach a session the user is only
hiding; deleting an archived-but-idle session directly is the requested product
behavior.

## Consequences

Deleting an archived session that is attached but idle now succeeds: the archive
entry, every workspace account, and the durable log are removed. A session whose
agent loop is still running is still refused (`session/in-use`) so in-flight
write-behind cannot recreate the artifact. `session/not-found` now reports the
correct verb. A session object left in the live store after delete is invisible to
the sidebar (the persisted record is gone) and is reclaimed when its owning fiber
disposes.
