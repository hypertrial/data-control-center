import { QueryClient } from '@tanstack/react-query'
import { isTransientNetworkError } from '@/lib/transientNetworkError'

/** Extra retries for dev-only transport drops (Vite proxy `socket hang up` during Uvicorn reload). */
export const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (isTransientNetworkError(error)) return failureCount < 5
        return failureCount < 3
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10_000),
    },
  },
})
