import { fetchOnThisDay } from "@/lib/db/queries/timeline";
import { formatChineseDate, today } from "@/lib/utils/date";
import { HandNote, WashiTape } from "@/components/paper/PaperCard";

/**
 * 「一年前的今天」（§2.7 回忆库）：服务端组件，纯日期查询，不依赖 AI 也不阻塞首屏。
 * 视觉做成一枚旧纸片：米白底 + 胶带，手写标题。
 */
export async function OnThisDay({ userId, timezone }: { userId: string; timezone: string }) {
  const todayStr = today(timezone);
  const items = await fetchOnThisDay(userId, todayStr.slice(5), todayStr.slice(0, 4), 3);

  if (items.length === 0) return null;

  return (
    <section aria-label="一年前的今天" className="paper-piece paper-drop washi-press deckle-3">
      <span aria-hidden className="paper-sheet" style={{ "--sheet-color": "#f8f1e1" } as React.CSSProperties} />
      <span aria-hidden className="paper-under" style={{ transform: "rotate(-1.1deg) translate(-4px, 3px)" }} />
      <WashiTape seed="onthisday" className="-top-2.5 right-7 h-[1.05rem] w-[3.8rem]" />
      <div className="px-4 py-3.5">
        <h2 className="mb-2 flex items-baseline gap-2 font-(--font-serif-cn) text-sm text-ink">
          往年的今天
          <HandNote className="text-[11px]">时光机</HandNote>
        </h2>
        <ul className="space-y-2.5">
          {items.map((m) => (
            <li key={m.id} className="relative border-l-2 border-sun/55 py-0.5 pl-3 text-xs leading-[1.9] text-ink/90">
              <span className="hand-note mr-1.5 text-[12px] text-ink-muted">
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
