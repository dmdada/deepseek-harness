---
description: "Model-facing image perception: the image_understand tool sends a local image to an OpenAI-compatible vision-language relay and returns its text, for deployments whose routed model cannot accept image input."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-image-vlm

English | [中文](README.zh.md)

## Summary

`dsh-tool-image-vlm` gives an agent one tool, `image_understand`, that answers questions about a local image by sending it to an OpenAI-compatible vision-language relay and returning the relay's text. The harness's own model route never receives the image, so the tool works under any routed model, including one that accepts text only. Mount it when an agent must read a screenshot, a diagram, or photographed text; the costs are one external request per call, image bytes leaving the host for a relay the deployment chooses, and a downscale step available only on macOS.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin in a Host-plane composition that also provides `ctx.tools`, `ctx.shell`, and `ctx.fs`: the plugin declares all three, and the tool appears only after they exist. The common path is one call — the agent passes a local image path, and the relay's answer arrives as the tool result.

### When to choose it

Choose this tool when the agent must read image content but the routed model cannot receive images: the relay answers for that route, so the routed model needs no image-input modality. Choose the `read_image` tool from [`dsh-tool-fs`](../../fs/tool-fs/README.md) instead when the routed model does accept image input — it attaches the image to the harness request under the route's own pricing, and it requires `ctx.attachments`.

### Minimal configuration

```yaml
- id: tool-image-vlm
  name: '@deepseek-ai/dsh-tool-image-vlm'
```

No field is required; a mounted row with this shape uses the defaults below.

| Field | Default | Meaning |
| --- | --- | --- |
| `relayUrl` | `http://21.76.68.189:8081` | Base URL of the relay serving the OpenAI-compatible chat-completions API |
| `defaultModel` | `qwen3-235b-vl-adt` | Vision-language model id the relay is asked for |
| `maxDimension` | `1024` | Longest edge in pixels the image is downscaled to before upload |
| `maxTokens` | `1200` | Completion token budget sent to the relay as `max_tokens` |
| `maxImageBytes` | `20971520` | Byte cap for reading the possibly downscaled image file |

### What one call does

`image_understand(file_path, prompt?, model?)`:

1. Resolves and stats the image path through `ctx.fs`, and fails with `image not found: <path>` when the target is absent.
2. Downscales the image to at most `maxDimension` px and converts it to JPEG with `sips`, keeping the result under `/tmp`; when `sips` is unavailable or exits non-zero, the original file is used unchanged with its extension-derived MIME type.
3. Base64-encodes the bytes and builds an OpenAI-compatible request body: one user message carrying the prompt text and an `image_url` data URL, with `max_tokens` set to `maxTokens`.
4. POSTs that body to `${relayUrl}/v1/chat/completions` with `curl` and returns `choices[0].message.content` as the tool result.

`prompt` defaults to a fixed Chinese request for a detailed description that transcribes any text in the image, and `model` defaults to `defaultModel`.

### Failures

Every failure throws a tool error: a missing file, a non-zero `curl` exit with the relay's stderr, a relay record carrying `error` or `status: 'error'`, a non-JSON body, or a JSON body without a string at `choices[0].message.content`.

Calls may overlap. Each call owns its temporary path and its own `curl` process, so overlapping calls share neither a file nor a process.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The package is one tool registration over three existing services: `ctx.fs` reads the image, `ctx.shell` runs both helper commands, and `ctx.tools` receives the definition. The vision model sits deliberately outside the harness: the relay owns the weights and the OpenAI-compatible wire format, so the harness sends bytes and receives text, and the routed model never needs image input. That placement also decides how failures arrive: a relay outage, a refused request, or a missing `curl` reaches the model as an ordinary tool error, never as a changed tool definition.

Two shell invocations are the whole runtime. `sips -Z <maxDimension> <image> --out <temp>` decides whether a downscaled JPEG exists, and one `curl` POST carries the request with `--data-binary @-` reading the body from stdin, a 180-second transfer limit inside a 200-second shell timeout, and a 4 MiB stdout cap. Both steps feed one fixed wire format: the MIME type comes from the file extension (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`; anything else becomes `application/octet-stream`), and response parsing accepts only a `choices[0].message.content` string.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, the `image_understand` registration, the downscale and relay calls, and the UI call card |
| [`src/lib.ts`](src/lib.ts) | Pure helpers: MIME by extension, base64 encoding, shell quoting, request body, and response parsing |
| [`tests/tool-image-vlm.spec.ts`](tests/tool-image-vlm.spec.ts) | Unit coverage for the pure helpers only; the shell and relay paths have no automated coverage |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from this model-facing tool to the seams it drives and to the alternative image path.

- [Native image path](../../fs/tool-fs/README.md) — the `read_image` tool that attaches an image when the routed model accepts image input.
- [Generated tool catalog](../../../docs/tool-catalog.md) — the exact schemas of the catalogued tools, including `read_image`.
- [Shell subsystem](../../../docs/subsystems/shell.md) — the execution seam that runs `sips` and `curl`.
- [Tools subsystem](../../../docs/subsystems/tools.md) — `ctx.tools` registration, the tool view, and result rendering.

-----

<a id="model-experience"></a>
## Model Experience

### Image-perception tool definition

#### What the model sees

While the row is mounted and the tool view admits it, every request carries the `image_understand` definition: its name, its fixed description, and the parameters `file_path` (required), `prompt`, and `model`. Only the description tells the model that the image leaves the host for a vision-language relay and that a downscale precedes the upload; neither the relay URL nor the relay's model id appears in any parameter text.

##### Tool description this package owns

```markdown
Perceive and understand an image file with a vision-language model. Send a local image path (plus an optional question) to the relay VLM and get back a textual description or answer. Use this whenever you need to see image content: describe a picture, read text or a screenshot, or answer a question about an image. The image is downscaled to at most 1024px and converted to JPEG before upload.
```

#### Token effect

Fixed while the definition is visible: the tool's name, description, and parameter descriptions occupy the same request tokens whether or not the model calls the tool, and the package contributes no system-prompt section of its own. The definition is constant text, so no Config value changes its size.

#### KV Cache effect

Prefix-stable. The definition text repeats unchanged on every request, so it preserves an already-reusable prefix. Mounting or unmounting the row changes the tool set the request header records, which prevents reuse of the previous prefix for the next request.

### Relay answer for one image call

#### What the model sees

The tool result is the relay's `choices[0].message.content` string, rendered as plain text. The image itself never enters a harness request — only this text does — and the answer's wording is entirely the relay model's. A failed call reaches the model as a tool error whose message comes from the relay (`VLM relay error: …`, `VLM relay returned non-JSON: …`, or `unexpected VLM response: …`) or from the shell (`VLM relay request failed (exit <code>): <stderr>`).

#### Token effect

Conditional and bounded by the relay: nothing is spent until the model calls the tool, and the answer length is capped by the `max_tokens` value the request carries (`maxTokens`, default 1200), with the tool reading at most 4 MiB of relay stdout. The returned text then enters context as an ordinary tool result.

#### KV Cache effect

Append-only. The answer arrives as the tool result of the call already in flight, extending the history tail; nothing this package authors rewrites or reorders earlier request tokens. Each call appends its own result rather than replacing an earlier one.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when this tool is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **`sips` downscaling exists only on macOS** — elsewhere the tool uploads the original file at its own size and format, so payload size and answer resolution follow the source image; the `maxImageBytes` read cap still applies.
- **The relay call is one non-streaming POST with no retry, no fallback model, and no credential** — the request carries no `Authorization` header, so `relayUrl` must name a relay the deployment already trusts, and a relay failure surfaces as the tool's own error instead of a retried call.
- **Both helper commands run through `ctx.shell`** — the composition must supply `sips` for downscaling and a `curl` on the executor's `PATH`, and the POST inherits the executor's sandbox, so a shell that denies outbound network access fails every call after downscaling.
- **The downscaled copy is never deleted** — a successful downscale leaves a temporary JPEG under `/tmp`, and nothing removes it, so repeated calls accumulate files on the host.
- **No shipped composition mounts the row** — `image_understand` reaches a model only after a deployment or preset adds the `tool-image-vlm` row.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This model-facing adapter has no independent lifecycle stream; execution relations are owned by the capability seams it calls (`ctx.fs` and `ctx.shell`).
