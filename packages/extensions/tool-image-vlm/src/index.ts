/**
 * Model-facing image-perception tool: sends a local image file to a
 * vision-language model (VLM) served by an OpenAI-compatible relay
 * (`/v1/chat/completions`) and returns the model's textual description or
 * answer. The harness's own model route never needs image input — the relay
 * answers for it, so `image_understand` works under any model.
 *
 * Host-plane plugin: `fs` reads the image, `shell` drives `sips` downscaling
 * and the relay `curl` call (request body on stdin). Composition row:
 * `tool-image-vlm`.
 * @module @deepseek-ai/dsh-tool-image-vlm
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-fs'
import { base64Encode, buildVlmPayload, mimeForPath, parseVlmText, shellQuote } from './lib.ts'

export const name = 'tool-image-vlm'
export const inject = ['tools', 'shell', 'fs']

const DEFAULT_RELAY_URL = 'http://21.76.68.189:8081'
const DEFAULT_MODEL = 'qwen3-235b-vl-adt'
const DEFAULT_MAX_DIMENSION = 1024
const DEFAULT_MAX_TOKENS = 1200
const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** Runtime configuration for the image-perception tool. */
export interface Config {
  /** Relay base URL serving the OpenAI-compatible chat-completions API. */
  relayUrl?: string
  /** Default vision-language model id served by the relay. */
  defaultModel?: string
  /** Longest edge in pixels the image is downscaled to before upload. */
  maxDimension?: number
  /** Completion token budget for the VLM answer. */
  maxTokens?: number
  /** Byte cap for reading the (possibly downscaled) image file. */
  maxImageBytes?: number
}

/** Runtime configuration schema for the image-perception tool. */
export const Config: z<Config> = z.object({
  relayUrl: z.string().default(DEFAULT_RELAY_URL),
  defaultModel: z.string().default(DEFAULT_MODEL),
  maxDimension: z.number().default(DEFAULT_MAX_DIMENSION),
  maxTokens: z.number().default(DEFAULT_MAX_TOKENS),
  maxImageBytes: z.number().default(DEFAULT_MAX_IMAGE_BYTES),
})

const DEFAULT_PROMPT = '请详细描述这张图片的内容：包括主体、场景、人物、文字、颜色、风格等。如果图中有文字，请原样抄录。'

/** Random per-call suffix for the temporary downscaled image path. */
function tempSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function apply(ctx: Context, config: Config = {}): void {
  const relayUrl = config.relayUrl ?? DEFAULT_RELAY_URL
  const defaultModel = config.defaultModel ?? DEFAULT_MODEL
  const maxDimension = config.maxDimension ?? DEFAULT_MAX_DIMENSION
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS
  const maxImageBytes = config.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES

  ctx.tools.register(defineTool({
    name: 'image_understand',
    description: 'Perceive and understand an image file with a vision-language model. '
      + 'Send a local image path (plus an optional question) to the relay VLM and get back a textual description or answer. '
      + 'Use this whenever you need to see image content: describe a picture, read text or a screenshot, '
      + 'or answer a question about an image. The image is downscaled to at most 1024px and converted to JPEG before upload.',
    parameters: {
      file_path: {
        type: 'string',
        required: true,
        description: 'Path to the image file to perceive (PNG/JPEG/GIF/WebP). Resolved by the filesystem backend.',
      },
      prompt: {
        type: 'string',
        description: 'Question or instruction about the image, in any language. Defaults to a detailed Chinese description request.',
      },
      model: {
        type: 'string',
        description: 'Vision-language model id served by the relay. Defaults to the configured default model.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    // Every call owns its temp paths and its own curl process, so calls may overlap.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const model = args.model ?? defaultModel
      const prompt = args.prompt ?? DEFAULT_PROMPT

      const inputTarget = await ctx.fs.resolve(args.file_path, { signal: exec.signal })
      const info = await ctx.fs.stat(inputTarget, exec.signal)
      if (info === undefined) {
        throw new Error(`image not found: ${args.file_path}`)
      }
      let imagePath = ctx.fs.processPath(inputTarget)
      let mime = mimeForPath(imagePath)

      // Best-effort downscale to JPEG at maxDimension; fall back to the original file.
      const tmpImage = `/tmp/dsh-vlm-${tempSuffix()}.jpg`
      const sipsResult = await ctx.shell.run(ctx.shell.resolve({
        command: `sips -Z ${maxDimension} ${shellQuote(imagePath)} --out ${shellQuote(tmpImage)} 2>/dev/null`,
        timeoutMs: 60000,
        signal: exec.signal,
      }))
      if (sipsResult.exitCode === 0) {
        imagePath = tmpImage
        mime = 'image/jpeg'
      }

      const imageTarget = await ctx.fs.resolve(imagePath)
      const bytes = await ctx.fs.readBytes(imageTarget, exec.signal, maxImageBytes)
      const payload = buildVlmPayload(model, prompt, mime, base64Encode(bytes), maxTokens)

      const curlResult = await ctx.shell.run(ctx.shell.resolve({
        command: `curl -s -m 180 ${shellQuote(`${relayUrl}/v1/chat/completions`)} -H ${shellQuote('Content-Type: application/json')} --data-binary @-`,
        timeoutMs: 200000,
        signal: exec.signal,
        stdin: payload,
        stdoutMaxBytes: 4 * 1024 * 1024,
      }))
      if (curlResult.exitCode !== 0) {
        throw new Error(`VLM relay request failed (exit ${curlResult.exitCode}): ${curlResult.stderr.text}`)
      }
      return parseVlmText(curlResult.stdout.text)
    },
    presentCall(args): GenericCallView {
      return {
        card: 'generic',
        title: `Understand image ${args.file_path}`,
        kind: 'read',
        locations: [{ path: args.file_path }],
      }
    },
  }))
}
