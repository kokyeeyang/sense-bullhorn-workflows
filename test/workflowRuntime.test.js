const path = require("node:path");

const { buildJsonArtifactPath } = require("../src/utils/workflowRuntime");

test("builds JSON artifact paths inside date-based report folders", () => {
  const { reportsDir, dateFolder, artifactPath } = buildJsonArtifactPath({
    filePrefix: "example-report",
    generatedAt: new Date("2026-05-13T04:48:36.525Z"),
  });

  expect(dateFolder).toBe("2026-05-13");
  expect(reportsDir).toBe(path.resolve(process.cwd(), "reports", "2026-05-13"));
  expect(artifactPath).toBe(
    path.resolve(
      process.cwd(),
      "reports",
      "2026-05-13",
      "example-report-2026-05-13T04-48-36-525Z.json",
    ),
  );
});
