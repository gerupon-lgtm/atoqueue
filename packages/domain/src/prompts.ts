import type { NeglectLevel } from "./model";

export interface PromptCopy {
  message: string;
}

// Level 3 is intentionally isolated here: it is a pilot-adjustable addition
// to the documented four-level wording while F-011 requires five levels.
const promptByLevel: Record<NeglectLevel, PromptCopy> = {
  0: { message: "これ、いつやるかだけ決めておきますか？" },
  1: { message: "次に動ける日を決めると、忘れずに済みそうです" },
  2: { message: "少し時間が経っています。今日やるか、日付を変えましょう" },
  3: { message: "このまま残すより、残すかどうかを決めましょう" },
  4: {
    message: "このまま残すより、完了・新しい期限・不要のどれかを決めましょう",
  },
};

export function choosePrompt(level: NeglectLevel): PromptCopy {
  return promptByLevel[level];
}
