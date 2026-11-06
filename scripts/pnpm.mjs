import { spawnSync } from 'node:child_process'
import path from 'node:path'

export function runPnpm(args, options = {}) {
  const pnpm = process.env.npm_execpath
  const isScript = pnpm && /\.[cm]?js$/i.test(pnpm)
  const command = isScript ? process.execPath : pnpm || 'pnpm'
  const env = { ...process.env }
  if (pnpm) env.PATH = `${path.dirname(pnpm)}${path.delimiter}${process.env.PATH || ''}`
  const result = spawnSync(command, [...(isScript ? [pnpm] : []), ...args], { env, ...options })
  if (result.error) throw result.error
  return result
}
