/**
 * Pure helpers for the image-perception tool: MIME mapping, base64 encoding,
 * the OpenAI-compatible request payload, and response parsing. No harness
 * services or runtime state, so the unit tests exercise them in isolation.
 * @module @deepseek-ai/dsh-tool-image-vlm/src/lib
 */

/** MIME type by file extension; VLM relays accept these data URLs. */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

/**
 * Map a path to its declared image MIME type by extension.
 * @param path - the image path.
 * @returns the MIME type, or `application/octet-stream` for an unknown extension.
 */
export function mimeForPath(path: string): string {
  const match = /(\.[A-Za-z0-9]+)$/.exec(path)
  const ext = match === null ? '' : (match[1] ?? '').toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/**
 * Base64-encode raw image bytes for the data URL payload.
 * @param bytes - the raw image bytes.
 * @returns the base64 payload.
 */
export function base64Encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/**
 * Quote a string as one bash word.
 * @param value - the value to quote.
 * @returns a single-quoted shell literal.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, '\'\\\'\'')}'`
}

/**
 * Build the OpenAI-compatible chat-completions request body for one image.
 * @param model - the relay model id.
 * @param prompt - the text question or instruction.
 * @param mime - the image MIME type for the data URL.
 * @param base64 - the base64 image payload.
 * @param maxTokens - the completion token budget.
 * @returns the serialized JSON request body.
 */
export function buildVlmPayload(model: string, prompt: string, mime: string, base64: string, maxTokens: number): string {
  return JSON.stringify({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
        ],
      },
    ],
    max_tokens: maxTokens,
  })
}

/** The response record fields the tool reads. */
interface VlmResponseRecord {
  error?: unknown
  status?: unknown
  message?: unknown
  choices?: Array<{ message?: { content?: unknown } }>
}

/**
 * Parse the relay's chat-completions response and return the answer text.
 * @param raw - the raw response body.
 * @returns the assistant's text content.
 * @throws when the body is not the expected shape or carries a relay error.
 */
export function parseVlmText(raw: string): string {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error(`VLM relay returned non-JSON: ${raw.slice(0, 400)}`)
  }
  const record = json as VlmResponseRecord
  if (record.error !== undefined || record.status === 'error') {
    throw new Error(`VLM relay error: ${JSON.stringify(record.error ?? record.message ?? record)}`)
  }
  const content = record.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error(`unexpected VLM response: ${raw.slice(0, 400)}`)
  }
  return content
}
