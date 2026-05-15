import { NextRequest } from "next/server";
import { proxyDashboardPath } from "@/lib/server/dashboardProxy";

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

async function proxyDashboardRequest(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyDashboardPath(request, path);
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyDashboardRequest(request, context);
}
