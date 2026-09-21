import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { serviceContext } from "@/lib/api/context";
import { SearchClient } from "@/components/search/SearchClient";
import { today } from "@/lib/utils/date";

export const dynamic = "force-dynamic";

export default async function SearchPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const ctx = await serviceContext();

  return (
    <div>
      <h1 className="mb-4 font-(--font-serif-cn) text-lg">搜索回忆</h1>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-(--radius-card) bg-paper-card/70" />}>
        <SearchClient timezone={ctx.timezone} today={today(ctx.timezone)} />
      </Suspense>
    </div>
  );
}
