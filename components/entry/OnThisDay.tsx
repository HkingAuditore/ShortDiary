import { fetchOnThisDay } from "@/lib/db/queries/timeline";
import { formatChineseDate, today } from "@/lib/utils/date";
import { HandNote } from "@/components/paper/PaperCard";

/**
 * 「一年前的今天」（§2.7 回忆库）：服务端组件，纯日期查询，不依赖 AI 也不阻塞首屏。
 * 视觉做成一枚旧纸片：米白底 + 胶带，手写标题。
 */
export async function OnThisDay({ userId, timezone }: { userId: string; timezone: string }) {
  const todayStr = today(timezone);
  const items = await fetchOnThisDay(userId, todayStr.slice(5), todayStr.slice(0, 4), 3);

  if (items.length === 0) return null;

  return (
    <section
      aria-label="一年前的今天"
      className="paper-drop relative bg-paper-strong/80 px-4 py-3.5 shadow-(--shadow-paper)"
    >
      <span aria-hidden className="tape absolute -top-2 right-6 h-3.5 w-14 rounded-[1px] opacity-70" />
      <span aria-hidden className="paper-noise pointer-events-none absolute inset-0" />
      <div className="relative">
        <h2 className="mb-2 flex items-baseline gap-2 font-(--font-serif-cn) text-sm text-ink">
          往年的今天
          <HandNote className="text-[11px]">时光机</HandNote>
        </h2>
        <ul className="space-y-2">
          {items.map((m) => (
            <li key={m.id} className="border-l-2 border-sun/50 pl-2.5 text-xs leading-relaxed text-ink/80">
              <span className="hand-note mr-1.5 text-[11px] text-ink-faint">
                {formatChineseDate(m.entryDate).replace(/·.*$/, "").trim()}
              </span>
              {m.content.length > 90 ? `${m.content.slice(0, 90)}…` : m.content}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
