import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { serviceContext } from "@/lib/api/context";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { PageShell, AsideCard } from "@/components/common/PageShell";
import { HandNote } from "@/components/paper/PaperCard";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  await serviceContext();

  const aside = (
    <AsideCard title="隐私承诺" seed="privacy">
      <p className="text-xs leading-relaxed text-ink-muted">
        API Key 以 AES-256-GCM 加密落库，服务端代理调用，界面永不回显明文。
      </p>
      <p className="mt-2 text-xs leading-relaxed text-ink-muted">
        原始记录永远是第一数据源 —— AI 只是可替换的分析器，删掉服务商也删不掉你的日记。
      </p>
      <HandNote className="mt-3 block text-[11px]">你的抽屉，钥匙在你手里</HandNote>
    </AsideCard>
  );

  return (
    <PageShell aside={aside}>
      <div>
        <h1 className="mb-4 font-(--font-serif-cn) text-lg">设置</h1>
        <SettingsPanel />
      </div>
    </PageShell>
  );
}
