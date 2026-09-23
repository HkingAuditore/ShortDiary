"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { apiGet, apiSend } from "@/lib/api/client";
import { PaperButton, PaperCard, TagChip, HandNote } from "@/components/paper/PaperCard";
import { useToast } from "@/components/common/Toast";
import { PROTOCOL_LABELS, PROTOCOL_DEFAULT_BASE_URL, type Protocol } from "@/lib/ai/types";

interface Preferences {
  privacyMode?: boolean;
  moodAnalysis?: boolean;
  simpleMode?: boolean;
  autoAnnotate?: boolean;
  defaultHome?: "timeline" | "today";
}

interface SettingsView {
  id: string;
  displayName: string;
  timezone: string;
  email: string | null;
  preferences: Preferences | null;
}

interface ProviderView {
  id: string;
  name: string;
  protocol: string;
  baseUrl: string;
  keyHint: string;
  isDefault: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  models: Array<{ role: string; modelName: string }>;
}

/** 系统内置默认（服务端环境变量提供）的只读快照；不含任何可用密钥 */
interface BuiltinView {
  id: string;
  enabled: boolean;
  forced: boolean;
  name: string;
  baseUrl: string;
  model: string;
  visionModel: string | null;
  keyHint: string | null;
  jsonMode: boolean;
}

interface ExportRecord {
  id: string;
  kind: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

const TABS = [
  { key: "account", label: "账户" },
  { key: "ai", label: "AI 服务商" },
  { key: "data", label: "数据" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** 设置页顶部：页签做成一排斜贴的小纸签 */
function SettingsTabs({ tab, setTab }: { tab: TabKey; setTab: (t: TabKey) => void }) {
  return (
    <div role="tablist" aria-label="设置分区" className="flex flex-wrap gap-2.5">
      {TABS.map((t, i) => {
        const active = tab === t.key;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => setTab(t.key)}
            className={clsx(
              "paper-focus rounded-l-[7px] rounded-r-[3px] px-4 py-1.5 text-sm transition-all duration-(--dur-normal) ease-(--ease-spring-soft)",
              active
                ? "-translate-y-[2.5px] bg-paper-strong text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_1px_1px_rgba(74,55,34,.22),0_5px_9px_-3px_rgba(74,55,34,.3)]"
                : "bg-paper-card/80 text-ink/70 hover:-translate-y-[1.5px] hover:text-ink hover:shadow-[0_2px_6px_-2px_rgba(74,55,34,.26)]",
            )}
            style={active ? undefined : { rotate: `${(i - 1) * 0.7}deg` }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function SettingsPanel() {
  const [tab, setTab] = useState<TabKey>("account");

  return (
    <div className="space-y-5">
      <SettingsTabs tab={tab} setTab={setTab} />
      {tab === "account" ? <AccountSection /> : null}
      {tab === "ai" ? <ProviderSection /> : null}
      {tab === "data" ? <DataSection /> : null}
    </div>
  );
}

function AccountSection() {
  const toast = useToast();
  const qc = useQueryClient();

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<SettingsView>("/api/settings"),
    staleTime: 60_000,
  });

  const [displayName, setDisplayName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [prefs, setPrefs] = useState<Preferences>({});

  useEffect(() => {
    if (!settings.data) return;
    setDisplayName(settings.data.displayName);
    setTimezone(settings.data.timezone);
    setPrefs(settings.data.preferences ?? {});
  }, [settings.data]);

  // 简洁模式：直接作用于 <html data-simple>，全局关闭纹理与撕边
  useEffect(() => {
    document.documentElement.dataset.simple = prefs.simpleMode ? "true" : "false";
  }, [prefs.simpleMode]);

  const save = useMutation({
    mutationFn: () => apiSend<SettingsView>("/api/settings", "PATCH", { displayName, timezone, preferences: prefs }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings"] });
      toast.push("已保存", { tone: "success" });
    },
    onError: (err: Error) => toast.push(err.message, { tone: "error" }),
  });

  const PREF_ITEMS: Array<[keyof Preferences, string]> = [
    ["autoAnnotate", "写入后自动交给 AI 整理"],
    ["moodAnalysis", "分析心情"],
    ["simpleMode", "简洁模式（关闭纸纹与撕边）"],
    ["privacyMode", "隐私模式（界面上模糊处理）"],
  ];

  return (
    <PaperCard seed="account" className="space-y-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-ink-muted">显示名称</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="paper-focus w-full rounded-[4px] border border-ink/15 bg-paper-strong px-2.5 py-1.5 shadow-[inset_0_1px_2px_rgba(76,58,39,0.06)] outline-none transition-[border-color] duration-(--dur-fast) focus:border-sage/60"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-xs text-ink-muted">时区（决定「今天」是哪一天）</span>
          <input
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Asia/Shanghai"
            className="paper-focus w-full rounded-[4px] border border-ink/15 bg-paper-strong px-2.5 py-1.5 shadow-[inset_0_1px_2px_rgba(76,58,39,0.06)] outline-none transition-[border-color] duration-(--dur-fast) focus:border-sage/60"
          />
        </label>
      </div>

      <fieldset className="space-y-2 rounded-[4px] bg-paper-strong/60 px-3.5 py-3">
        <legend className="hand-note px-1 text-xs">偏好</legend>
        {PREF_ITEMS.map(([key, label]) => (
          <label key={key} className="flex cursor-pointer items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={prefs[key] === true}
              onChange={(e) => setPrefs((p) => ({ ...p, [key]: e.target.checked }))}
              className={clsx("h-4 w-4", key === "simpleMode" ? "accent-sun" : "accent-sage")}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="flex items-center justify-between">
        <HandNote className="text-[11px]">改动会立即生效</HandNote>
        <PaperButton variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "保存中…" : "保存"}
        </PaperButton>
      </div>
    </PaperCard>
  );
}

const EMPTY_FORM = {
  name: "",
  protocol: "openai_compatible" as Protocol,
  baseUrl: "",
  apiKey: "",
  chat: "",
  vision: "",
  embedding: "",
};

const inputCls =
  "paper-focus w-full rounded-[4px] border border-ink/15 bg-paper-strong px-2.5 py-1.5 shadow-[inset_0_1px_2px_rgba(76,58,39,0.06)] outline-none transition-[border-color] duration-(--dur-fast) focus:border-sage/60";

function ProviderSection() {
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY_FORM);
  const [importText, setImportText] = useState("");

  const list = useQuery({
    queryKey: ["providers"],
    queryFn: () => apiGet<ProviderView[]>("/api/ai/providers"),
    staleTime: 60_000,
  });

  const builtin = useQuery({
    queryKey: ["ai-builtin"],
    queryFn: () => apiGet<BuiltinView>("/api/ai/builtin"),
    staleTime: 60_000,
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["providers"] });

  const testBuiltin = useMutation({
    mutationFn: () => apiSend<{ ok: boolean; message: string }>("/api/ai/builtin", "POST", {}),
    onSuccess: (res) => toast.push(res.ok ? "连接成功" : res.message || "连接失败", { tone: res.ok ? "success" : "error" }),
    onError: (err: Error) => toast.push(err.message, { tone: "error" }),
  });

  const create = useMutation({
    mutationFn: (body: unknown) => apiSend<ProviderView>("/api/ai/providers", "POST", body),
    onSuccess: () => {
      invalidate();
      setForm(EMPTY_FORM);
      setImportText("");
      toast.push("已添加服务商", { tone: "success" });
    },
    onError: (err: Error) => toast.push(err.message, { tone: "error" }),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: unknown }) => apiSend<ProviderView>(`/api/ai/providers/${id}`, "PATCH", body),
    onSuccess: () => {
      invalidate();
      toast.push("已更新", { tone: "success" });
    },
    onError: (err: Error) => toast.push(err.message, { tone: "error" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiSend<{ ok: boolean }>(`/api/ai/providers/${id}`, "DELETE"),
    onSuccess: () => {
      invalidate();
      toast.push("已删除，密钥同时销毁", { tone: "success" });
    },
    onError: (err: Error) => toast.push(err.message, { tone: "error" }),
  });

  const test = useMutation({
    mutationFn: (id: string) => apiSend<{ ok: boolean; code?: string; message?: string }>(`/api/ai/providers/${id}/test`, "POST", {}),
    onSuccess: (res) => {
      invalidate();
      toast.push(res.ok ? "连接成功" : res.message ?? "连接失败", { tone: res.ok ? "success" : "error" });
    },
    onError: (err: Error) => toast.push(err.message, { tone: "error" }),
  });

  const submitForm = () => {
    create.mutate({
      name: form.name,
      protocol: form.protocol,
      baseUrl: form.baseUrl || PROTOCOL_DEFAULT_BASE_URL[form.protocol],
      apiKey: form.apiKey,
      models: { chat: form.chat, ...(form.vision ? { vision: form.vision } : {}), ...(form.embedding ? { embedding: form.embedding } : {}) },
      isDefault: (list.data?.length ?? 0) === 0,
    });
  };

  const submitImport = () => {
    try {
      const parsed = JSON.parse(importText) as unknown;
      create.mutate(parsed);
    } catch {
      toast.push("不是合法的 JSON", { tone: "error" });
    }
  };

  const noOwnProvider = (list.data?.length ?? 0) === 0;

  return (
    <div className="space-y-4">
      <PaperCard seed="builtin-provider" className="p-5">
        <h2 className="mb-1 font-(--font-serif-cn) text-base">系统内置默认</h2>
        <HandNote className="mb-3 block text-[11px]">
          {builtin.data?.enabled
            ? builtin.data.forced
              ? "服务端已锁定：所有 AI 调用都走内置默认"
              : "你没配置自己的服务商时，AI 功能自动走它"
            : "服务端未配置（AI_DEFAULT_API_KEY 为空），需要你自己添加服务商"}
        </HandNote>

        {builtin.data ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-l-[6px] rounded-r-[3px] border border-ink/10 bg-paper-strong/70 px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm">
                {builtin.data.name}
                {builtin.data.enabled ? (
                  <TagChip token="sage" className="h-5 text-[10px]">
                    内置
                  </TagChip>
                ) : (
                  <TagChip className="h-5 text-[10px]">未启用</TagChip>
                )}
                {builtin.data.enabled && noOwnProvider && !builtin.data.forced ? (
                  <span className="text-[11px] text-sage">● 当前生效</span>
                ) : null}
              </p>
              {builtin.data.enabled ? (
                <>
                  <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                    OpenAI 兼容 · {builtin.data.baseUrl} · Key {builtin.data.keyHint}
                  </p>
                  <p className="text-[11px] text-ink-muted">
                    chat:{builtin.data.model}
                    {builtin.data.visionModel ? `  vision:${builtin.data.visionModel}` : ""}
                  </p>
                </>
              ) : null}
            </div>

            {builtin.data.enabled ? (
              <PaperButton variant="secondary" className="px-2.5 py-1 text-xs" disabled={testBuiltin.isPending} onClick={() => testBuiltin.mutate()}>
                测试连接
              </PaperButton>
            ) : null}
          </div>
        ) : null}
      </PaperCard>

      <PaperCard seed="providers" className="p-5">
        <h2 className="mb-1 font-(--font-serif-cn) text-base">已配置的服务商</h2>
        <HandNote className="mb-3 block text-[11px]">AI 是可替换的分析器，你的数据不依赖任何一家</HandNote>

        {noOwnProvider ? (
          <p className="text-sm text-ink-muted">
            {builtin.data?.enabled
              ? "还没有配置，当前由系统内置默认接管。AI 功能是可选的 —— 不配置也能正常记录。"
              : "还没有配置。AI 功能是可选的 —— 不配置也能正常记录。"}
          </p>
        ) : null}

        <ul className="space-y-2.5">
          {(list.data ?? []).map((p, i) => (
            <li
              key={p.id}
              className={clsx(
                "relative rounded-l-[6px] rounded-r-[3px] border bg-paper-strong/70 px-3.5 py-2.5 transition-all duration-(--dur-fast)",
                p.isDefault ? "border-sage/45 shadow-[0_2px_6px_rgba(76,58,39,0.12)]" : "border-ink/10",
              )}
              style={{ transform: `rotate(${((i % 3) - 1) * 0.4}deg)` }}
            >
              {p.isDefault ? (
                <span aria-hidden className="absolute -left-1 top-1/2 h-6 w-2 -translate-y-1/2 rounded-r-[3px] bg-sage shadow-[1px_0_2px_rgba(76,58,39,0.2)]" />
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm">
                    {p.name}
                    {p.isDefault ? <TagChip token="sage" className="h-5 text-[10px]">默认</TagChip> : null}
                    {p.lastTestOk === true ? <span className="text-[11px] text-sage">● 连接正常</span> : null}
                    {p.lastTestOk === false ? <span className="text-[11px] text-rose">● 上次测试失败</span> : null}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-ink-muted">
                    {PROTOCOL_LABELS[p.protocol as Protocol] ?? p.protocol} · {p.baseUrl} · Key {p.keyHint}
                  </p>
                  <p className="text-[11px] text-ink-muted">
                    {p.models.map((m) => `${m.role}:${m.modelName}`).join("  ") || "未配置模型"}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <PaperButton variant="secondary" className="px-2.5 py-1 text-xs" disabled={test.isPending} onClick={() => test.mutate(p.id)}>
                    测试连接
                  </PaperButton>
                  {!p.isDefault ? (
                    <PaperButton variant="ghost" className="px-2.5 py-1 text-xs" onClick={() => update.mutate({ id: p.id, body: { isDefault: true } })}>
                      设为默认
                    </PaperButton>
                  ) : null}
                  <PaperButton variant="ghost" className="px-2.5 py-1 text-xs hover:text-rose" onClick={() => remove.mutate(p.id)}>
                    删除
                  </PaperButton>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </PaperCard>

      <PaperCard seed="add-provider" className="space-y-3 p-5">
        <h2 className="font-(--font-serif-cn) text-base">添加服务商</h2>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-ink-muted">名称</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例如：我的 OpenAI"
              className={inputCls}
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs text-ink-muted">协议</span>
            <select
              value={form.protocol}
              onChange={(e) => setForm({ ...form, protocol: e.target.value as Protocol })}
              className={inputCls}
            >
              {(Object.keys(PROTOCOL_LABELS) as Protocol[]).map((p) => (
                <option key={p} value={p}>
                  {PROTOCOL_LABELS[p]}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-xs text-ink-muted">Base URL（留空用协议默认）</span>
            <input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder={PROTOCOL_DEFAULT_BASE_URL[form.protocol]}
              className={inputCls}
            />
          </label>

          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-xs text-ink-muted">API Key（AES-256-GCM 加密存储，列表只显示掩码）</span>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              className={inputCls}
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs text-ink-muted">对话模型</span>
            <input
              value={form.chat}
              onChange={(e) => setForm({ ...form, chat: e.target.value })}
              placeholder="gpt-4o-mini"
              className={inputCls}
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs text-ink-muted">视觉模型（可选）</span>
            <input
              value={form.vision}
              onChange={(e) => setForm({ ...form, vision: e.target.value })}
              className={inputCls}
            />
          </label>
        </div>

        <div className="flex justify-end">
          <PaperButton
            variant="primary"
            disabled={create.isPending || !form.name || !form.chat || !form.apiKey}
            onClick={submitForm}
          >
            添加
          </PaperButton>
        </div>
      </PaperCard>

      <PaperCard seed="import-provider" className="space-y-2.5 p-5">
        <h2 className="font-(--font-serif-cn) text-base">粘贴配置导入</h2>
        <p className="text-xs text-ink-muted">支持 snake_case JSON：name / protocol / base_url / api_key / models</p>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={5}
          placeholder={'{\n  "name": "DeepSeek",\n  "protocol": "openai_compatible",\n  "base_url": "https://api.deepseek.com/v1",\n  "api_key": "sk-...",\n  "models": { "chat": "deepseek-chat" }\n}'}
          className="paper-focus w-full rounded-[4px] border border-ink/15 bg-paper-strong p-2.5 font-mono text-xs shadow-[inset_0_1px_2px_rgba(76,58,39,0.06)] outline-none transition-[border-color] duration-(--dur-fast) focus:border-sage/60"
        />
        <div className="flex justify-end">
          <PaperButton variant="primary" disabled={create.isPending || !importText.trim()} onClick={submitImport}>
            导入
          </PaperButton>
        </div>
      </PaperCard>
    </div>
  );
}

function DataSection() {
  const toast = useToast();
  const qc = useQueryClient();

  const exports = useQuery({
    queryKey: ["exports"],
    queryFn: () => apiGet<ExportRecord[]>("/api/export"),
    staleTime: 60_000,
  });

  const build = useMutation({
    mutationFn: (kind: "json" | "markdown" | "zip") => apiSend<{ downloadUrl: string; filename: string }>("/api/export", "POST", { kind }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["exports"] });
      toast.push("导出已生成，开始下载", { tone: "success" });
      window.location.href = res.downloadUrl;
    },
    onError: (err: Error) => toast.push(err.message, { tone: "error" }),
  });

  const importFile = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const parsed = JSON.parse(text) as { manifest?: { schemaVersion?: number }; entries?: unknown };
      if (!Array.isArray(parsed.entries)) throw new Error("文件里没有 entries 数组");
      return apiSend<{ imported?: number }>("/api/export", "PUT", {
        manifest: parsed.manifest ?? {},
        entries: parsed.entries,
      });
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["exports"] });
      toast.push(`已导入 ${res.imported ?? ""} 条`, { tone: "success" });
    },
    onError: (err: Error) => toast.push(err.message, { tone: "error" }),
  });

  return (
    <div className="space-y-4">
      <PaperCard seed="export" className="p-5">
        <h2 className="mb-1 font-(--font-serif-cn) text-base">导出我的数据</h2>
        <HandNote className="mb-3 block text-[11px]">数据是你的 —— 随时带走，不留悬念</HandNote>
        <div className="flex flex-wrap gap-2">
          <PaperButton variant="primary" disabled={build.isPending} onClick={() => build.mutate("zip")}>
            导出 ZIP
          </PaperButton>
          <PaperButton variant="secondary" disabled={build.isPending} onClick={() => build.mutate("json")}>
            导出 JSON
          </PaperButton>
          <PaperButton variant="secondary" disabled={build.isPending} onClick={() => build.mutate("markdown")}>
            导出 Markdown
          </PaperButton>
        </div>

        {exports.data && exports.data.length > 0 ? (
          <ul className="mt-4 space-y-1.5 text-xs text-ink-muted">
            {exports.data.slice(0, 8).map((e) => (
              <li key={e.id} className="flex justify-between gap-2">
                <a className="paper-focus underline decoration-dotted underline-offset-2 transition-colors hover:text-ink" href={`/api/export/${e.id}`}>
                  {e.filename}
                </a>
                <span className="text-ink-muted">
                  {(e.sizeBytes / 1024).toFixed(0)} KB · {new Date(e.createdAt).toLocaleString("zh-CN")}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </PaperCard>

      <PaperCard seed="import" className="p-5">
        <h2 className="mb-1 font-(--font-serif-cn) text-base">从导出文件恢复</h2>
        <p className="mb-3 text-xs text-ink-muted">按 id 幂等写入：重复导入不会产生重复条目。</p>
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importFile.mutate(file);
            e.target.value = "";
          }}
          className="paper-focus text-xs"
        />
      </PaperCard>
    </div>
  );
}
