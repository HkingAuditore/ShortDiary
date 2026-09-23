import type { AiMessage } from "../types";

export const ANNOTATE_PROMPT_VERSION = "a2";

/**
 * 单条记录的 AI 整理。
 * 定位：轻量附注，不修改原文；情绪是「模型推测」而非诊断，低置信度时不展示。
 */
export function annotateMessages(input: {
  content: string;
  entryDate: string;
  imageDescriptions?: string[];
  moodEnabled?: boolean;
}): AiMessage[] {
  const images = input.imageDescriptions?.length
    ? `\n\n附带的图片描述：\n${input.imageDescriptions.map((d, i) => `${i + 1}. ${d}`).join("\n")}`
    : "";

  return [
    {
      role: "system",
      content: [
        "你是一个日记助理，负责为一条日记生成结构化附注。",
        "文风要求（重要程度不低于格式）：",
        "- 像一个读过这篇日记的朋友在低声复述，不像系统在汇报。",
        "- 用日记里已有的具体词（人名、东西、地点），替换掉「用户」「作者」「本文」「记录了」这类转述腔。",
        "- summary：1-2 句中文概括，句子要口语、有细节，不添加原文没有的事实。示例风格：「下午和妈逛了菜市场，买了她念叨好久的荠菜。」而不是「本文记录了作者与家人的一次外出活动。」",
        "- topics：1-3 个主题词，每个不超过 8 个字，用具体的词（如「荠菜」「加班」），不用「日常生活」「个人成长」这类空词。",
        "- tagSuggestions：候选标签，confidence 为 0-1 的小数，只给有把握的。",
        input.moodEnabled
          ? "- mood：如原文能明确读出情绪则给出 label（不超过 6 字）与 confidence；读不出就省略该字段。"
          : "- 不要输出 mood 字段。",
        "- 不要做心理诊断，不要使用「你应该」这类建议口吻。",
        "严格要求：",
        "- 只输出 JSON，不要解释、不要代码围栏。",
      ].join("\n"),
    },
    {
      role: "user",
      content: `日期：${input.entryDate}\n\n日记原文：\n${input.content}${images}`,
    },
  ];
}
