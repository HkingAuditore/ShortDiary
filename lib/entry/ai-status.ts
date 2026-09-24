/**
 * AI 附注的状态判定 —— 前后端共用，别再各写各的字符串字面量。
 *
 * 流转：pending（写入时默认）→ running（worker 领走，开始生成）→ completed | failed
 * 另有 queued（手动重跑先落 queued，等 worker 领）、skipped（用户关了自动整理）。
 *
 * 只有 pending 曾经被界面认作「生成中」：worker 一领任务就把状态改成 running，
 * 提示条随之消失，用户对着静止的卡片以为程序卡死 —— 生成一条要 5–30 秒。
 * 所以判「还在流水线上」必须把这三个都算进来。
 */
export const AI_PENDING_STATUSES = ["pending", "queued", "running"] as const;

export type AiPendingStatus = (typeof AI_PENDING_STATUSES)[number];

export function isAiPending(status: string | null | undefined): boolean {
  return status != null && (AI_PENDING_STATUSES as readonly string[]).includes(status);
}

/** 生成失败：值得给一个「再试一次」的出口，而不是静悄悄什么都不显示 */
export function isAiFailed(status: string | null | undefined): boolean {
  return status === "failed";
}
