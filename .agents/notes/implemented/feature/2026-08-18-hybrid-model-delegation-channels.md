# Agent Note: Hybrid model delegation channels

Status: implemented

English | [中文](2026-08-18-hybrid-model-delegation-channels.zh.md)

## Problem

A Pro main agent delegating to cheaper Flash children needs two model-visible delegation channels. `tool-subagent` already pins a child model per instance through `agentOptions.model`, but every instance renders the identical generated tool description. Two instances on one provider therefore expose two tools the model cannot tell apart: nothing says which channel is cheap, so the model cannot be expected to route simple subtasks to Flash and complex work to Pro.

## Decision

`tool-subagent` gains an optional `description` config: extra model-facing wording appended after the generated tool description. A blank configured value fails at plugin load, matching the existing fail-loud treatment of an empty `toolFilter`; omission leaves the generated wording unchanged, so existing compositions and recorded snapshots are unaffected.

The `headless-agent` example ships `hybrid.cordis.yml`: the main agent stays on `deepseek-v4-pro`, and an inserted `tool-subagent` instance named `subagent_flash` pins children to `deepseek-v4-flash` through `agentOptions.model` and carries a `description` telling the model when to prefer it. The channel runs one-shot foreground: cheap subtasks are fast, and awaiting them keeps the example free of the task service and continuation surface the main `subagent` tool uses.

The shipped Web agent presets (`standard`, `code`, and `cordis` in `apps/cli/config/agent-presets/`) mount the same channel beside `subagent` and `subagent_fork` with `backgroundMode: continuable`, so Web sessions can delegate cheap work to Flash children in the background. The parent model stays the session's own selection: the model route is host-owned, so a preset cannot pin Pro, and the adapter already advertises both `deepseek-v4-pro` and `deepseek-v4-flash` by default.

The keyless snapshot in `tests/headless.snapshot.ts` boots a mock-adapter counterpart of the overlay, drives one `subagent_flash` delegation end to end, and asserts the split from the persisted logs: every parent `request/header` config resolves to `deepseek-v4-pro`, every child header to `deepseek-v4-flash`, the parent's only tool call names `subagent_flash`, and the channel's custom wording rides the tool schema inside the parent request header.

## Alternatives considered

**Rely on the tool name alone.** `subagent_flash` is discoverable, but the description is the primary model-facing contract; naming without wording does not say when to prefer the channel, and a renamed instance would silently lose the distinction.

**Explain the split in a system-prompt section.** A persona-level instruction can work, but it lives apart from the tool and must be kept in sync with the instance's model pin; a tool-carried note moves with the schema and stays visible wherever the tool is.

**Add a per-call model parameter.** The model would then pick models per delegation, duplicating the provider/model vocabulary into tool arguments and forcing every schema consumer to carry it; an instance-level pin keeps the split declarative and the surface unchanged.

## Consequences

Each loaded instance may now render a distinct tool description, so a deployment that already keys cache stability on descriptions sees the expected prefix change only where `description` is configured. The headless example's `subagent_flash` channel is one-shot foreground by construction, so a cheap subtask blocks the parent until it settles; the shipped Web presets use `backgroundMode: continuable` instead, so their Flash children run in the background by default. The channel depends on the adapter advertising both `deepseek-v4-pro` and `deepseek-v4-flash`; the DeepSeek adapter's default catalog lists both.
