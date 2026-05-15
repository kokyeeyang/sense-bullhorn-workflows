import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    app: "frontend-dashboard",
    builtAt: process.env.NEXT_PUBLIC_BUILD_ID || "local",
  });
}
