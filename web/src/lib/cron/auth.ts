import { NextResponse } from "next/server";

/**
 * Accept both Vercel Cron (`Authorization: Bearer <CRON_SECRET>`) and the
 * existing manual/external scheduler convention (`x-cron-secret`).
 */
export function requireCronAuth(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  const headerSecret = req.headers.get("x-cron-secret");
  if (authHeader === `Bearer ${secret}` || headerSecret === secret) {
    return null;
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}