"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { apiGetPage } from "@/lib/api/client";
import type { EntryView } from "@/lib/entry/entry.schema";

/** 时间线筛选条件：与后端 listEntryQuerySchema 一一对应 */
export interface EntryFilters {
  from?: string;
  to?: string;
  tag?: string;
  hasImage?: boolean;
  starred?: boolean;
  q?: string;
  limit?: number;
}

export interface EntriesPage {
  data: EntryView[];
  meta: { nextCursor?: string; hasMore?: boolean };
}

export function useEntries(filters: EntryFilters = {}, endpoint = "/api/entries", initialPage?: EntriesPage) {
  const query = useInfiniteQuery({
    queryKey: [endpoint, "list", filters],
    initialPageParam: null as string | null,
    initialData: initialPage ? { pages: [initialPage], pageParams: [null] } : undefined,
    queryFn: ({ pageParam }) =>
      apiGetPage<EntryView[]>(endpoint, {
        ...filters,
        limit: filters.limit ?? 30,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => (last.meta?.hasMore ? (last.meta.nextCursor ?? undefined) : undefined),
  });

  const entries = query.data ? query.data.pages.flatMap((p) => p.data) : [];

  return { ...query, entries };
}
