import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

/**
 * Keyless Pro + Flash hybrid adapter. The Pro parent (deepseek-v4-pro) emits
 * exactly one `subagent_flash` tool call; the Flash child (deepseek-v4-flash)
 * answers with a plain token; the parent closes with its final answer once the
 * tool result is visible. Branching on the resolved model keeps the script
 * deterministic without inspecting the child's prompt.
 */
class HybridMockAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.model === 'deepseek-v4-flash') {
      const text = 'FLASH_SUBTASK_COMPLETE'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }

    const toolResult = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (toolResult !== undefined) {
      const text = 'PARENT_RECEIVED_FLASH_RESULT'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 3 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }

    const args = JSON.stringify({
      description: 'run one flash subtask',
      prompt: 'Return FLASH_SUBTASK_COMPLETE.',
    })
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id: CallId('hybrid-flash-call'), name: 'subagent_flash', argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId('hybrid-flash-call'), name: 'subagent_flash', arguments: args } }
    yield { type: 'usage', usage: { inputTokens: 6, outputTokens: 4 } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

export const name = 'hybrid-mock-llm'
export const inject = ['llm']

/** Register the keyless `hybrid-mock` adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['hybrid-mock'], new HybridMockAdapter())
}
