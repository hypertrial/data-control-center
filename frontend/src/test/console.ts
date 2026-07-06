import { afterEach, beforeEach, vi } from 'vitest'

type ConsolePattern = string | RegExp

const allowed = {
  error: [] as ConsolePattern[],
  warn: [] as ConsolePattern[],
}

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg
      if (arg instanceof Error) return arg.stack ?? arg.message
      try {
        return JSON.stringify(arg)
      } catch {
        return String(arg)
      }
    })
    .join(' ')
}

function isAllowed(kind: keyof typeof allowed, message: string): boolean {
  return allowed[kind].some((pattern) =>
    typeof pattern === 'string' ? message.includes(pattern) : pattern.test(message),
  )
}

export function allowConsoleError(...patterns: ConsolePattern[]): void {
  allowed.error.push(...patterns)
}

export function allowConsoleWarn(...patterns: ConsolePattern[]): void {
  allowed.warn.push(...patterns)
}

export function installConsoleFailGuard(teardown: () => void): void {
  let errorSpy: ReturnType<typeof vi.spyOn> | null = null
  let warnSpy: ReturnType<typeof vi.spyOn> | null = null

  beforeEach(() => {
    allowed.error = []
    allowed.warn = []
    errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const message = formatArgs(args)
      if (isAllowed('error', message)) return
      throw new Error(`Unexpected console.error: ${message}`)
    })
    warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      const message = formatArgs(args)
      if (isAllowed('warn', message)) return
      throw new Error(`Unexpected console.warn: ${message}`)
    })
  })

  afterEach(() => {
    teardown()
    errorSpy?.mockRestore()
    warnSpy?.mockRestore()
  })
}
