import { NextResponse } from "next/server";
import { applyClearedSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  return applyClearedSessionCookie(NextResponse.json({ result: "success" }));
}
