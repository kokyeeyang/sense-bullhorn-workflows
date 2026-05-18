const {
  buildCandidateCurrentNpsPatch,
  parseNpsScore,
} = require("../src/workflows/soHowDidWeDoFeedbackResponseHandler");

describe("soHowDidWeDoFeedbackResponseHandler", () => {
  test("parses valid NPS scores from 1 to 10", () => {
    expect(parseNpsScore("1")).toBe(1);
    expect(parseNpsScore("10")).toBe(10);
    expect(parseNpsScore(" 8 ")).toBe(8);
  });

  test("rejects invalid NPS scores", () => {
    expect(parseNpsScore("0")).toBeNull();
    expect(parseNpsScore("11")).toBeNull();
    expect(parseNpsScore("8.5")).toBeNull();
    expect(parseNpsScore("yes")).toBeNull();
    expect(parseNpsScore("")).toBeNull();
  });

  test("builds Bullhorn Current NPS candidate patch", () => {
    expect(buildCandidateCurrentNpsPatch("9")).toEqual({ customFloat1: 9 });
    expect(buildCandidateCurrentNpsPatch("bad")).toBeNull();
  });
});
