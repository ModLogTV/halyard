import { describe, expect, it } from 'vitest'
import { isTransientConnectionError, withRetry } from '@/server/db/retry'

const withCode = (code: string) => Object.assign(new Error(code), { code })

describe('isTransientConnectionError', () => {
  it('recognises socket-level connection failures', () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT']) {
      expect(isTransientConnectionError(withCode(code))).toBe(true)
    }
  })

  it('recognises Postgres "starting up" and connection exception codes', () => {
    expect(isTransientConnectionError(withCode('57P03'))).toBe(true)
    expect(isTransientConnectionError(withCode('08006'))).toBe(true)
  })

  it('looks through wrapped errors (Drizzle wraps the driver error as cause)', () => {
    const wrapped = new Error('Failed query', { cause: withCode('ECONNREFUSED') })
    expect(isTransientConnectionError(wrapped)).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isTransientConnectionError(withCode('28P01'))).toBe(false) // bad password
    expect(isTransientConnectionError(new Error('syntax error'))).toBe(false)
    expect(isTransientConnectionError('not an error')).toBe(false)
  })
})

describe('withRetry', () => {
  it('returns the result once the operation succeeds', async () => {
    let calls = 0
    const result = await withRetry(
      async () => {
        calls += 1
        if (calls < 3) throw withCode('ECONNREFUSED')
        return 'ok'
      },
      { timeoutMs: 1000, initialDelayMs: 1, maxDelayMs: 2, sleep: async () => {} },
    )
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  it('rethrows non-transient errors immediately', async () => {
    let calls = 0
    await expect(
      withRetry(
        async () => {
          calls += 1
          throw withCode('28P01')
        },
        { timeoutMs: 1000, initialDelayMs: 1, sleep: async () => {} },
      ),
    ).rejects.toMatchObject({ code: '28P01' })
    expect(calls).toBe(1)
  })

  it('gives up after the timeout and rethrows the last error', async () => {
    let now = 0
    const attempts: number[] = []
    await expect(
      withRetry(
        async () => {
          attempts.push(now)
          throw withCode('ECONNREFUSED')
        },
        {
          timeoutMs: 100,
          initialDelayMs: 10,
          maxDelayMs: 40,
          now: () => now,
          sleep: async (ms) => {
            now += ms
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    expect(attempts.length).toBeGreaterThan(2)
    expect(attempts.at(-1)).toBeLessThanOrEqual(100)
  })

  it('backs off exponentially up to the maximum delay', async () => {
    const delays: number[] = []
    let calls = 0
    await withRetry(
      async () => {
        calls += 1
        if (calls < 5) throw withCode('ECONNREFUSED')
      },
      {
        timeoutMs: 10_000,
        initialDelayMs: 100,
        maxDelayMs: 400,
        sleep: async (ms) => {
          delays.push(ms)
        },
      },
    )
    expect(delays).toEqual([100, 200, 400, 400])
  })
})
