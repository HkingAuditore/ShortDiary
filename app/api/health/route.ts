import { defineRoute } from "@/lib/api/route";

export const dynamic = "force-dynamic";

export const GET = defineRoute(async () => ({
  data: { status: "ok", uptimeSec: Math.round(process.uptime()) },
}));
