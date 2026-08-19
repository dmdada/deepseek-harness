# Agent Note: 混合模型委派通道

Status: implemented

[English](2026-08-18-hybrid-model-delegation-channels.md) | 中文

## 问题

Pro 主 agent 委派廉价工作给 Flash 子 agent 时，需要两个模型可见的委派通道。`tool-subagent` 已经可以通过 `agentOptions.model` 为每个实例固定子 agent 模型，但所有实例渲染出的工具描述完全相同。同一提供方上的两个实例因此会暴露两个模型无法区分的工具：没有任何文案说明哪个通道更便宜，模型自然无法预期它会将简单子任务路由到 Flash、把复杂工作留给 Pro。

## 决策

`tool-subagent` 新增可选的 `description` 配置：追加在生成的工具描述之后的额外面向模型文案。空白配置值会在插件加载时失败，与既有的空 `toolFilter` 失败即报错的处理一致；省略时生成的文案保持不变，因此现有组装和已录制的快照不受影响。

`headless-agent` 示例新增 `hybrid.cordis.yml`：主 agent 保持使用 `deepseek-v4-pro`，通过插入的、名为 `subagent_flash` 的 `tool-subagent` 实例，用 `agentOptions.model` 把子 agent 固定为 `deepseek-v4-flash`，并通过 `description` 告诉模型何时应优先使用它。该通道采用一次性前台模式：廉价子任务很快，等待其结果可以让示例不引入主 `subagent` 工具所使用的任务服务和续接面。

随产品发布的 Web agent preset（`apps/cli/config/agent-presets/` 下的 `standard`、`code` 与 `cordis`）在 `subagent` 和 `subagent_fork` 旁边以 `backgroundMode: continuable` 挂载同一通道，因此 Web 会话可以在后台把廉价工作委派给 Flash 子 agent。父级模型保持为会话自己的选择：模型路由归宿主所有，preset 无法固定 Pro，而适配器默认就已同时公布 `deepseek-v4-pro` 与 `deepseek-v4-flash`。

`tests/headless.snapshot.ts` 中的无密钥快照启动该覆盖层的 mock 适配器副本，端到端驱动一次 `subagent_flash` 委派，并从持久化日志断言分流结果：每个父级 `request/header` 的 config 都解析为 `deepseek-v4-pro`，每个子级 header 都解析为 `deepseek-v4-flash`，父级唯一的工具调用名为 `subagent_flash`，且通道的自定义文案随父级请求头中的工具 schema 一起出现。

## 备选方案

**仅依赖工具名称。** `subagent_flash` 可以辨认，但描述才是主要的模型可见契约；没有文案就无法说明何时应优先使用该通道，而且重命名实例会静默丢失这种区分。

**用系统提示词 section 说明分工。** 人物层级的指令可行，但它与工具分离，且必须与实例的模型固定保持同步；随工具携带的说明会随 schema 一起移动，只要工具可见就保持可见。

**增加按调用指定的模型参数。** 模型将每次委派时自行选择模型，把 provider/model 词汇表复制进工具参数，并迫使每个 schema 消费者都携带它；实例级固定让分工保持声明式，且模型可见面不变。

## 后果

每个已加载实例现在都可以渲染不同的工具描述，因此已经按描述维护缓存稳定性的部署，只会在配置了 `description` 的地方看到预期中的前缀变化。headless 示例中的 `subagent_flash` 通道按构造是一次性前台模式，因此廉价子任务会阻塞父级直到结算；随产品发布的 Web preset 改用 `backgroundMode: continuable`，其 Flash 子代理默认在后台运行。该通道依赖适配器同时公布 `deepseek-v4-pro` 与 `deepseek-v4-flash`；DeepSeek 适配器的默认目录就列出两者。
