import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHandle, SessionPersistenceSnapshot } from '../src/index.ts'
import SessionPersistence from '../src/index.ts'

const contexts: Context[] = []

/**
 * A backend that stores sessions but owns no removal path, so `delete` stays
 * the inherited default. Every abstract member below is unreachable here: the
 * default's own behavior is what this spec exercises.
 */
class NonDeletingPersistence extends SessionPersistence {
  create(): Promise<SessionHandle> { return Promise.reject(new Error('not used')) }
  open(): Promise<SessionHandle> { return Promise.reject(new Error('not used')) }
  flush(): Promise<void> { return Promise.resolve() }
  stat(): Promise<SessionPersistenceSnapshot | undefined> { return Promise.resolve(undefined) }
  list(): Promise<readonly SessionPersistenceSnapshot[]> { return Promise.resolve([]) }
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(NonDeletingPersistence)
  return ctx
}

afterEach(async () => {
  const mounted = contexts.splice(0)
  await Promise.all(mounted.map(ctx => ctx.fiber.dispose()))
})

describe('SessionPersistence default delete', () => {
  it('refuses an id when the backend cannot remove stored sessions', async () => {
    const ctx = await setup()
    await expect(ctx.sessionPersistence.delete(SessionId('any')))
      .rejects.toThrow('this session persistence backend cannot delete persisted sessions')
  })

  it('observes cancellation before refusing', async () => {
    const ctx = await setup()
    const controller = new AbortController()
    controller.abort(new Error('delete cancelled'))

    await expect(ctx.sessionPersistence.delete(SessionId('any'), { signal: controller.signal }))
      .rejects.toThrow('delete cancelled')
  })

  it('rejects a non-Error abort reason with a named abort failure', async () => {
    const ctx = await setup()
    const controller = new AbortController()
    controller.abort('cancelled')

    await expect(ctx.sessionPersistence.delete(SessionId('any'), { signal: controller.signal }))
      .rejects.toThrow('aborted')
  })
})
