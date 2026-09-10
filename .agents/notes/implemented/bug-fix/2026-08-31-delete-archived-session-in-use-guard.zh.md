# Agent Note: 允许删除 attached 但空闲的已归档会话

Status: implemented

[English](2026-08-31-delete-archived-session-in-use-guard.md) | 中文

## Problem

`WorkspaceRegistry.deleteSession` 会拒绝任何仍 attached 在 live sessions 存储上的会话，而不只是循环仍在途的那一个：

```ts
if (this.ctx.get('sessions')?.get(sessionId) !== undefined) {
  throw new WorkspaceSessionInUseError(sessionId)
}
```

该功能记录（`2026-08-10-delete-and-unarchive-archived-sessions.zh.md`）写明意图是拒绝*在途*属主，并明确假定已归档会话是持久化、非在运行的会话。该假定在正常产品流程中不成立：归档只把 id 加入注册表归档集合，既不关闭也不解挂会话，因此在同一次应用会话中归档的会话仍 attached 在 live 存储上。此时删除它会触发 `session/in-use` 守卫，实际上永远不会移除它。用户可见的症状是一个删除不掉的已归档对话；前端把这次拒绝吞进 `console.warn`。

## Decision

把守卫收窄到真正在途的工作，并在移除产物前排空残留的缓冲事件。

- `deleteSession` 仅在 `ctx.agents.get(sessionId)?.status === 'running'` 时拒绝。仅仅处于 attached 状态（包括已归档会话）并不算「in use」；该记录本意的「在途属主」现在正是守卫所度量的对象。
- 仍 attached 但空闲的会话在产物移除前先经其自身生命周期收回（`ctx.agents.release`），因此 live 存储条目随日志一同消失（参见[活动条目释放记录](2026-09-10-session-delete-releases-the-live-entry.zh.md)）。属主未委派释放能力的活动条目改为 flush（`sessions.flush`）：排空其缓冲意味着后续写穿已无待办，无法让已删除的日志复活。

`WorkspaceUnknownSessionError` 新增了必填的 `operation` 参数，使同一个类报告正确的动词（`cannot archive session` 与 `cannot delete session`）；此前即便在删除时它也总是说「cannot archive session」。

## Alternatives considered

**在删除前从注册表解挂（dispose）该 attached 会话。** 会话拆解刻意由创建纤维拥有，宿主强制 dispose 会与其写穿竞态（功能记录已否决过这一点）。这里采取的有界版本是排空该纤维的条目而不移除它；后继变更通过委派给该属主自身的 disposer 来释放条目（参见[活动条目释放记录](2026-09-10-session-delete-releases-the-live-entry.zh.md)）。

**保留宽泛守卫，改为在归档时关闭会话。** 这会把行为挪到另一个界面，并会静默解挂用户只是想隐藏的会话；直接删除已归档但空闲的会话才是所要求的产品行为。

## Consequences

删除已归档、attached 但空闲的会话现在会成功：归档条目、每个 workspace 记账、活动会话条目与持久化日志都被移除。agent loop 仍在运行的会话仍被拒绝（`session/in-use`），因此在途写穿无法重建产物。`session/not-found` 现在报告正确的动词。
