# @deepseek-ai/dsh-tool-image-vlm

[English](README.md) | 中文

面向模型的图像感知工具：`image_understand` 把本地图片发送给由 OpenAI 兼容中转站（`POST /v1/chat/completions`）托管的视觉语言模型（VLM），并返回模型的文字描述或回答。harness 自身的模型路由从不参与图片输入——由中转站代为回答，因此该工具在任何模型下都能工作。

组合行（host 平面或某个 preset）：

```yaml
- id: tool-image-vlm
  name: '@deepseek-ai/dsh-tool-image-vlm'
```

## 配置

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `relayUrl` | `http://21.76.68.189:8081` | 提供 OpenAI 兼容 chat-completions API 的中转站基址 |
| `defaultModel` | `qwen3-235b-vl-adt` | 中转站上的默认视觉语言模型 id |
| `maxDimension` | `1024` | 上传前图片最长边被缩小的像素数 |
| `maxTokens` | `1200` | VLM 回答的 token 预算 |
| `maxImageBytes` | `20971520` | 读取（可能已缩小）图片文件的字节上限 |

## 工具

`image_understand(file_path, prompt?, model?)`：

1. 通过 `ctx.fs` 解析并 stat 图片路径。
2. 用 `sips` 将其缩小到至多 `maxDimension` 像素并转为 JPEG（当 `sips` 不可用时回退到原文件，例如非 macOS）。
3. 对字节做 Base64 编码，构建 OpenAI 兼容请求体（`text` + `image_url` data URL）。
4. 用 `curl` 把请求体 POST 到 `${relayUrl}/v1/chat/completions`（body 走 stdin，`--data-binary @-`），返回 `choices[0].message.content`。

错误（文件缺失、curl 非零退出、中转站错误记录、非 JSON 或意外响应）都会抛出中转站的信息。

## 模型体验

### 请求上下文与条件

#### 模型看到的内容

工具自身的描述与参数 schema（`src/index.ts` 中的稳定文本），加上中转站针对所请求图片返回的 VLM 回答。图片本身从不进入 harness 请求——只有其文字描述进入。

#### Token 影响

工具执行前，harness 请求中为零直接 token 成本；返回的描述随后作为普通工具结果进入上下文，受中转站侧 `maxTokens` 预算限制。

#### KV Cache 影响

独立：harness 提示词前缀不变，工具结果是常规的可缓存 tool-result 块。

## 已知限制与暂缓事项

- `sips` 缩小仅在 macOS 上可用；其他平台原样上传原文件。
- 中转站调用是单次非流式 POST，无重试或回退模型逻辑。
- 中转站 URL 与模型是部署配置；不支持 Authorization 头或其他中转站凭据。
