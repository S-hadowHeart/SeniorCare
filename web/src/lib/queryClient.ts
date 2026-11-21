import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

/**
 * React Query defaults.
 *
 * * `staleTime` of 30 s keeps the dashboards responsive without hammering
 *   the API on every navigation.
 * * 4xx responses are **not** retried — a 401/403/404 will not become
 *   successful by trying again, and retrying would delay the error message
 *   the user needs to see.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: {
      retry: 0,
    },
  },
});
