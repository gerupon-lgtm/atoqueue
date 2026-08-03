import type { DueChoice } from "./due-date";
import type { Task } from "./model";

export interface TaskCandidateSuggestion {
  title: string;
  dueChoice?: Extract<DueChoice, { type: "today" | "tomorrow" | "this_sunday" }>;
  category?: NonNullable<Task["category"]>;
}

/**
 * A deliberately small, local-only rule set. It supports only the exact
 * Japanese date expressions below; calendar dates remain a user choice.
 */
export function generateTaskCandidate(body: string): TaskCandidateSuggestion {
  const dueChoice = dueChoiceFromBody(body);
  const title = stripDateExpression(body).trim() || body.trim();

  return {
    title,
    ...(dueChoice ? { dueChoice } : {}),
    ...(categoryFromBody(body) ? { category: categoryFromBody(body) } : {}),
  };
}

function dueChoiceFromBody(
  body: string,
): TaskCandidateSuggestion["dueChoice"] {
  if (body.includes("今週中")) return { type: "this_sunday" };
  if (body.includes("明日")) return { type: "tomorrow" };
  if (body.includes("今日")) return { type: "today" };
  return undefined;
}

function stripDateExpression(body: string): string {
  return body
    .replace(/今週中(?:に)?|明日(?:に)?|今日(?:に)?/gu, "")
    .replace(/^[\s、,，:：-]+|[\s、,，:：-]+$/gu, "");
}

function categoryFromBody(body: string): NonNullable<Task["category"]> | undefined {
  if (/(?:買う|購入|スーパー|牛乳|買い物)/u.test(body)) return "shopping";
  if (/(?:会議|資料|提出|仕事|連絡)/u.test(body)) return "work";
  return undefined;
}
