# Agent Note: 删除会话时释放其活动条目

Status: implemented

[English](2026-09-10-session-delete-releases-the-live-entry.md) | 中文

## Problem

删除一个已挂载但空闲的会话时，除活动对象之外的一切都被移除了。`WorkspaceRegistry.deleteSession` 会丢弃归档集合条目、从每个 Workspace 记账中分离、并删除持久化日志，而会话的 store 条目仍然存活，因为其 teardown 归创建它的 fiber 所有（参见[使用中守卫笔记](2026-08-31-delete-archived-session-in-use-guard.zh.md)）。

该笔记假设残留的活动对象不会出现在会话列表上。事实并非如此：`SessionCorpus.listSessions` 返回持久化 header 与 `ctx.sessions.list()` 中活动会话的并集，因此被删除的会话会持续出现。可观察的流程是：归档会话，再从"已归档"中删除，它就会回到 Ungrouped——删除已把它从 Workspace 记账中分离，而活动对象仍让它留在列表里。再次删除是静默的空操作，因为日志已不存在，`sessionPersistence.delete` 把缺失的 id 视为无可删除；Web 客户端只通过 `console.warn` 报告该拒绝。

仅排空写路径也不够。残留的活动条目仍可再次追加——定时任务、inbox 投递或残留客户端——从而为用户已删除的会话重建一份残缺日志。

## Decision

`WorkspaceRegistry.deleteSession` 在移除产物之前，通过会话自身的生命周期收回活动条目。

- `AgentRegistry.enter(agent, owner, release?)` 在条目上记录一个可选的释放能力。agent loop 传入它记忆化的 `dispose`——即其 `AgentHandle` 返回的同一个闭包——因此无需调用方持有句柄即可拆除该条目。
- 当 id 存活且条目带有该能力时，`AgentRegistry.release(id)` 会执行它。Teardown 仍归创建它的 fiber 所有：注册表委派给所有者的 disposer，而不是自行删除 store 条目，因此"停止并排空、关闭句柄、撤销作用域、成对 detach"这一有序过程仍是唯一的 dispose 路径。
- 删除操作在运行中守卫之后、移除产物之前调用 `ctx.agents.release(sessionId)`。所有者未委派能力的活动条目（非 agent 工厂产出）仍沿用原先的 `sessions.flush` 排空，注册表 README 记录了该限制。

id 不存活、或条目由 `AgentRegistry.register` 创建时，`release` 不做任何事就返回——删除照常进行，行为与之前一致。

## Alternatives considered

**在会话列表中过滤掉已删除的 id。** 只在下一次刷新时隐藏该行，而不收回任何东西：被删除的会话仍处于活动状态，之后任何追加都会在用户认为已消失的会话下重建日志。

**由注册表直接 detach store 条目。** `SessionStore.release(id)` 会在其所有者背后移除条目，与所有者仍持有的写句柄竞争；该条目明确是单次使用且归创建 fiber 所有，因此第二条移除路径破坏的是不变式，而不是弥补缺口。

**在没有释放能力时拒绝删除。** 会在活动会话于 agent 工厂之外进入的特殊组合下大声失败，把原本可用（尽管不完整）的删除变成被阻塞的删除。排空缓冲区并记录限制更实用。

## Consequences

删除已挂载但空闲的会话现在不留痕迹：归档集合、Workspace 记账、日志、活动会话条目与活动 agent 全部消失，该行不会在下次列表刷新或重新加载后回来。用户可见的症状——归档又删除都杀不掉的 Ungrouped 会话——就此关闭。

`AgentRegistry.release` 是第一条不需要 `AgentHandle` 的 teardown 路径，因此句柄不再是拆除单个 agent 的唯一途径。该能力在创建时被委派，且始终由所有者提供；注册表从不自行发明。

存活判断由调用方负责：若被要求，`release` 会拆除正在运行的循环。删除路径自己持有该守卫，因此 `deleteSession` 仍会以 `WorkspaceSessionInUseError` 拒绝进行中的会话。

## Testing

- `packages/core/agent/tests/agent.spec.ts` 覆盖带释放能力的活动条目、`register` 条目与未知 id 上的 `release`。
- `packages/core/agent-loop/tests/scope-lifecycle.spec.ts` 释放一个通过注册表创建的 agent，断言两个注册表都丢弃它、成对的销毁事件按序发出，且句柄自身的 dispose 保持幂等。
- `packages/workspace/workspace/tests/workspace.spec.ts` 固定释放路径（调用 release、不 flush、store 条目消失）与仅排空的回退路径。
- `apps/web/tests/workspace-management.e2e.ts` 通过真实浏览器与宿主归档并删除种子会话，随后重新加载并断言不留任何行，且该 id 在 `ctx.agents`/`ctx.sessions`/持久化中均为空。
