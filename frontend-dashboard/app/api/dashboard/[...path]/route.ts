import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function getWorkflowApiBaseUrl() {
  const value = process.env.WORKFLOW_API_BASE_URL || "http://localhost:7071/api";
  return value.replace(/\/+$/, "");
}

function buildTargetUrl(request: NextRequest, path: string[]) {
  const target = new URL(`${getWorkflowApiBaseUrl()}/dashboard/${path.join("/")}`);
  const source = new URL(request.url);

  source.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });

  if (process.env.WORKFLOW_API_CODE && !target.searchParams.has("code")) {
    target.searchParams.set("code", process.env.WORKFLOW_API_CODE);
  }

  return target;
}

async function proxyDashboardRequest(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const targetUrl = buildTargetUrl(request, path);
  const headers = new Headers();

  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      cache: "no-store",
    });
    const body = await response.text();
    const responseHeaders = new Headers();
    const contentType = response.headers.get("content-type");

    if (contentType) {
      responseHeaders.set("content-type", contentType);
    }

    return new NextResponse(body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          message: error instanceof Error ? error.message : "Dashboard API proxy failed",
        },
      },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyDashboardRequest(request, context);
}
