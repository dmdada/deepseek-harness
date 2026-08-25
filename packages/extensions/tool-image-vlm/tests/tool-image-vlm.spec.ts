import { describe, expect, it } from 'vitest'
import { base64Encode, buildVlmPayload, mimeForPath, parseVlmText, shellQuote } from '../src/lib.ts'

describe('mimeForPath', () => {
  it('maps known image extensions case-insensitively', () => {
    expect(mimeForPath('/a/b/c.PNG')).toBe('image/png')
    expect(mimeForPath('photo.jpeg')).toBe('image/jpeg')
    expect(mimeForPath('x.webp')).toBe('image/webp')
    expect(mimeForPath('x.gif')).toBe('image/gif')
  })

  it('falls back to application/octet-stream for unknown extensions', () => {
    expect(mimeForPath('noext')).toBe('application/octet-stream')
    expect(mimeForPath('file.txt')).toBe('application/octet-stream')
  })
})

describe('base64Encode', () => {
  it('encodes bytes as base64', () => {
    expect(base64Encode(new TextEncoder().encode('hello'))).toBe('aGVsbG8=')
  })
})

describe('shellQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shellQuote('a b')).toBe("'a b'")
  })

  it('escapes embedded single quotes', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })
})

describe('buildVlmPayload', () => {
  it('builds an OpenAI-compatible image message', () => {
    const payload = JSON.parse(buildVlmPayload('m1', 'prompt', 'image/jpeg', 'abc', 10)) as {
      model: string
      max_tokens: number
      messages: Array<{ role: string; content: Array<{ type: string; image_url?: { url: string }; text?: string }> }>
    }
    expect(payload.model).toBe('m1')
    expect(payload.max_tokens).toBe(10)
    const message = payload.messages[0]!
    expect(message.role).toBe('user')
    expect(message.content[0]).toEqual({ type: 'text', text: 'prompt' })
    expect(message.content[1]!.image_url?.url).toBe('data:image/jpeg;base64,abc')
  })
})

describe('parseVlmText', () => {
  it('extracts the assistant content', () => {
    expect(parseVlmText(JSON.stringify({ choices: [{ message: { content: '答案' } }] }))).toBe('答案')
  })

  it('rejects relay error records', () => {
    expect(() => parseVlmText(JSON.stringify({ error: { message: 'boom' } }))).toThrow(/VLM relay error/)
    expect(() => parseVlmText(JSON.stringify({ status: 'error', message: 'boom' }))).toThrow(/VLM relay error/)
  })

  it('rejects non-JSON bodies', () => {
    expect(() => parseVlmText('<html>')).toThrow(/non-JSON/)
  })

  it('rejects unexpected response shapes', () => {
    expect(() => parseVlmText(JSON.stringify({ choices: [] }))).toThrow(/unexpected VLM response/)
    expect(() => parseVlmText(JSON.stringify({ choices: [{ message: {} }] }))).toThrow(/unexpected VLM response/)
  })
})
