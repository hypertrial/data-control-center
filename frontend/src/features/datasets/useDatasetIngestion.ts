import type { DatasetSummary } from '@/api/types'
import { api } from '@/api/client'
import type { DuckDbImportSession } from '@/features/datasets/DuckDbImportDialog'
import { partitionIncomingFiles, UNSUPPORTED_FILES_MESSAGE } from '@/features/datasets/uploadFiles'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

type UseDatasetIngestionOptions = {
  setActiveDatasetId: (id: string | null) => void
}

export function useDatasetIngestion({ setActiveDatasetId }: UseDatasetIngestionOptions) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [duckDbSession, setDuckDbSession] = useState<DuckDbImportSession | null>(null)
  const duckDbSessionRef = useRef<DuckDbImportSession | null>(null)
  const [, setDuckDbQueue] = useState<File[]>([])

  useEffect(() => {
    duckDbSessionRef.current = duckDbSession
  }, [duckDbSession])

  const openNextDuckDbSession = useCallback((file: File, uploadId: string) => {
    setDuckDbSession({ uploadId, filename: file.name })
  }, [])

  const stageDuckDbFile = useCallback(
    async (file: File) => {
      const staged = await api.uploadDuckDb(file)
      openNextDuckDbSession(file, staged.upload_id)
    },
    [openNextDuckDbSession],
  )

  const ingestFiles = useCallback(
    async (picked: File[]) => {
      const { dataFiles, duckDbFiles } = partitionIncomingFiles(picked)
      if (!dataFiles.length && !duckDbFiles.length) {
        toast.error(UNSUPPORTED_FILES_MESSAGE)
        return
      }

      setBusy(true)
      try {
        if (dataFiles.length) {
          const rows = await api.uploadDatasets(dataFiles)
          await qc.invalidateQueries({ queryKey: ['datasets'] })
          if (rows.length) {
            setActiveDatasetId(rows[rows.length - 1]!.dataset_id)
            toast.success(
              `Registered ${rows.length} file(s). Large files profile in the background; row counts and quality scores update when ready.`,
            )
          }
        }

        if (duckDbFiles.length > 1) {
          toast.message(`Importing ${duckDbFiles[0]!.name} first (${duckDbFiles.length} DuckDB files selected).`)
        }

        if (duckDbFiles.length && !duckDbSessionRef.current) {
          await stageDuckDbFile(duckDbFiles[0]!)
          if (duckDbFiles.length > 1) {
            setDuckDbQueue(duckDbFiles.slice(1))
          }
        } else if (duckDbFiles.length) {
          setDuckDbQueue((current) => [...current, ...duckDbFiles])
        }
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [qc, setActiveDatasetId, stageDuckDbFile],
  )

  const closeDuckDbSession = useCallback(() => {
    setDuckDbSession(null)
    setDuckDbQueue((queue) => {
      if (!queue.length) return queue
      const [next, ...rest] = queue
      void stageDuckDbFile(next).catch((e) => toast.error((e as Error).message))
      return rest
    })
  }, [stageDuckDbFile])

  const handleDuckDbImported = useCallback(
    async (imported: DatasetSummary[]) => {
      await qc.invalidateQueries({ queryKey: ['datasets'] })
      if (imported.length) {
        setActiveDatasetId(imported[imported.length - 1]!.dataset_id)
      }
    },
    [qc, setActiveDatasetId],
  )

  return {
    busy,
    ingestFiles,
    duckDbSession,
    closeDuckDbSession,
    handleDuckDbImported,
  }
}
