import type { AiMessage } from "../types";

/**
 * 复盘提示词。全部带版本号，写入 reviews.prompt_version，
 * 使「换模型 / 换模板重新生成」与「对比两版」成为可能。
 */

export const DAILY_PROMPT_VERSION = "d2";
export const WEEKLY_PROMPT_VERSION = "w2";
export const MONTHLY_PROMPT_VERSION = "m2";

export interface ReviewEntryInput {
  id: string;
  entryDate: string;
  time: string;
  content: string;
  /** 单条记录的 AI 附注（朋友反应） */
  reaction?: string;
  topics?: string[];
}

export function dailyMessages(input: {
  date: string;
  entries: ReviewEntryInput[];
  moodEnabled?: boolean;
}): AiMessage[] {
  const body = input.entries
    .map((e, i) => `[${i + 1}] id=${e.id} ${e.time}\n${e.content}${e.reaction ? `\n（当时的附注：${e.reaction}）` : ""}`)
    .join("\n\n");

  return [
    {
      role: "system",
      content: [
        "你是日记复盘助手。基于用户提供的一天记录，输出结构化 JSON。",
        "文风要求（与格式同等重要）：",
        "- 像一个陪你过了一天的老朋友在写便签，不像系统在生成报告。禁止「用户」「作者」「本文」「这一天，用户……」这类转述腔。",
        "- 忠实于原文的具体细节：用了日记里出现过的人名、食物、地点、原话片段，而不是把它们抽象成「一次社交活动」「工作事务」。",
        "- summary：3-5 句中文概览，口语一点，读起来像人写的。反例：「今天，作者围绕工作任务展开了多项活动。」正例：「上午连开三个会，中午只扒了两口饭；好在晚上跟小雨吃到了那家新开的酸汤锅。」",
        "- highlights：挑原文里最有画面感的片段，能引用原话就引用原话。",
        "- suggestions：1-3 条「明日可延续」的线索，落在具体的事上，不写「保持良好状态」这种空话。",
        "结构要求：",
        "- themes：2-5 个主题，包含 name、count（出现次数）、entryIds（来自输入里的 id）。",
        "- highlights：2-4 个值得记住的片段，text + entryIds。",
        "- suggestions：1-3 条，text + basisEntryIds。",
        "- keywords：不超过 8 个关键词，用具体名词。",
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
        "文风要求（与格式同等重要）：",
        "- 像一个陪了你一整周的朋友在写周记，不像系统在汇总数据。禁止「用户」「作者」「本文」这类转述腔。",
        "- 抓具体：人名、地点、吃的东西、反复出现的事，保留日记里的原话片段。不写「在本周中，用户进行了多项活动」。",
        "- summary：一周概览 4-6 句，口语、有画面、有起伏（哪天顺、哪天累），不像述职报告。",
        "- highlights：3-5 个亮点，挑最有画面感的原文片段，能引用原话就引用。",
        "- openThreads：未完成线索要落到具体的事（「说好要修的台灯还没动」），不写「有待完成事项」。",
        "- distribution：投入分布，name + count（如工作/学习/关系/休息），name 用具体类别。",
        "- themes：本周主题，name + count + entryIds。",
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
      content: "把下面这批日记压缩成 200 字以内的中文摘要。像朋友转述这一段日子：保留具体事件、人名、地点和关键情绪，用日记里出现过的具体词，禁止「用户」「作者」「本文」这类转述腔。只输出 JSON：{digest: string, entryIds: string[]}。",
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
        "文风要求（与格式同等重要）：",
        "- 像一个看了你整个月日记的老朋友在写信，不像系统在生成月报。禁止「用户」「作者」「本文」这类转述腔。",
        "- 把分段摘要里的具体事串起来：人名、地点、反复出现的事，写出这个月的起伏和变化。",
        "- summary：月度主线 5-8 句，口语、有画面，像人写的回忆，不像述职报告。",
        "- trajectory：变化趋势，2-4 条，每条 text，落在具体的事上（「月初还天天外卖，后半月开始自己做饭」），不写「状态有所提升」。",
        "- milestones：重要节点，text + entryIds。",
        "- nextMonth：下月可延续事项，text + basisEntryIds，落到具体的事。",
        "- themes：name + count + entryIds。",
        "只输出 JSON。",
      ].join("\n"),
    },
    { role: "user", content: `月份：${input.yearMonth}\n\n分段摘要：\n${input.digests.join("\n\n")}` },
  ];
}
