import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import { beforeAll, describe, expect, test } from 'vitest'
import WebSocket from 'ws'
import testJSON from '../../safe.json'
import { getWindows83ShortNameForDotEnv } from '../../root/windows83Filename'
import { isServe, page, viteServer, viteTestUrl } from '~utils'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const stringified = JSON.stringify(testJSON)

describe.runIf(isServe)('main', () => {
  beforeAll(async () => {
    const srcPrefix = viteTestUrl.endsWith('/') ? '' : '/'
    await page.goto(viteTestUrl + srcPrefix + 'src/', {
      // while networkidle is discouraged, we use here because we're not using playwright's retry-able assertions,
      // and refactoring the code below to manually retry would be harder to read.
      waitUntil: 'networkidle',
    })
  })

  test('default import', async () => {
    expect(await page.textContent('.full')).toBe(stringified)
  })

  test('named import', async () => {
    expect(await page.textContent('.named')).toBe(testJSON.msg)
  })

  test('safe fetch', async () => {
    expect(await page.textContent('.safe-fetch')).toMatch('KEY=safe')
    expect(await page.textContent('.safe-fetch-status')).toBe('200')
  })

  test('safe fetch with query', async () => {
    expect(await page.textContent('.safe-fetch-query')).toMatch('KEY=safe')
    expect(await page.textContent('.safe-fetch-query-status')).toBe('200')
  })

  test('safe fetch with special characters', async () => {
    expect(
      await page.textContent('.safe-fetch-subdir-special-characters'),
    ).toMatch('KEY=safe')
    expect(
      await page.textContent('.safe-fetch-subdir-special-characters-status'),
    ).toBe('200')
  })

  test('unsafe fetch', async () => {
    expect(await page.textContent('.unsafe-fetch')).toMatch('403 Restricted')
    expect(await page.textContent('.unsafe-fetch-status')).toBe('403')
  })

  test('unsafe fetch with special characters (#8498)', async () => {
    expect(await page.textContent('.unsafe-fetch-8498')).toBe('')
    expect(await page.textContent('.unsafe-fetch-8498-status')).toBe('404')
  })

  test('unsafe fetch with special characters 2 (#8498)', async () => {
    expect(await page.textContent('.unsafe-fetch-8498-2')).toBe('')
    expect(await page.textContent('.unsafe-fetch-8498-2-status')).toBe('404')
  })

  test('safe fs fetch', async () => {
    expect(await page.textContent('.safe-fs-fetch')).toBe(stringified)
    expect(await page.textContent('.safe-fs-fetch-status')).toBe('200')
  })

  test('safe fs fetch', async () => {
    expect(await page.textContent('.safe-fs-fetch-query')).toBe(stringified)
    expect(await page.textContent('.safe-fs-fetch-query-status')).toBe('200')
  })

  test('safe fs fetch with special characters', async () => {
    expect(await page.textContent('.safe-fs-fetch-special-characters')).toBe(
      stringified,
    )
    expect(
      await page.textContent('.safe-fs-fetch-special-characters-status'),
    ).toBe('200')
  })

  test('unsafe fs fetch', async () => {
    expect(await page.textContent('.unsafe-fs-fetch')).toBe('')
    expect(await page.textContent('.unsafe-fs-fetch-status')).toBe('403')
  })

  test('unsafe fs fetch with special characters (#8498)', async () => {
    expect(await page.textContent('.unsafe-fs-fetch-8498')).toBe('')
    expect(await page.textContent('.unsafe-fs-fetch-8498-status')).toBe('404')
  })

  test('unsafe fs fetch with special characters 2 (#8498)', async () => {
    expect(await page.textContent('.unsafe-fs-fetch-8498-2')).toBe('')
    expect(await page.textContent('.unsafe-fs-fetch-8498-2-status')).toBe('404')
  })

  test('nested entry', async () => {
    expect(await page.textContent('.nested-entry')).toBe('foobar')
  })

  test('denied', async () => {
    expect(await page.textContent('.unsafe-dotenv')).toBe('403')
  })

  test('denied EnV casing', async () => {
    // It is 403 in case insensitive system, 404 in others
    const code = await page.textContent('.unsafe-dotEnV-casing')
    expect(code === '403' || code === '404').toBeTruthy()
  })

  test('denied .env with NTFS ADS suffix', async () => {
    // It is 403 on NTFS, 404 on others
    await expect
      .poll(() => page.textContent('.unsafe-dotenv-ntfs-ads'))
      .toMatch(/^(?:403|404)$/)
  })

  const dotEnvWindows83ShortName = getWindows83ShortNameForDotEnv()
  test.skipIf(dotEnvWindows83ShortName === undefined)(
    'denied .env with 8.3 short name',
    async () => {
      await expect
        .poll(() => page.textContent('.unsafe-dotenv-83-short-name'))
        .toBe('403')
    },
  )
})

describe('fetch', () => {
  test('serve with configured headers', async () => {
    const res = await fetch(viteTestUrl + '/src/')
    expect(res.headers.get('x-served-by')).toBe('vite')
  })
})

describe.runIf(isServe)('fetchModule via WebSocket', () => {
  const root = path.resolve(
    __dirname.replace('playground', 'playground-temp'),
    '..',
    '..',
  )

  const fetchModuleViaWebSocket = async (filePath: string) => {
    const resolvedPath = path.resolve(root, filePath)
    const token = viteServer.config.webSocketToken
    const wsUrl = viteTestUrl.replace('http', 'ws')
    const ws = new WebSocket(`${wsUrl}?token=${token}`, ['vite-hmr'])

    try {
      return await Promise.race([
        new Promise<any>((resolve, reject) => {
          ws.on('open', () => {
            ws.send(
              JSON.stringify({
                type: 'custom',
                event: 'vite:invoke',
                data: {
                  name: 'fetchModule',
                  id: 'send:1',
                  data: [pathToFileURL(resolvedPath).href],
                },
              }),
            )
          })

          ws.on('message', (raw: Buffer) => {
            const parsed = JSON.parse(raw.toString())
            if (
              parsed.type === 'custom' &&
              parsed.event === 'vite:invoke' &&
              parsed.data?.id === 'response:1'
            ) {
              resolve(parsed.data.data)
            }
          })

          ws.on('error', (err) => {
            reject(err)
          })
        }),
        setTimeout(10_000).then(() =>
          Promise.reject(new Error('WebSocket response timed out')),
        ),
      ])
    } finally {
      ws.close()
    }
  }

  test('should not read files inside allowed directories as fetchModule is disabled', async () => {
    const result = await fetchModuleViaWebSocket('root/src/safe.txt?raw')
    expect(result.result).toBeUndefined()
    expect(result.error).toBeTruthy()
  })

  test('should not read files outside allowed directories', async () => {
    const result = await fetchModuleViaWebSocket('root/unsafe.txt?raw')
    expect(result.result).toBeUndefined()
    expect(result.error).toBeTruthy()
  })
})
