/**
 * Query Key 工厂：统一生成，避免手写不一致导致的缓存失效错乱。
 */
export const queryKeys = {
  entries: {
    all: ["entries"] as const,
    list: (filters: Record<string, unknown>) => ["entries", "list", filters] as const,
    detail: (id: string) => ["entries", "detail", id] as const,
    trash: ["entries", "trash"] as const,
  },
  tags: {
    all: ["tags"] as const,
  },
  reviews: {
    all: ["reviews"] as const,
    list: (type?: string) => ["reviews", "list", type ?? "all"] as const,
    detail: (id: string) => ["reviews", "detail", id] as const,
  },
  providers: {
    all: ["providers"] as const,
  },
  settings: {
    all: ["settings"] as const,
  },
  calendar: (year: number, month: number) => ["calendar", year, month] as const,
  memories: ["memories"] as const,
  photos: (cursor: string | null) => ["photos", cursor ?? "first"] as const,
};
