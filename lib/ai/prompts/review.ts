import type { AiMessage } from "../types";

/**
 * 复盘提示词。全部带版本号，写入 reviews.prompt_version，
 * 使「换模型 / 换模板重新生成」与「对比两版」成为可能。
 */

export const DAILY_PROMPT_VERSION = "d1";
export const WEEKLY_PROMPT_VERSION = "w1";
export const MONTHLY_PROMPT_VERSION = "m1";

export interface ReviewEntryInput {
  id: string;
  entryDate: string;
  time: string;
  content: string;
  summary?: string;
  topics?: string[];
}

export function dailyMessages(input: {
  date: string;
  entries: ReviewEntryInput[];
  moodEnabled?: boolean;
}): AiMessage[] {
  const body = input.entries
    .map((e, i) => `[${i + 1}] id=${e.id} ${e.time}\n${e.content}${e.summary ? `\n（摘要：${e.summary}）` : ""}`)
    .join("\n\n");

  return [
    {
      role: "system",
      content: [
        "你是日记复盘助手。基于用户提供的一天记录，输出结构化 JSON。",
        "结构要求：",
        "- summary：3-5 句中文概览，忠实于原文。",
        "- themes：2-5 个主题，包含 name、count（出现次数）、entryIds（来自输入里的 id）。",
        "- highlights：2-4 个值得记住的片段，text + entryIds。",
        "- suggestions：1-3 条「明日可延续」的线索，text + basisEntryIds。",
        "- keywords：不超过 8 个关键词。",
        input.moodEnabled ? "- energy：{label, confidence} 描述当天状态（推测而非诊断）。" : "- 不要输出 energy 字段。",
        "只输出 JSON。所有结论必须能追溯到给定的 entryIds，不得编造。",
      ].join("\n"),
    },
    { role: "user", content: `日期：${input.date}\n\n当日记录：\n${body || "（当天没有记录）"}` },
  ];
}

export function weeklyMessages(input: {
  startDate: string;
  endDate: string;
  entries: ReviewEntryInput[];
  dailyDigests?: string[];
}): AiMessage[] {
  const body = input.entries
    .map((e, i) => `[${i + 1}] id=${e.id} ${e.entryDate} ${e.time}\n${e.content}`)
    .join("\n\n");
  const digests = input.dailyDigests?.length ? `\n\n各日摘要：\n${input.dailyDigests.join("\n")}` : "";

  return [
    {
      role: "system",
      content: [
        "你是日记复盘助手，负责一周复盘。输出结构化 JSON。",
        "结构要求：",
        "- summary：一周概览 4-6 句。",
        "- themes：本周主题，name + count + entryIds。",
        "- distribution：投入分布，name + count（如工作/学习/关系/休息）。",
        "- highlights：3-5 个亮点，text + entryIds。",
        "- openThreads：未完成线索，text + basisEntryIds。",
        "只输出 JSON，结论必须可追溯到 entryIds。",
      ].join("\n"),
    },
    { role: "user", content: `周期：${input.startDate} ~ ${input.endDate}\n\n本周记录：\n${body || "（本周没有记录）"}${digests}` },
  ];
}

/** 月复盘第一层：把一周/数天压成小块摘要（Map） */
export function monthlyMapMessages(chunk: ReviewEntryInput[]): AiMessage[] {
  const body = chunk.map((e) => `[${e.id}] ${e.entryDate} ${e.time}\n${e.content}`).join("\n\n");
  return [
    {
      role: "system",
      content: "把下面这批日记压缩成 200 字以内的中文摘要，保留具体事件、人名与关键情绪，并列出涉及的条目 id。只输出 JSON：{digest: string, entryIds: string[]}。",
    },
    { role: "user", content: body },
  ];
}

/** 月复盘第二层：汇总所有小块摘要（Reduce） */
export function monthlyReduceMessages(input: { yearMonth: string; digests: string[] }): AiMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是日记复盘助手，负责月度复盘。基于若干分段摘要输出结构化 JSON：",
        "- summary：月度主线 5-8 句。",
        "- themes：name + count + entryIds。",
        "- trajectory：变化趋势，2-4 条，每条 text。",
        "- milestones：重要节点，text + entryIds。",
        "- nextMonth：下月可延续事项，text + basisEntryIds。",
        "只输出 JSON。",
      ].join("\n"),
    },
    { role: "user", content: `月份：${input.yearMonth}\n\n分段摘要：\n${input.digests.join("\n\n")}` },
  ];
}
