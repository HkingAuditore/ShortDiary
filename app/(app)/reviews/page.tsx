import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { serviceContext } from "@/lib/api/context";
import { ReviewBoard } from "@/components/reviews/ReviewBoard";
import { PageShell, AsideCard } from "@/components/common/PageShell";
import { HandNote } from "@/components/paper/PaperCard";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const ctx = await serviceContext();

  const aside = (
    <AsideCard title="关于复盘" seed="review-about">
      <p className="text-xs leading-relaxed text-ink-muted">
        复盘不是压缩，而是把一段时间重新组织成
        <span className="text-ink">「发生了什么 — 哪些反复出现 — 什么值得记住」</span>。
      </p>
      <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-ink-muted">
        <span aria-hidden className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-sage/70" />
        每个结论都来自你的原文，AI 不会改动任何一行。
      </p>
      <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-ink-muted">
        <span aria-hidden className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-sun/80" />
        换了模型也可以随时「重新生成」。
      </p>
      <HandNote className="mt-3 block text-[11px]">低频、慢读的页面，允许更安静一点</HandNote>
    </AsideCard>
  );

  return (
    <PageShell aside={aside}>
      <div>
        <h1 className="mb-4 font-(--font-serif-cn) text-lg">AI 复盘</h1>
        <ReviewBoard timezone={ctx.timezone} />
      </div>
    </PageShell>
  );
}
