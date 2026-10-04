import { QueryClient } from '@tanstack/react-query'

export function getContext() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 10_000, retry: 1 },
    },
  })
  return { queryClient }
}
