import { describe, expect, it } from "vitest";
import { choosePrompt } from "./index";

describe("choosePrompt", () => {
  it.each([
    [0, "これ、いつやるかだけ決めておきますか？"],
    [1, "次に動ける日を決めると、忘れずに済みそうです"],
    [2, "少し時間が経っています。今日やるか、日付を変えましょう"],
    [3, "このまま残すより、残すかどうかを決めましょう"],
    [4, "このまま残すより、完了・新しい期限・不要のどれかを決めましょう"],
  ] as const)(
    "F-011 provides the documented level %i copy",
    (level, message) => {
      expect(choosePrompt(level)).toEqual({ message });
    },
  );
});
