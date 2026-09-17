"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend } from "@/lib/api/client";
import { PaperButton, PaperCard } from "@/components/paper/PaperCard";
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

export function SettingsPanel() {
  const [tab, setTab] = useState<TabKey>("account");

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "true" : undefined}
            className={[
              "paper-focus rounded-[3px] px-3 py-1.5 text-sm transition-colors",
              tab === t.key ? "bg-paper-strong text-ink shadow-(--shadow-paper)" : "text-ink/70 hover:bg-paper-strong/60",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

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

  return (
    <PaperCard seed="account" className="space-y-3 p-4">
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-ink-muted">显示名称</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="paper-focus w-full rounded-[3px] border border-ink/15 bg-paper-strong px-2.5 py-1.5 outline-none"
        />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block text-xs text-ink-muted">时区（决定「今天」是哪一天）</span>
        <input
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="Asia/Shanghai"
          className="paper-focus w-full rounded-[3px] border border-ink/15 bg-paper-strong px-2.5 py-1.5 outline-none"
        />
      </label>

      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs text-ink-muted">偏好</legend>
        {(
          [
            ["autoAnnotate", "写入后自动交给 AI 整理"],
            ["moodAnalysis", "分析心情"],
            ["simpleMode", "简洁模式（关闭纸纹与撕边）"],
            ["privacyMode", "隐私模式（界面上模糊处理）"],
          ] as Array<[keyof Preferences, string]>
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={prefs[key] === true}
              onChange={(e) => setPrefs((p) => ({ ...p, [key]: e.target.checked }))}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="flex justify-end">
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

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["providers"] });

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

  return (
    <div className="space-y-4">
      <PaperCard seed="providers" className="p-4">
        <h2 className="mb-2 font-(--font-serif-cn) text-base">已配置的服务商</h2>

        {list.data?.length === 0 ? (
          <p className="text-sm text-ink-muted">还没有配置。AI 功能是可选的 —— 不配置也能正常记录。</p>
        ) : null}

        <ul className="space-y-2">
          {(list.data ?? []).map((p) => (
            <li key={p.id} className="rounded-[3px] border border-ink/10 bg-paper-strong/60 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm">
                    {p.name}
                    {p.isDefault ? <span className="ml-1.5 rounded-[2px] bg-sage/20 px-1.5 py-0.5 text-[11px] text-sage">默认</span> : null}
                  </p>
                  <p className="truncate text-[11px] text-ink-faint">
                    {PROTOCOL_LABELS[p.protocol as Protocol] ?? p.protocol} · {p.baseUrl} · Key {p.keyHint}
                  </p>
                  <p className="text-[11px] text-ink-faint">
                    {p.models.map((m) => `${m.role}:${m.modelName}`).join("  ") || "未配置模型"}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <PaperButton variant="ghost" disabled={test.isPending} onClick={() => test.mutate(p.id)}>
                    测试
                  </PaperButton>
                  {!p.isDefault ? (
                    <PaperButton variant="ghost" onClick={() => update.mutate({ id: p.id, body: { isDefault: true } })}>
                      设为默认
                    </PaperButton>
                  ) : null}
                  <PaperButton variant="ghost" onClick={() => remove.mutate(p.id)}>
                    删除
                  </PaperButton>
                </div>
              </div>

              {p.lastTestAt ? (
                <p className="mt-1 text-[11px] text-ink-faint">
                  上次测试：{new Date(p.lastTestAt).toLocaleString("zh-CN")} · {p.lastTestOk ? "成功" : "失败"}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </PaperCard>

      <PaperCard seed="add-provider" className="space-y-2.5 p-4">
        <h2 className="font-(--font-serif-cn) text-base">添加服务商</h2>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-ink-muted">名称</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例如：我的 OpenAI"
              className="paper-focus w-full rounded-[3px] border border-ink/15 bg-paper-strong px-2.5 py-1.5 outline-none"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs text-ink-muted">协议</span>
            <select
              value={form.protocol}
              onChange={(e) => setForm({ ...form, protocol: e.target.value as Protocol })}
              className="paper-focus w-full rounded-[3px] border border-ink/15 bg-paper-strong px-2.5 py-1.5 outline-none"
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
              className="paper-focus w-full rounded-[3px] border border-ink/15 bg-paper-strong px-2.5 py-1.5 outline-none"
            />
          </label>

          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block text-xs text-ink-muted">API Key（AES-256-GCM 加密存储，列表只显示掩码）</span>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              className="paper-focus w-full rounded-[3px] border border-ink/15 bg-paper-strong px-2.5 py-1.5 outline-none"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs text-ink-muted">对话模型</span>
            <input
              value={form.chat}
              onChange={(e) => setForm({ ...form, chat: e.target.value })}
              placeholder="gpt-4o-mini"
              className="paper-focus w-full rounded-[3px] border border-ink/15 bg-paper-strong px-2.5 py-1.5 outline-none"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-xs text-ink-muted">视觉模型（可选）</span>
            <input
              value={form.vision}
              onChange={(e) => setForm({ ...form, vision: e.target.value })}
              className="paper-focus w-full rounded-[3px] border border-ink/15 bg-paper-strong px-2.5 py-1.5 outline-none"
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

      <PaperCard seed="import-provider" className="space-y-2 p-4">
        <h2 className="font-(--font-serif-cn) text-base">粘贴配置导入</h2>
        <p className="text-xs text-ink-muted">支持 snake_case JSON：name / protocol / base_url / api_key / models</p>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={5}
          placeholder={'{\n  "name": "DeepSeek",\n  "protocol": "openai_compatible",\n  "base_url": "https://api.deepseek.com/v1",\n  "api_key": "sk-...",\n  "models": { "chat": "deepseek-chat" }\n}'}
          className="paper-focus w-full rounded-[3px] border border-ink/15 bg-paper-strong p-2 font-mono text-xs outline-none"
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
      <PaperCard seed="export" className="p-4">
        <h2 className="mb-1 font-(--font-serif-cn) text-base">导出我的数据</h2>
        <p className="mb-3 text-xs text-ink-muted">
          数据是你的。三种格式：JSON（可再导入）、Markdown（给人读）、ZIP（含图片原图）。
        </p>
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
          <ul className="mt-3 space-y-1 text-xs text-ink-muted">
            {exports.data.slice(0, 8).map((e) => (
              <li key={e.id} className="flex justify-between gap-2">
                <a className="paper-focus underline decoration-dotted underline-offset-2" href={`/api/export/${e.id}`}>
                  {e.filename}
                </a>
                <span className="text-ink-faint">
                  {(e.sizeBytes / 1024).toFixed(0)} KB · {new Date(e.createdAt).toLocaleString("zh-CN")}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </PaperCard>

      <PaperCard seed="import" className="p-4">
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
