import { fetchOnThisDay } from "@/lib/db/queries/timeline";
import { formatChineseDate, today } from "@/lib/utils/date";

/**
 * 「一年前的今天」：服务端组件，纯日期查询，不依赖 AI 也不阻塞首屏。
 */
export async function OnThisDay({ userId, timezone }: { userId: string; timezone: string }) {
  const todayStr = today(timezone);
  const items = await fetchOnThisDay(userId, todayStr.slice(5), todayStr.slice(0, 4), 3);

  if (items.length === 0) return null;

  return (
    <section aria-label="一年前的今天" className="rounded-(--radius-card) bg-paper-strong/70 px-3.5 py-3">
      <h2 className="mb-1.5 font-(--font-serif-cn) text-sm text-ink">一年前的今天</h2>
      <ul className="space-y-1.5">
        {items.map((m) => (
          <li key={m.id} className="text-xs leading-relaxed text-ink/80">
            <span className="mr-1.5 text-ink-faint">{formatChineseDate(m.entryDate).replace(/·.*$/, "").trim()}</span>
            {m.content.length > 90 ? `${m.content.slice(0, 90)}…` : m.content}
          </li>
        ))}
      </ul>
    </section>
  );
}
