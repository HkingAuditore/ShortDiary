import type { NextRequest } from "next/server";
import { z } from "zod";
import { defineRoute } from "@/lib/api/route";
import { serviceContext } from "@/lib/api/context";
import { issueUploadTicket, driverName } from "@/lib/storage";
import { ALLOWED_IMAGE_MIMES } from "@/lib/storage/key-convention";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  mimes: z.array(z.string()).min(1).max(9),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * 签发上传凭证。应用服务器只做签名，不做字节中转 —— 图片直传对象存储，
 * 服务端内存保持恒定（单图 5MB × 9 张也不产生尖峰）。
 */
export const POST = defineRoute(
  async (req: NextRequest) => {
    const ctx = await serviceContext();
    const body = bodySchema.parse(await req.json());

    const tickets = [];
    for (const mime of body.mimes) {
      if (!ALLOWED_IMAGE_MIMES.has(mime)) continue;
      tickets.push(await issueUploadTicket({ userId: ctx.userId, mime, entryDate: body.entryDate }));
    }

    if (tickets.length === 0) {
      return { data: { driver: driverName(), tickets: [] }, status: 400 };
    }

    return { data: { driver: driverName(), tickets } };
  },
  { rateLimit: { limit: 60 } },
);
