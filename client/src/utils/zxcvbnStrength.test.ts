import {
  mapZxcvbnResultToDisplay,
  emptyZxcvbnStrengthDisplay,
} from "./zxcvbnStrength";

describe("mapZxcvbnResultToDisplay", () => {
  it("maps score 0 to weak level with 0% bar", () => {
    const result = mapZxcvbnResultToDisplay({ score: 0, feedback: {} });
    expect(result.level).toBe("weak");
    expect(result.score).toBe(0);
    expect(result.barPercent).toBe(0);
  });

  it("maps score 1 to fair level with 25% bar", () => {
    const result = mapZxcvbnResultToDisplay({ score: 1, feedback: {} });
    expect(result.level).toBe("fair");
    expect(result.barPercent).toBe(25);
  });

  it("maps score 2 to good level with 50% bar", () => {
    const result = mapZxcvbnResultToDisplay({ score: 2, feedback: {} });
    expect(result.level).toBe("good");
    expect(result.barPercent).toBe(50);
  });

  it("maps score 3 to strong level with 75% bar", () => {
    const result = mapZxcvbnResultToDisplay({ score: 3, feedback: {} });
    expect(result.level).toBe("strong");
    expect(result.barPercent).toBe(75);
  });

  it("maps score 4 to strong level with 100% bar", () => {
    const result = mapZxcvbnResultToDisplay({ score: 4, feedback: {} });
    expect(result.level).toBe("strong");
    expect(result.barPercent).toBe(100);
  });

  it("includes feedback warning when provided", () => {
    const result = mapZxcvbnResultToDisplay({
      score: 1,
      feedback: { warning: "Too short" },
    });
    expect(result.feedbackWarning).toBe("Too short");
  });

  it("includes feedback suggestions when provided", () => {
    const result = mapZxcvbnResultToDisplay({
      score: 1,
      feedback: { suggestions: ["Add more characters", "Use symbols"] },
    });
    expect(result.feedbackSuggestions).toEqual([
      "Add more characters",
      "Use symbols",
    ]);
  });

  it("defaults warning to empty string when not in feedback", () => {
    const result = mapZxcvbnResultToDisplay({ score: 2, feedback: {} });
    expect(result.feedbackWarning).toBe("");
  });

  it("defaults suggestions to empty array when not in feedback", () => {
    const result = mapZxcvbnResultToDisplay({ score: 2, feedback: {} });
    expect(result.feedbackSuggestions).toEqual([]);
  });
});

describe("emptyZxcvbnStrengthDisplay", () => {
  it("returns a weak display with zero values and empty feedback", () => {
    const result = emptyZxcvbnStrengthDisplay();
    expect(result.level).toBe("weak");
    expect(result.score).toBe(0);
    expect(result.barPercent).toBe(0);
    expect(result.feedbackWarning).toBe("");
    expect(result.feedbackSuggestions).toEqual([]);
  });
});
