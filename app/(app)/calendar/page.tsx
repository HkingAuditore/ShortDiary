import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";
import { serviceContext } from "@/lib/api/context";
import { CalendarBoard } from "@/components/calendar/CalendarBoard";
import { today } from "@/lib/utils/date";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const ctx = await serviceContext();
  const [y, m] = today(ctx.timezone).split("-").map(Number) as [number, number];

  return <CalendarBoard initialYear={y} initialMonth={m} timezone={ctx.timezone} />;
}
