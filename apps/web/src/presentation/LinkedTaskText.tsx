import type { MouseEvent } from "react";
import "./LinkedTaskText.css";

interface WebUrl {
  start: number;
  end: number;
  value: string;
}

const closingToOpening: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
  "）": "（",
  "］": "［",
  "｝": "｛",
  "〕": "〔",
  "〉": "〈",
  "》": "《",
};
const trailingPunctuation = new Set(".,!?;:。、！？；：…");

function trimUrlEnd(value: string): string {
  const counts = new Map<string, number>();
  for (const character of value)
    counts.set(character, (counts.get(character) ?? 0) + 1);
  let end = value.length;
  while (end > 0) {
    const last = value[end - 1]!;
    const opening = closingToOpening[last];
    if (
      !trailingPunctuation.has(last) &&
      !(opening && (counts.get(last) ?? 0) > (counts.get(opening) ?? 0))
    )
      break;
    counts.set(last, (counts.get(last) ?? 0) - 1);
    end--;
  }
  return value.slice(0, end);
}

function findWebUrls(text: string): WebUrl[] {
  const urls: WebUrl[] = [];
  for (const match of text.matchAll(
    /https?:\/\/[^\s<>"'`「」『』【】。、！？；：]+/giu,
  )) {
    const value = trimUrlEnd(match[0]);
    if (/^https?:\/\/[\\/]/iu.test(value) || value.includes("\\")) continue;
    try {
      const parsed = new URL(value);
      if (
        (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
        !parsed.hostname ||
        parsed.username ||
        parsed.password
      )
        continue;
      urls.push({ start: match.index, end: match.index + value.length, value });
    } catch {
      // Leave malformed destinations visible as ordinary task text.
    }
  }
  return urls;
}

export function containsWebUrl(text: string): boolean {
  return findWebUrls(text).length > 0;
}

function confirmNavigation(event: MouseEvent<HTMLAnchorElement>, url: string) {
  if (event.button !== 0 && event.button !== 1) return;
  if (!window.confirm(`次のURLをブラウザで開きますか？\n${url}`))
    event.preventDefault();
}

export function LinkedTaskText({ text }: { text: string }) {
  const urls = findWebUrls(text);
  let end = 0;
  return (
    <span className="linked-task-text">
      {urls.map((url) => {
        const preceding = text.slice(end, url.start);
        end = url.end;
        return (
          <span key={url.start}>
            {preceding}
            <a
              href={url.value}
              onAuxClick={(event) => confirmNavigation(event, url.value)}
              onClick={(event) => confirmNavigation(event, url.value)}
              rel="noopener noreferrer"
              target="_blank"
            >
              {url.value}
            </a>
          </span>
        );
      })}
      {text.slice(end)}
    </span>
  );
}
