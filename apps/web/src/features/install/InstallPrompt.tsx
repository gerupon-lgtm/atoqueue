import { useEffect, useState } from "react";
import type {
  InstallExperience,
  InstallPromptPreference,
} from "../../application/install-experience";
import "./InstallPrompt.css";

export type {
  InstallExperience,
  InstallPromptPreference,
} from "../../application/install-experience";

export interface InstallPromptProps {
  experience: InstallExperience;
  preference: InstallPromptPreference;
}

export function InstallPrompt({ experience, preference }: InstallPromptProps) {
  const [state, setState] = useState(() => experience.getState());
  const [isOpen, setIsOpen] = useState(
    () =>
      !preference.hasSeen() &&
      ["ios", "installable"].includes(experience.getState()),
  );

  useEffect(
    () =>
      experience.subscribe(() => {
        const nextState = experience.getState();
        setState(nextState);
        if (!preference.hasSeen() && nextState === "installable") {
          setIsOpen(true);
        }
      }),
    [experience, preference],
  );

  if (!isOpen || !["ios", "installable"].includes(state)) return null;

  const close = () => {
    preference.markSeen();
    setIsOpen(false);
  };

  const install = async () => {
    await experience.install();
    close();
  };

  const isIos = state === "ios";
  const title = isIos
    ? "あとキューをホーム画面に追加"
    : "あとキューをインストール";

  return (
    <div
      aria-labelledby="install-prompt-title"
      aria-modal="true"
      className="install-prompt"
      role="dialog"
    >
      <div className="install-prompt__card">
        <p className="install-prompt__eyebrow">あとキュー</p>
        <h2 id="install-prompt-title">{title}</h2>
        {isIos ? (
          <p>
            iPhone・iPadではSafariで共有を開き、「ホーム画面に追加」を選んでください。
          </p>
        ) : (
          <p>
            ホーム画面やアプリ一覧から、あとキューをすぐ開けるようにします。
          </p>
        )}
        <p className="install-prompt__note">
          ホーム画面から開くと、アプリとして使いやすくなります。
        </p>
        <div className="install-prompt__actions">
          {isIos ? (
            <button autoFocus onClick={close} type="button">
              わかりました
            </button>
          ) : (
            <>
              <button
                className="install-prompt__secondary"
                onClick={close}
                type="button"
              >
                今はしない
              </button>
              <button autoFocus onClick={() => void install()} type="button">
                インストール
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
