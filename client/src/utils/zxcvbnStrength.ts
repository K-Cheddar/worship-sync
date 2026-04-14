import type { PasswordStrengthLevel } from "./passwordRequirements";

const zxcvbnScoreToLevel = (score: number): PasswordStrengthLevel => {
  if (score <= 0) {
    return "weak";
  }
  if (score === 1) {
    return "fair";
  }
  if (score === 2) {
    return "good";
  }
  return "strong";
};

export type ZxcvbnStrengthDisplay = {
  level: PasswordStrengthLevel;
  /** zxcvbn guessability score, 0 (weak) through 4 (strong). */
  score: number;
  /** 0–100 for the strength bar. */
  barPercent: number;
  feedbackWarning: string;
  feedbackSuggestions: string[];
};

type ZxcvbnFeedback = {
  warning?: string;
  suggestions?: string[];
};

/** Maps a `zxcvbn()` result to UI fields (library loaded separately / async). */
export const mapZxcvbnResultToDisplay = (result: {
  score: number;
  feedback: ZxcvbnFeedback;
}): ZxcvbnStrengthDisplay => {
  const score = result.score;
  return {
    level: zxcvbnScoreToLevel(score),
    score,
    barPercent: Math.round((score / 4) * 100),
    feedbackWarning: result.feedback.warning || "",
    feedbackSuggestions: result.feedback.suggestions ?? [],
  };
};

export const emptyZxcvbnStrengthDisplay = (): ZxcvbnStrengthDisplay => ({
  level: "weak",
  score: 0,
  barPercent: 0,
  feedbackWarning: "",
  feedbackSuggestions: [],
});
