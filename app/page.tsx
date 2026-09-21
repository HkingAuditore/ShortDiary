import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/** 根路径：登录了进时间线，没登录去登录页（避免访问 / 时 404） */
export default async function RootPage() {
  const user = await getSessionUser();
  redirect(user ? "/timeline" : "/login");
}
