# Agent Note: 删除与取消归档已归档会话

Status: implemented

[English](2026-08-10-delete-and-unarchive-archived-sessions.md) | 中文

## Problem

归档会话此前只会隐藏它：`workspaceRegistry.archiveSession` 把 id 加入注册表级全局归档集合，各分组视口都排除它，但会话的持久化日志、其 workspace 记账席位与搜索索引条目都原样保留。既没有取消归档入口，也无任何删除底层数据的能力——"Known Limitations"一节明确说会话删除是缺失能力，且 `SessionPersistence` 被记录为仅追加、无移除原语。想要取回归档会话的用户没有恢复路径，想要真正清除数据的用户也没有删除路径。

## Decision

删除与取消归档成为真实的、有文档的操作，把既有归档集合与新的持久化删除原语组合起来。

### 持久化会话删除

`SessionPersistence.delete(id)` 是归档的破坏性对应操作。它是抽象服务上的默认方法，默认大声拒绝（与 `readRaw` 一致）；JSONL 与 SQLite 后端覆盖它。`PersistenceCoordinator.delete` 在会话的串行链上运行（不能与并发 append 交错），随后清理准备缓存、无属主状态与任何 retirement tail，并调用后端 `deleteStored` 钩子。JSONL 后端通过 `findLog` 定位该会话唯一日志，删除会话自有目录并同步幸存的项目目录；已创建但从未物化的会话没有产物，解析为 no-op。SQLite 后端用新增的 `delete-session.sql`（`DELETE FROM sessions WHERE id = ?`）删除 header 行，`ON DELETE CASCADE` 外键级联清理全部子事件行。

`WorkspaceRegistry.deleteSession(id)` 编排注册表侧：对绑定到在运行属主的 id 拒绝（`WorkspaceSessionInUseError`，因为在运行写穿队列会重建产物）、对未知 id 拒绝（`WorkspaceUnknownSessionError`），随后把会话移出归档集合、经实体 `detachSession` 从每个 workspace 记账中摘除（使快照与 domain/changed 流保持一致），最后调用 `sessionPersistence.delete`。

### 取消归档

`WorkspaceRegistry.unarchiveSession(id)` 仅把已归档会话移出归档集合，其余不动：日志与记账席位保留，因此会话在先前位置重新出现。对未归档的 id 幂等。

### Wire、client 与 UI

`workspace.unarchiveSession` 与 `workspace.deleteSession` 是一元 RPC，返回完整更新后的归档集合（与 `workspace.archiveSession` 相同的全快照姿态），并带 `session-in-use` 与 `session-not-found` 错误码。client runtime 在 `IWorkspaces`/`WorkspaceRuntime`/`WorkspaceManager` 暴露 `unarchiveSession`/`deleteSession`；成功的删除会追加一次 `SessionsPort.refresh()` 使被删行离开会话列表。侧边栏会话行菜单新增"取消归档会话"与"删除会话"；`tree.deriveArchivedSessions` 产出"已归档"分组，使归档会话保持可达可操作，`sessionVisible` 守卫对非归档行仍为真。

## Alternatives considered

**保持归档只隐藏、不提供删除路径。** 那会让归档数据永久滞留磁盘，且产品无反制手段——正是所报告的空缺。

**把删除绑定到在运行源，经 agent handle 的 dispose 执行。** 在运行属主的拆解刻意由创建纤维拥有，宿主强制 dispose 会与其写穿队列竞态并重建产物。在注册表拒绝绑定在运行的 id 更安全，且已覆盖归档（持久化、非在运行）场景。

**删除时经新的 host 流帧返回会话行。** client 已在 `host/session-removed` 上移除行，且会话列表在重连时重拉；把删除路由到 `SessionsPort.refresh()` 避免新增一帧，并使删除在 client 侧自包含。

## Verification

新增单元测试覆盖 coordinator 与两个后端的 `delete`（缺省 id no-op、已物化删除、级联清理），以及 workspace 注册表的 `unarchiveSession`（幂等）与 `deleteSession`（归档/记账移除、在运行拒绝、未知拒绝、持久化删除）。所有受影响包在 `tsc -b` 下通过类型检查。

## Consequences

归档仍是纯隐藏；只有 `deleteSession` 移除持久化数据，且不可恢复，仅限非在运行会话。删除仍被某 workspace 记账的会话会在该处摘除，`sessionIds` 收紧且 `updatedAt` 经实体写路径推进。无删除原语的后端默认 `SessionPersistence.delete` 抛出，未受支持的后端大声失败而非貌似成功。
