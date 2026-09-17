"use client";

import { useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiGetPage } from "@/lib/api/client";
import { blurhashToDataUrl } from "@/lib/media/placeholder";
import type { PhotoView } from "@/app/api/photos/route";

/**
 * 相册瀑布流：CSS columns 排布，图片用宽高比占位避免跳动，游标分页加载。
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
      <div className="columns-2 gap-2 md:columns-3" aria-busy>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="mb-2 h-40 animate-pulse rounded-[3px] bg-paper-card/70" />
        ))}
      </div>
    );
  }

  if (photos.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-muted">还没有照片。写一条带图记录试试。</p>;
  }

  return (
    <>
      <div className="columns-2 gap-2 md:columns-3">
        {photos.map((p) => {
          const placeholder = blurhashToDataUrl(p.blurhash);
          return (
            <a
              key={p.id}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="mb-2 block overflow-hidden rounded-[3px] border border-ink/10 bg-paper-deep/40"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt=""
                width={p.width}
                height={p.height}
                loading="lazy"
                decoding="async"
                style={{
                  aspectRatio: `${p.width} / ${p.height}`,
                  backgroundImage: placeholder ? `url(${placeholder})` : undefined,
                  backgroundSize: "cover",
                }}
                className="h-auto w-full object-cover"
              />
            </a>
          );
        })}
      </div>

      <div ref={sentinel} className="h-8" />
      {query.isFetchingNextPage ? <p className="text-center text-xs text-ink-faint">载入中…</p> : null}
      {!query.hasNextPage ? <p className="py-4 text-center text-xs text-ink-faint">全部照片已加载</p> : null}
    </>
  );
}
