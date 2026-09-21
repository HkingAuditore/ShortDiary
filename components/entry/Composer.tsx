"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";
import { apiSend, uploadWithTicket, type UploadTicketLike } from "@/lib/api/client";
import { DEFAULT_ENCODE, processImage, type EncodedImage } from "@/lib/media/process";
import { PaperButton, TagChip, PolaroidPhoto } from "@/components/paper/PaperCard";
import { useToast } from "@/components/common/Toast";
import { queryKeys } from "@/lib/query/keys";
import type { AssetDescriptor, EntryView } from "@/lib/entry/entry.schema";

/**
 * 记录输入区（§3.10.1 / §3.6）：一条干净白纸条，不做过多纹理。
 * 像发消息一样写：Enter 换行、⌘/Ctrl+Enter 发送、图片拖入即出拍立得预览。
 * 草稿落 IndexedDB —— 关掉浏览器再回来内容还在。
 */

const DRAFT_KEY = "composer-draft";
const MAX_IMAGES = 9;

interface DraftShape {
  content: string;
  tags: string[];
  entryDate: string;
  occurredTime: string;
}

interface PendingImage {
  id: string;
  name: string;
  status: "processing" | "ready" | "error";
  previewUrl: string;
  error?: string;
  encoded?: EncodedImage;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 从正文里抽出 #标签：写完随手打 # 就够了，不用再点一次标签框 */
export function extractTags(content: string): string[] {
  const found = content.match(/#([^\s#。，,.!！?？；;：:]{1,32})/g) ?? [];
  return Array.from(new Set(found.map((t) => t.slice(1)))).slice(0, 10);
}

interface ComposerProps {
  timezone: string;
  today: string;
}

export function Composer({ timezone, today }: ComposerProps) {
  const toast = useToast();
  const qc = useQueryClient();

  const [content, setContent] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [entryDate, setEntryDate] = useState(today);
  const [occurredTime, setOccurredTime] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [backdating, setBackdating] = useState(false);
  const [dragging, setDragging] = useState(false);

  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const restored = useRef(false);

  // 草稿恢复（只恢复一次，避免与用户输入打架）
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void idbGet(DRAFT_KEY).then((draft) => {
      const d = draft as DraftShape | undefined;
      if (!d) return;
      setContent(d.content ?? "");
      setTags(d.tags ?? []);
      setEntryDate(d.entryDate ?? today);
      setOccurredTime(d.occurredTime ?? "");
      if (d.entryDate && d.entryDate !== today) setBackdating(true);
    });
  }, [today]);

  // 草稿保存（防抖 600ms）
  useEffect(() => {
    if (!restored.current) return;
    const timer = setTimeout(() => {
      const payload: DraftShape = { content, tags, entryDate, occurredTime };
      if (!content.trim() && tags.length === 0) void idbDel(DRAFT_KEY);
      else void idbSet(DRAFT_KEY, payload);
    }, 600);
    return () => clearTimeout(timer);
  }, [content, tags, entryDate, occurredTime]);

  const autoGrow = useCallback(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, []);

  useEffect(autoGrow, [content, autoGrow]);

  const addFiles = useCallback(
    async (list: FileList | File[]) => {
      const candidates = Array.from(list).filter((f) => f.type.startsWith("image/"));
      if (candidates.length === 0) return;

      const room = MAX_IMAGES - images.length;
      if (room <= 0) {
        toast.push(`一次最多 ${MAX_IMAGES} 张图片`, { tone: "error" });
        return;
      }
      if (candidates.length > room) {
        toast.push(`最多 ${MAX_IMAGES} 张，已忽略多余的图片`, { tone: "info" });
      }

      for (const file of candidates.slice(0, room)) {
        const id = newId();
        const previewUrl = URL.createObjectURL(file);
        setImages((prev) => [...prev, { id, name: file.name, status: "processing", previewUrl }]);

        try {
          const encoded = await processImage(file, DEFAULT_ENCODE);
          setImages((prev) =>
            prev.map((img) => (img.id === id ? { ...img, status: "ready", previewUrl: URL.createObjectURL(encoded.blob), encoded } : img)),
          );
        } catch (err) {
          setImages((prev) =>
            prev.map((img) => (img.id === id ? { ...img, status: "error", error: err instanceof Error ? err.message : "处理失败" } : img)),
          );
        }
      }
    },
    [images.length, toast],
  );

  const removeImage = useCallback((id: string) => {
    setImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  const create = useMutation({
    mutationFn: async () => {
      const text = content.trim();
      if (!text) throw new Error("写点什么再发送吧");

      const ready = images.filter((i) => i.status === "ready" && i.encoded);
      const assets: AssetDescriptor[] = [];

      if (ready.length > 0) {
        const credentials = await apiSend<{ driver: string; tickets: UploadTicketLike[] }>(
          "/api/uploads/credentials",
          "POST",
          { mimes: ready.map((i) => i.encoded!.mime), entryDate },
        );

        const tickets = credentials.tickets ?? [];
        for (let i = 0; i < ready.length; i += 1) {
          const ticket = tickets[i];
          const item = ready[i];
          if (!ticket || !item?.encoded) continue;

          await uploadWithTicket(ticket, item.encoded.blob, item.encoded.mime);
          assets.push({
            key: ticket.key,
            mime: item.encoded.mime,
            width: item.encoded.width,
            height: item.encoded.height,
            sizeBytes: item.encoded.sizeBytes,
            ...(item.encoded.blurhash ? { blurhash: item.encoded.blurhash } : {}),
          });
        }
      }

      const inline = extractTags(text);
      return apiSend<EntryView>("/api/entries", "POST", {
        content: text,
        entryDate,
        ...(occurredTime ? { occurredTime } : {}),
        ...(assets.length ? { assets } : {}),
        tags: Array.from(new Set([...tags, ...inline])).slice(0, 10),
      });
    },
    onSuccess: () => {
      setContent("");
      setTags([]);
      setOccurredTime("");
      setEntryDate(today);
      setBackdating(false);
      setImages([]);
      void idbDel(DRAFT_KEY);
      void qc.invalidateQueries({ queryKey: queryKeys.entries.all });
      void qc.invalidateQueries({ queryKey: queryKeys.tags.all });
      toast.push("记下了", { tone: "success" });
    },
    onError: (err: Error) => {
      toast.push(err.message, { tone: "error" });
    },
  });

  const busy = create.isPending || images.some((i) => i.status === "processing");

  return (
    <section
      aria-label="写一条记录"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
      className={[
        "paper-noise relative rounded-(--radius-card) bg-paper-strong p-4 shadow-(--shadow-paper) transition-[box-shadow,transform] duration-(--dur-fast) ease-out",
        // 发送瞬间纸条轻压一下（§3.7「发送记录」）
        create.isPending ? "translate-y-[2px] shadow-none" : "",
        dragging ? "ring-2 ring-sage ring-offset-2 ring-offset-paper-bg" : "",
      ].join(" ")}
    >
      {/* 顶部一条窄窄的胶带：标记「这是正在写的纸条」 */}
      <span aria-hidden className="tape absolute -top-2 left-8 h-3.5 w-16 rounded-[1px] opacity-70" />

      <textarea
        ref={textRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            void addFiles(files);
          }
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            if (!busy) create.mutate();
          }
        }}
        rows={3}
        placeholder="刚刚发生了什么？像发消息一样写下来……（⌘/Ctrl + Enter 发送）"
        aria-label="记录正文"
        maxLength={20000}
        className="paper-focus w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-faint"
      />

      {images.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-3">
          {images.map((img) => (
            <li key={img.id} className="relative">
              <PolaroidPhoto
                src={img.previewUrl}
                alt={img.name}
                width={96}
                height={96}
                seed={img.id}
                caption={img.status === "error" ? "处理失败" : undefined}
                className={["w-24", img.status === "processing" ? "opacity-60" : "", img.status === "error" ? "opacity-40 grayscale" : ""].join(" ")}
              >
                {img.status === "processing" ? (
                  <span className="scan-line absolute bottom-2 left-2 right-2 h-0.5 animate-pulse rounded-full" />
                ) : null}
                <button
                  type="button"
                  aria-label={`移除 ${img.name}`}
                  onClick={() => removeImage(img.id)}
                  className="paper-focus absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[11px] text-paper-strong shadow-[0_2px_5px_rgba(76,58,39,0.35)] transition-transform duration-(--dur-fast) hover:scale-110"
                >
                  ×
                </button>
              </PolaroidPhoto>
            </li>
          ))}
        </ul>
      ) : null}

      {backdating ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[4px] bg-paper-card/80 px-3 py-2 text-xs text-ink-muted">
          <label className="flex items-center gap-1.5">
            <span>属于哪一天</span>
            <input
              type="date"
              value={entryDate}
              max={today}
              onChange={(e) => setEntryDate(e.target.value)}
              className="paper-focus rounded-[3px] border border-ink/15 bg-paper-strong px-2 py-1 text-ink"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span>时刻</span>
            <input
              type="time"
              value={occurredTime}
              onChange={(e) => setOccurredTime(e.target.value)}
              className="paper-focus rounded-[3px] border border-ink/15 bg-paper-strong px-2 py-1 text-ink"
            />
          </label>
          <span className="hand-note">{timezone}</span>
          <button
            type="button"
            className="paper-focus underline decoration-dotted underline-offset-2"
            onClick={() => {
              setBackdating(false);
              setEntryDate(today);
              setOccurredTime("");
            }}
          >
            回到今天
          </button>
        </div>
      ) : null}

      {tags.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <TagChip key={t} token="sage" onClick={() => setTags((prev) => prev.filter((x) => x !== t))}>
              #{t} ×
            </TagChip>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <PaperButton variant="ghost" onClick={() => fileRef.current?.click()} aria-label="添加图片">
            🖼 图片
          </PaperButton>
          <PaperButton
            variant="ghost"
            onClick={() => {
              setBackdating((v) => !v);
              if (!backdating) setEntryDate(today);
            }}
            aria-label="补记到某一天"
          >
            📅 补记
          </PaperButton>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="hand-note hidden text-[11px] sm:inline">今天也要记一笔呀</span>
          <PaperButton variant="primary" disabled={busy || !content.trim()} onClick={() => create.mutate()}>
            {create.isPending ? "正在记下…" : "记下"}
          </PaperButton>
        </div>
      </div>
    </section>
  );
}
