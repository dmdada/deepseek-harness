# @deepseek-ai/dsh-tool-image-vlm

English | [中文](README.zh.md)

Model-facing image perception tool: `image_understand` sends a local image file to a vision-language model (VLM) served by an OpenAI-compatible relay (`POST /v1/chat/completions`) and returns the model's textual description or answer. The harness's own model route never needs image input — the relay answers for it, so the tool works under any model.

Composition row (host plane or a preset):

```yaml
- id: tool-image-vlm
  name: '@deepseek-ai/dsh-tool-image-vlm'
```

## Config

| Field | Default | Meaning |
| --- | --- | --- |
| `relayUrl` | `http://21.76.68.189:8081` | Relay base URL serving the OpenAI-compatible chat-completions API |
| `defaultModel` | `qwen3-235b-vl-adt` | Default vision-language model id on the relay |
| `maxDimension` | `1024` | Longest edge in pixels the image is downscaled to before upload |
| `maxTokens` | `1200` | Completion token budget for the VLM answer |
| `maxImageBytes` | `20971520` | Byte cap for reading the (possibly downscaled) image file |

## Tool

`image_understand(file_path, prompt?, model?)`:

1. Resolves and stats the image path through `ctx.fs`.
2. Downscales it to at most `maxDimension` px and converts to JPEG with `sips` (falls back to the original file when `sips` is unavailable, e.g. non-macOS).
3. Base64-encodes the bytes and builds an OpenAI-compatible request body (`text` + `image_url` data URL).
4. POSTs the body to `${relayUrl}/v1/chat/completions` via `curl` (body on stdin, `--data-binary @-`), and returns `choices[0].message.content`.

Errors (missing file, non-zero curl exit, relay error record, non-JSON or unexpected response) throw with the relay's message.

## Model Experience

### Request context and condition

#### What the model sees

The tool's own description and parameter schema (stable text in `src/index.ts`), plus the VLM answer the relay returns for the requested image. The image itself never enters the harness request — only its textual description does.

#### Token effect

Zero direct token cost in the harness request until the tool executes; the returned description then enters context as a normal tool result, bounded by the relay-side `maxTokens` budget.

#### KV Cache effect

Independent: the harness prompt prefix does not change, and the tool result is a regular cached tool-result block.

## Known Limitations and Deferred Work

- `sips` downscaling is macOS-only; on other platforms the original file is uploaded as-is.
- The relay call is a single non-streaming POST with no retry or fallback model logic.
- The relay URL and model are deployment config; no Authorization header or other relay credential is supported.
