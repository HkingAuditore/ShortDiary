"use client";

import { useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiGetPage } from "@/lib/api/client";
import { blurhashToDataUrl } from "@/lib/media/placeholder";
import { PolaroidPhoto } from "@/components/paper/PaperCard";
import type { PhotoView } from "@/app/api/photos/route";

/**
 * 相册瀑布流（§3.1 照片层）：拍立得/相纸卡片在牛皮纸桌面上散落，
 * 角度由 id 稳定派生（≤2°），hover 时摆正。CSS columns 排布 + 游标分页。
 */
export function PhotoWall() {
  const query = useInfiniteQuery({
    queryKey: ["photos"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiGetPage<PhotoView[]>("/api/photos", { ...(pageParam ? { cursor: pageParam } : {}), limit: 60 }),
    getNextPageParam: (last) => (last.meta?.hasMore ? (last.meta.nextCursor ?? undefined) : undefined),
    staleTime: 5 * 60_000,
  });

  const photos = useMemo(() => (query.data ? query.data.pages.flatMap((p) => p.data) : []), [query.data]);

  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (observed) => {
        if (observed[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (query.isLoading) {
    return (
      <div className="columns-2 gap-4 md:columns-3" aria-busy>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="mb-4 h-44 animate-pulse rounded-[4px] bg-paper-card/70" />
        ))}
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="hand-note text-base text-ink-muted">还没有照片。写一条带图记录试试。</p>
        <p className="mt-2 text-xs text-ink-muted">照片会自动变成拍立得的样子</p>
      </div>
    );
  }

  return (
    <>
      <div className="columns-2 gap-4 md:columns-3 [&>*]:mb-4">
        {photos.map((p) => {
          const placeholder = blurhashToDataUrl(p.blurhash);
          return (
            <PolaroidPhoto
              key={p.id}
              src={p.url}
              alt=""
              width={p.width}
              height={p.height}
              placeholder={placeholder}
              seed={p.id}
              className="break-inside-avoid"
            />
          );
        })}
      </div>

      <div ref={sentinel} className="h-8" />
      {query.isFetchingNextPage ? <p className="text-center text-xs text-ink-muted">正在拿出更多照片…</p> : null}
      {!query.hasNextPage && photos.length > 0 ? (
        <p className="hand-note py-6 text-center text-xs text-ink-muted">— 桌上的照片都摆出来了 —</p>
      ) : null}
    </>
  );
}
