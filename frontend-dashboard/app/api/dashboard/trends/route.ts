import { NextRequest } from "next/server";
import { proxyDashboardPath } from "@/lib/server/dashboardProxy";

export async function GET(request: NextRequest) {
  return proxyDashboardPath(request, ["trends"]);
}
