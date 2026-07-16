import type { DatasetSummary } from '@/api/types'
import { api } from '@/api/client'
import type { DuckDbImportSession } from '@/features/datasets/DuckDbImportDialog'
import { resolveLocalFilePath } from '@/features/datasets/localFilePath'
import {
  DUCKDB_USE_IMPORT_MESSAGE,
  partitionIncomingFiles,
  UNSUPPORTED_FILES_MESSAGE,
} from '@/features/datasets/uploadFiles'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

type UseDatasetIngestionOptions = {
  setActiveDatasetId: (id: string | null) => void
  onFirstDataset?: () => void
}

function isPickCancelled(message: string): boolean {
  return /cancel/i.test(message)
}

export function useDatasetIngestion({ setActiveDatasetId, onFirstDataset }: UseDatasetIngestionOptions) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [duckDbSession, setDuckDbSession] = useState<DuckDbImportSession | null>(null)
  const duckDbSessionRef = useRef<DuckDbImportSession | null>(null)
  const [, setDuckDbPickQueue] = useState(0)
  const [, setDuckDbUploadQueue] = useState<File[]>([])
  const [duckDbOpenOpen, setDuckDbOpenOpen] = useState(false)
  const [duckDbOpenHint, setDuckDbOpenHint] = useState<string | undefined>(undefined)

  const capsQ = useQuery({
    queryKey: ['duckdb-capabilities'],
    queryFn: () => api.duckDbCapabilities(),
    staleTime: 60_000,
  })

  useEffect(() => {
    duckDbSessionRef.current = duckDbSession
  }, [duckDbSession])

  const openDuckDbSession = useCallback((filename: string, sourceId: string) => {
    setDuckDbSession({ sourceId, filename })
  }, [])

  const openLocalDuckDbPath = useCallback(
    async (path: string, displayFilename?: string) => {
      const opened = await api.openLocalDuckDb(path)
      openDuckDbSession(displayFilename ?? opened.filename, opened.source_id)
    },
    [openDuckDbSession],
  )

  const pickLocalDuckDb = useCallback(async () => {
    const opened = await api.pickLocalDuckDb()
    openDuckDbSession(opened.filename, opened.source_id)
  }, [openDuckDbSession])

  const resetDuckDbOpenDialog = useCallback(() => {
    setDuckDbOpenOpen(false)
    setDuckDbOpenHint(undefined)
  }, [])

  const ensureDuckDbCapabilities = useCallback(async () => {
    if (capsQ.data) return capsQ.data
    return qc.fetchQuery({
      queryKey: ['duckdb-capabilities'],
      queryFn: () => api.duckDbCapabilities(),
      staleTime: 60_000,
    })
  }, [capsQ.data, qc])

  const canUseNativeDuckDbPick = useCallback(
    async () => {
      const caps = await ensureDuckDbCapabilities()
      return caps.local_open_enabled && caps.native_pick_enabled
    },
    [ensureDuckDbCapabilities],
  )

  const importDuckDbViaNativePick = useCallback(async () => {
    try {
      await pickLocalDuckDb()
    } catch (e) {
      const msg = (e as Error).message
      if (isPickCancelled(msg)) return
      toast.error(msg)
      throw e
    }
  }, [pickLocalDuckDb])

  const stageDuckDbFile = useCallback(
    async (file: File) => {
      const caps = await ensureDuckDbCapabilities()
      const softMax = caps.upload_soft_max_bytes
      const localPath = resolveLocalFilePath(file)
      if (localPath) {
        try {
          await openLocalDuckDbPath(localPath, file.name)
        } catch (e) {
          toast.error((e as Error).message)
        }
        return
      }
      if (file.size > softMax) {
        const mb = Math.round(softMax / (1024 * 1024))
        setDuckDbOpenHint(
          `${file.name} (${Math.round(file.size / (1024 * 1024))} MB) exceeds the ${mb} MB upload limit. Enter an absolute path or use Import DuckDB when available.`,
        )
        setDuckDbOpenOpen(true)
        return
      }
      openDuckDbSession(file.name, '')
      toast.message(`Staging ${file.name}…`)
      try {
        const staged = await api.uploadDuckDb(file)
        openDuckDbSession(file.name, staged.source_id)
      } catch (e) {
        setDuckDbSession(null)
        throw e
      }
    },
    [ensureDuckDbCapabilities, openDuckDbSession, openLocalDuckDbPath],
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
          const firstDataset = !(qc.getQueryData<DatasetSummary[]>(['datasets']) ?? []).length
          const rows = await api.uploadDatasets(dataFiles)
          await qc.invalidateQueries({ queryKey: ['datasets'] })
          if (rows.length) {
            setActiveDatasetId(rows[rows.length - 1]!.dataset_id)
            if (firstDataset) onFirstDataset?.()
            toast.success(
              `Registered ${rows.length} file(s). Large files profile in the background; row counts and quality scores update when ready.`,
            )
          }
        }

        if (duckDbFiles.length) {
          if (await canUseNativeDuckDbPick()) {
            const first = duckDbFiles[0]!
            const localPath = duckDbFiles.length === 1 ? resolveLocalFilePath(first) : null
            if (localPath) {
              try {
                await openLocalDuckDbPath(localPath, first.name)
              } catch (e) {
                toast.error((e as Error).message)
              }
              if (duckDbFiles.length > 1) {
                setDuckDbPickQueue(duckDbFiles.length - 1)
              }
              return
            }
            toast.message(DUCKDB_USE_IMPORT_MESSAGE)
            if (duckDbFiles.length > 1) {
              toast.message(`Importing DuckDB files one at a time (${duckDbFiles.length} selected).`)
            }
            if (!duckDbSessionRef.current) {
              await importDuckDbViaNativePick()
              if (duckDbFiles.length > 1) {
                setDuckDbPickQueue(duckDbFiles.length - 1)
              }
            } else {
              setDuckDbPickQueue((n) => n + duckDbFiles.length)
            }
          } else {
            toast.message(DUCKDB_USE_IMPORT_MESSAGE)
            if (duckDbFiles.length > 1) {
              toast.message(`Importing ${duckDbFiles[0]!.name} first (${duckDbFiles.length} DuckDB files selected).`)
            }
            if (!duckDbSessionRef.current) {
              await stageDuckDbFile(duckDbFiles[0]!)
              if (duckDbFiles.length > 1) {
                setDuckDbUploadQueue(duckDbFiles.slice(1))
              }
            } else {
              setDuckDbUploadQueue((current) => [...current, ...duckDbFiles])
            }
          }
        }
      } catch (e) {
        const msg = (e as Error).message
        if (!isPickCancelled(msg)) toast.error(msg)
      } finally {
        setBusy(false)
      }
    },
    [canUseNativeDuckDbPick, importDuckDbViaNativePick, onFirstDataset, openLocalDuckDbPath, qc, setActiveDatasetId, stageDuckDbFile],
  )

  const closeDuckDbSession = useCallback(() => {
    setDuckDbSession(null)
    setDuckDbPickQueue((remaining) => {
      if (remaining > 0) {
        void importDuckDbViaNativePick().catch(() => undefined)
        return remaining - 1
      }
      return 0
    })
    setDuckDbUploadQueue((uploadQueue) => {
      if (!uploadQueue.length) return uploadQueue
      const [next, ...rest] = uploadQueue
      void stageDuckDbFile(next).catch((e) => toast.error((e as Error).message))
      return rest
    })
  }, [importDuckDbViaNativePick, stageDuckDbFile])

  const handleDuckDbImported = useCallback(
    async (imported: DatasetSummary[]) => {
      const firstDataset = !(qc.getQueryData<DatasetSummary[]>(['datasets']) ?? []).length
      await qc.invalidateQueries({ queryKey: ['datasets'] })
      if (imported.length) {
        setActiveDatasetId(imported[imported.length - 1]!.dataset_id)
        if (firstDataset) onFirstDataset?.()
      }
    },
    [onFirstDataset, qc, setActiveDatasetId],
  )

  const openDuckDbFromDisk = useCallback(
    async (hint?: string) => {
      if (hint) toast.message(hint)
      if (await canUseNativeDuckDbPick()) {
        try {
          await pickLocalDuckDb()
        } catch (e) {
          const msg = (e as Error).message
          if (!isPickCancelled(msg)) toast.error(msg)
        }
        return
      }
      setDuckDbOpenHint(hint)
      setDuckDbOpenOpen(true)
    },
    [canUseNativeDuckDbPick, pickLocalDuckDb],
  )

  const closeDuckDbOpen = resetDuckDbOpenDialog

  const handleDuckDbOpenedFromDisk = useCallback(
    (sourceId: string, filename: string) => {
      resetDuckDbOpenDialog()
      openDuckDbSession(filename, sourceId)
    },
    [openDuckDbSession, resetDuckDbOpenDialog],
  )

  return {
    busy,
    ingestFiles,
    duckDbSession,
    closeDuckDbSession,
    handleDuckDbImported,
    duckDbCapabilities: capsQ.data,
    duckDbOpenOpen,
    duckDbOpenHint,
    openDuckDbFromDisk,
    closeDuckDbOpen,
    handleDuckDbOpenedFromDisk,
  }
}
