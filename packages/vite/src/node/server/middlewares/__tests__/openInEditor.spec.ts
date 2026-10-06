import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { isWindows } from '../../../../shared/utils'
import { createServer } from '../..'
import type { ViteDevServer } from '../..'
import { isWindowsUNCPath } from '../openInEditor'

const uncPaths = [
  '\\\\server\\share\\file.js',
  '\\\\server\\share\\file.js:10:5',
  '//server/share/file.js',
  '\\/server/share/file.js',
  '\\\\?\\UNC\\server\\share\\file.js',
  '\\\\127.0.0.1\\c$\\file.js',
]

const localPaths = [
  'C:\\Users\\me\\file.js',
  'C:/Users/me/file.js:10:5',
  '/home/me/file.js',
  '\\server\\file.js',
  'src/main.ts',
]

describe('isWindowsUNCPath', () => {
  test.each(uncPaths)('detects %s', (file) => {
    expect(isWindowsUNCPath(file)).toBe(true)
  })

  test.each(localPaths)('allows %s', (file) => {
    expect(isWindowsUNCPath(file)).toBe(false)
  })
})

describe('/__open-in-editor', () => {
  let server: ViteDevServer
  let httpServer: http.Server
  let baseUrl: string

  beforeAll(async () => {
    server = await createServer({
      configFile: false,
      root: import.meta.dirname,
      logLevel: 'silent',
      server: { middlewareMode: true, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    })
    httpServer = http.createServer(server.middlewares)
    await new Promise<void>((resolve) =>
      httpServer.listen(0, '127.0.0.1', resolve),
    )
    const { port } = httpServer.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    httpServer.closeAllConnections()
    await new Promise((resolve) => httpServer.close(resolve))
    await server.close()
  })

  const openInEditor = (query: string) =>
    fetch(`${baseUrl}/__open-in-editor?${query}`)
  const fileQuery = (file: string) => `file=${encodeURIComponent(file)}`

  // the file does not exist, so launch-editor returns without opening an editor
  const missingFile = 'does-not-exist-xyz.js'

  test.runIf(isWindows)('rejects UNC paths on Windows', async () => {
    for (const file of uncPaths) {
      const res = await openInEditor(fileQuery(file))
      expect(res.status, file).toBe(403)
    }
  })

  test.runIf(isWindows)(
    'rejects a UNC path passed as a repeated file param on Windows',
    async () => {
      const res = await openInEditor(
        `${fileQuery(missingFile)}&${fileQuery(uncPaths[0])}`,
      )
      expect(res.status).toBe(403)
    },
  )

  test('passes a local path through to launch-editor', async () => {
    const res = await openInEditor(fileQuery(missingFile))
    expect(res.status).toBe(200)
  })

  test.skipIf(isWindows)(
    'does not apply the UNC guard on non-Windows platforms',
    async () => {
      const res = await openInEditor(
        fileQuery('\\\\server\\share\\does-not-exist-xyz.js'),
      )
      expect(res.status).toBe(200)
    },
  )
})
