export type AskScope = 'all' | Set<string>
export type AskOptionsFocus = 'model' | 'rows' | 'scope'

const ASK_MODEL_KEY = 'dcc-ask-llm-model'

export function readSavedAskModel(): string {
  try {
    return localStorage.getItem(ASK_MODEL_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveAskModel(model: string): void {
  try {
    localStorage.setItem(ASK_MODEL_KEY, model)
  } catch {
    // Ignore storage failures; model selection still works for the active session.
  }
}

export function scopeSummary(scope: AskScope, datasetCount: number): string {
  if (scope === 'all' || datasetCount === 0) return 'All datasets'
  const selected = scope.size
  return `${selected}/${datasetCount} datasets`
}

export const DEFAULT_ASK_MAX_ROWS = 200
export const DEFAULT_CONVERSATION_TITLE = 'New conversation'

/** Truncate first question into a conversation title. */
export function deriveConversationTitle(question: string, maxLen = 48): string {
  const oneLine = question.replace(/\s+/g, ' ').trim()
  if (!oneLine) return DEFAULT_CONVERSATION_TITLE
  if (oneLine.length <= maxLen) return oneLine
  const cut = oneLine.slice(0, maxLen - 1)
  const lastSpace = cut.lastIndexOf(' ')
  const base = lastSpace > 20 ? cut.slice(0, lastSpace) : cut
  return `${base}…`
}

export function serializeAskScope(scope: AskScope): 'all' | string[] {
  if (scope === 'all') return 'all'
  return [...scope]
}

export function deserializeAskScope(raw: 'all' | string[] | undefined): AskScope {
  if (!raw || raw === 'all') return 'all'
  return new Set(raw)
}

export function settingsSummary(
  model: string,
  maxRows: number,
  scope: AskScope,
  datasetCount: number,
): string {
  const parts = [model || 'model…', `${maxRows} rows`, scopeSummary(scope, datasetCount)]
  return parts.join(' · ')
}
