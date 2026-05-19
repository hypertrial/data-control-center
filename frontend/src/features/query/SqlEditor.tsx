import { useCallback, useMemo } from 'react'
import type { RefObject } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { vscodeDark } from '@uiw/codemirror-theme-vscode'
import { sql } from '@codemirror/lang-sql'
import { Prec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export function SqlEditor({
  value,
  onChange,
  onRun,
  editorRef,
}: {
  value: string
  onChange: (value: string) => void
  onRun: () => void
  editorRef: RefObject<ReactCodeMirrorRef | null>
}) {
  const runFromShortcut = useCallback(
    (event: Pick<KeyboardEvent, 'defaultPrevented' | 'key' | 'metaKey' | 'ctrlKey' | 'preventDefault'>) => {
      if (event.defaultPrevented) return false
      if (event.key !== 'Enter') return false
      if (!event.metaKey && !event.ctrlKey) return false
      event.preventDefault()
      onRun()
      return true
    },
    [onRun],
  )

  const extensions = useMemo(
    () => [
      vscodeDark,
      sql(),
      Prec.highest(
        EditorView.domEventHandlers({
          keydown: (event) => runFromShortcut(event),
        }),
      ),
    ],
    [runFromShortcut],
  )

  return (
    <div
      className="overflow-hidden rounded-xl border border-border-default"
      onKeyDownCapture={(event) => {
        runFromShortcut(event.nativeEvent)
      }}
    >
      <CodeMirror
        value={value}
        height="200px"
        theme="none"
        extensions={extensions}
        onChange={onChange}
        ref={editorRef}
        className="text-sm [&_.cm-editor]:rounded-lg"
        basicSetup={{ lineNumbers: true, foldGutter: false }}
      />
    </div>
  )
}
