import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { getEmailTemplateUsageByFileName } from "@/lib/emailTemplateUsage";

function titleFromFileName(fileName: string) {
  return fileName
    .replace(/\.html$/i, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferRegion(fileName: string) {
  if (/apac|perth|singapore|kuala/i.test(fileName)) return "APAC";
  if (/emea|germany|london|awr|fair-collection|perm/i.test(fileName)) return "EMEA";
  if (/americas|illinois|california|colorado|georgia|maryland|jersey|alabama|harassment|us-|new-york/i.test(fileName)) {
    return "Americas";
  }
  return "Region agnostic";
}

function inferCategory(fileName: string) {
  if (/termination/i.test(fileName)) return "Termination";
  if (/harassment/i.test(fileName)) return "Compliance";
  if (/survey|feedback|checkin|approval/i.test(fileName)) return "Survey";
  if (/benefits|payroll|onboarding|welcome/i.test(fileName)) return "Onboarding";
  return "Email";
}

function findSparkPostTemplateKey(html: string) {
  const match = html.match(/SparkPost template:\s*([A-Z0-9_]+)/i);
  return match?.[1] || null;
}

async function directoryExists(directory: string) {
  try {
    const stat = await fs.stat(directory);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function resolveTemplateDir() {
  const candidates = [
    path.resolve(process.cwd(), "public", "email-templates"),
    path.resolve(process.cwd(), "..", "templates"),
    path.resolve(process.cwd(), "templates"),
  ];

  for (const candidate of candidates) {
    if (await directoryExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Email template directory was not found. Checked: ${candidates.join(", ")}`);
}

export async function GET() {
  try {
    const templateDir = await resolveTemplateDir();
    const usageByFileName = getEmailTemplateUsageByFileName();
    const entries = await fs.readdir(templateDir, { withFileTypes: true });
    const htmlFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    const templates = await Promise.all(
      htmlFiles.map(async (fileName) => {
        const filePath = path.join(templateDir, fileName);
        const [stat, html] = await Promise.all([fs.stat(filePath), fs.readFile(filePath, "utf8")]);

        return {
          fileName,
          name: titleFromFileName(fileName),
          category: inferCategory(fileName),
          region: inferRegion(fileName),
          sparkPostTemplateKey: findSparkPostTemplateKey(html),
          usedBy: usageByFileName[fileName] || [],
          sizeBytes: stat.size,
          html,
        };
      }),
    );

    return NextResponse.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        count: templates.length,
        templates,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          message: error instanceof Error ? error.message : "Email templates failed to load",
        },
      },
      { status: 500 },
    );
  }
}
