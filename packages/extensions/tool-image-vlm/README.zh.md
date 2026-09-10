---
description: "面向模型的图像感知：image_understand 工具把本地图片发给 OpenAI 兼容的视觉语言中转站并返回其文字，供自身模型路由无法接收图片输入的部署使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-image-vlm

[English](README.md) | 中文

## 概述

`dsh-tool-image-vlm` 给 agent 一个工具 `image_understand`：它把本地图片发给 OpenAI 兼容的视觉语言中转站，并返回中转站的文字，从而回答关于该图片的问题。harness 自身的模型路由从不接收图片，因此该工具在任何被路由的模型下都能工作，包括只接受文本的模型。当 agent 必须读取截图、图表或拍摄下来的文字时挂载它；代价是每次调用一次外部请求、图片字节离开主机送往部署自行选择的中转站，以及仅在 macOS 上可用的缩小步骤。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在同时提供 `ctx.tools`、`ctx.shell` 与 `ctx.fs` 的 host 平面组合中挂载本插件：插件声明了这三个服务，只有它们都存在之后工具才会出现。常见路径就是一次调用——agent 传入本地图片路径，中转站的回答作为工具结果返回。

### 何时选择它

当 agent 必须读取图像内容、而被路由的模型无法接收图片时，选择本工具：由中转站代为回答，被路由的模型不需要任何图片输入模态。当被路由的模型确实接受图片输入时，改用 [`dsh-tool-fs`](../../fs/tool-fs/README.zh.md) 的 `read_image` 工具——它按该路由自身的计价把图片附加到 harness 请求上，并要求 `ctx.attachments`。

### 最小配置

```yaml
- id: tool-image-vlm
  name: '@deepseek-ai/dsh-tool-image-vlm'
```

没有任何字段是必填的；按上面形状挂载的行直接使用下列默认值。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `relayUrl` | `http://21.76.68.189:8081` | 提供 OpenAI 兼容 chat-completions API 的中转站基址 |
| `defaultModel` | `qwen3-235b-vl-adt` | 向中转站请求的视觉语言模型 id |
| `maxDimension` | `1024` | 上传前图片被缩小到的像素最长边 |
| `maxTokens` | `1200` | 作为 `max_tokens` 发给中转站的补全 token 预算 |
| `maxImageBytes` | `20971520` | 读取（可能已缩小的）图片文件的字节上限 |

### 一次调用做什么

`image_understand(file_path, prompt?, model?)`：

1. 通过 `ctx.fs` 解析并 stat 图片路径；目标不存在时以 `image not found: <path>` 失败。
2. 用 `sips` 把图片缩小到至多 `maxDimension` 像素并转为 JPEG，结果存放在 `/tmp` 下；当 `sips` 不可用或退出码非零时，改用原文件及其按扩展名判定的 MIME 类型。
3. 对字节做 Base64 编码，构建 OpenAI 兼容请求体：一条 user 消息同时携带提示文本与 `image_url` data URL，`max_tokens` 取 `maxTokens`。
4. 用 `curl` 把该请求体 POST 到 `${relayUrl}/v1/chat/completions`，并把 `choices[0].message.content` 作为工具结果返回。

`prompt` 默认为一段固定的中文请求，要求详细描述图片并原样抄录图中文字；`model` 默认为 `defaultModel`。

### 失败

每一次失败都抛出工具错误：文件缺失、`curl` 非零退出并带上中转站的 stderr、中转站返回携带 `error` 或 `status: 'error'` 的记录、非 JSON 响应体，或 `choices[0].message.content` 不是字符串的 JSON 体。

调用可以重叠。每次调用拥有自己的临时路径与自己的 `curl` 进程，因此重叠的调用既不共享文件，也不共享进程。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计理念

本包是在三个既有服务之上的一次工具注册：`ctx.fs` 读取图片，`ctx.shell` 运行两条辅助命令，`ctx.tools` 收到该定义。视觉模型被刻意放在 harness 之外：中转站拥有权重与 OpenAI 兼容的线上格式，因此 harness 只送出字节、收回文本，被路由的模型永远不需要图片输入。这一放置也决定了失败如何到达：中转站故障、请求被拒或缺少 `curl`，都会作为普通工具错误到达模型，而不会改变工具定义。

两条 shell 调用就是全部运行时。`sips -Z <maxDimension> <image> --out <temp>` 决定是否存在缩小后的 JPEG，一次 `curl` POST 用 `--data-binary @-` 从 stdin 读取请求体，带 180 秒传输上限（位于 200 秒 shell 超时之内）与 4 MiB stdout 上限。两步共同喂入同一个固定的线上格式：MIME 类型由文件扩展名决定（`.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`、`.bmp`，其他一律成为 `application/octet-stream`），响应解析只接受 `choices[0].message.content` 字符串。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、`image_understand` 注册、缩小与中转站调用，以及 UI 调用卡片 |
| [`src/lib.ts`](src/lib.ts) | 纯辅助函数：按扩展名判定 MIME、base64 编码、shell 引号、请求体与响应解析 |
| [`tests/tool-image-vlm.spec.ts`](tests/tool-image-vlm.spec.ts) | 仅覆盖纯辅助函数的单元测试；shell 与中转站路径没有自动化覆盖 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从这个面向模型的工具，进入它所驱动的各个 seam，以及另一条图像路径。

- [原生图像路径](../../fs/tool-fs/README.zh.md)——被路由的模型接受图片输入时用于附加图片的 `read_image` 工具。
- [生成的工具目录](../../../docs/tool-catalog.zh.md)——已编目工具的确切 schema，包括 `read_image`。
- [shell 子系统](../../../docs/subsystems/shell.zh.md)——运行 `sips` 与 `curl` 的 shell seam。
- [tools 子系统](../../../docs/subsystems/tools.zh.md)——`ctx.tools` 注册、工具视图与结果渲染。

-----

<a id="model-experience"></a>
## 模型体验

### 图像感知工具定义

#### 模型看到的内容

只要该行已挂载且工具视图接纳它，每次请求都会带上 `image_understand` 定义：名称、固定描述，以及参数 `file_path`（必填）、`prompt` 与 `model`。只有描述会告诉模型：图片会离开主机前往视觉语言中转站，且上传前先缩小；中转站 URL 与中转站的模型 id 都不出现在任何参数文本里。

##### 本包自有的工具描述

```markdown
Perceive and understand an image file with a vision-language model. Send a local image path (plus an optional question) to the relay VLM and get back a textual description or answer. Use this whenever you need to see image content: describe a picture, read text or a screenshot, or answer a question about an image. The image is downscaled to at most 1024px and converted to JPEG before upload.
```

#### Token 影响

在定义可见期间固定：无论模型是否调用该工具，工具的名称、描述与参数描述都占用相同的请求 token，本包也不贡献自己的系统提示词章节。该定义是恒定文本，没有任何 Config 值会改变它的大小。

#### KV Cache 影响

前缀稳定。定义文本在每次请求中都不变地重复，因此保留原本可复用的前缀。挂载或卸载该行会改变请求头所记录的工具集合，从而使下一次请求无法复用此前缀。

### 一次图像调用的中转站回答

#### 模型看到的内容

工具结果就是中转站的 `choices[0].message.content` 字符串，按纯文本渲染。图片本身从不进入 harness 请求——进入的只有这段文本——回答的措辞完全由中转站模型决定。失败的调用以工具错误到达模型，消息来自中转站（`VLM relay error: …`、`VLM relay returned non-JSON: …` 或 `unexpected VLM response: …`），或来自 shell（`VLM relay request failed (exit <code>): <stderr>`）。

#### Token 影响

有条件，且上界由中转站决定：模型调用该工具之前不花费任何 token，回答长度由请求携带的 `max_tokens`（`maxTokens`，默认 1200）封顶，而工具最多读取 4 MiB 的中转站 stdout。返回文本随后作为普通工具结果进入上下文。

#### KV Cache 影响

只追加。回答作为「本来就在途的那次调用」的工具结果到达、延长历史尾部；本包撰写的内容不会重写或重排更早的请求 token。每次调用各自追加自己的结果，而不是替换更早那一个。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明本工具何时不适合，或何时需要特别的操作照顾。它们是当前的包约束，不是任务积压。

- **`sips` 缩小只在 macOS 上存在**——其他平台会按原文件自身的大小与格式上传，因此载荷大小与回答分辨率都随源图而定；`maxImageBytes` 读取上限仍然生效。
- **中转站调用是一次非流式 POST，无重试、无回退模型、无凭据**——请求不携带 `Authorization` 头，因此 `relayUrl` 必须指向部署本就信任的中转站，而中转站故障会作为该工具自身的错误出现，而不是一次被重试的调用。
- **两条辅助命令都经由 `ctx.shell` 运行**——组合必须提供用于缩小的 `sips`，以及执行器 `PATH` 上的 `curl`；该 POST 继承执行器的沙箱，因此拒绝出网访问的 shell 会让每次调用在缩小之后失败。
- **缩小后的副本从不删除**——成功缩小会在 `/tmp` 下留下一个临时 JPEG，没有任何东西移除它，因此反复调用会在主机上不断堆积文件。
- **没有任何随发布组合挂载该行**——只有部署或 preset 加上 `tool-image-vlm` 行之后，`image_understand` 才能到达模型。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。这个面向模型的适配器没有独立 lifecycle stream；执行关系由它调用的能力 seam（`ctx.fs` 与 `ctx.shell`）负责。
