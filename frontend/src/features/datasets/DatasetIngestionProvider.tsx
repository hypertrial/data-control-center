/* eslint-disable react-refresh/only-export-components -- context hook is co-located with provider */
import { createContext, useContext, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { DuckDbImportDialog } from '@/features/datasets/DuckDbImportDialog'
import { DuckDbOpenDialog } from '@/features/datasets/DuckDbOpenDialog'
import { useDatasetIngestion } from '@/features/datasets/useDatasetIngestion'
import { useUiStore } from '@/store/uiStore'

type DatasetIngestionValue = ReturnType<typeof useDatasetIngestion>

const DatasetIngestionContext = createContext<DatasetIngestionValue | null>(null)

export function DatasetIngestionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { setActiveDatasetId } = useUiStore()
  const ingestion = useDatasetIngestion({
    setActiveDatasetId,
    onFirstDataset: () => navigate('/overview'),
  })

  return (
    <DatasetIngestionContext.Provider value={ingestion}>
      {children}
      <DuckDbOpenDialog
        key={ingestion.duckDbOpenOpen ? 'duckdb-open' : 'duckdb-open-closed'}
        open={ingestion.duckDbOpenOpen}
        hint={ingestion.duckDbOpenHint}
        onClose={ingestion.closeDuckDbOpen}
        onOpened={ingestion.handleDuckDbOpenedFromDisk}
      />
      <DuckDbImportDialog
        session={ingestion.duckDbSession}
        onClose={ingestion.closeDuckDbSession}
        onImported={(imported) => void ingestion.handleDuckDbImported(imported)}
      />
    </DatasetIngestionContext.Provider>
  )
}

export function useDatasetIngestionContext(): DatasetIngestionValue {
  const ctx = useContext(DatasetIngestionContext)
  if (!ctx) {
    throw new Error('useDatasetIngestionContext must be used within DatasetIngestionProvider')
  }
  return ctx
}
