import path from 'node:path'
import type { Connect } from 'dep-types/connect'
import { isWindows } from '../../../shared/utils'

// launch-editor strips a trailing `:line[:column]` before opening the file
const positionRE = /:\d+(?::\d+)?$/

/**
 * Whether `file` resolves to a Windows UNC path (`\\server\share\...`,
 * `//server/share/...`, `\\?\UNC\...`).
 *
 * launch-editor calls `fs.existsSync` on the requested file before opening it,
 * and on Windows touching a UNC path makes the OS connect to that host over
 * SMB, which can leak the user's NTLM credentials.
 *
 * `path.win32` is used so the result is the same on every OS.
 */
export function isWindowsUNCPath(file: string): boolean {
  return path.win32.resolve(file.replace(positionRE, '')).startsWith('\\\\')
}

export function openInEditorGuardMiddleware(): Connect.NextHandleFunction {
  // Keep the named function. The name is visible in debug logs via `DEBUG=connect:dispatcher ...`
  return function viteOpenInEditorGuardMiddleware(req, res, next) {
    if (isWindows) {
      const url = req.url ?? ''
      const queryIndex = url.indexOf('?')
      // check every `file` param: launch-editor-middleware reads the same query
      const query = queryIndex === -1 ? '' : url.slice(queryIndex + 1)
      const files = new URLSearchParams(query).getAll('file')
      if (files.some((file) => isWindowsUNCPath(file))) {
        res.statusCode = 403
        res.end(
          'UNC paths are not supported on Windows to avoid security issues.',
        )
        return
      }
    }
    next()
  }
}
