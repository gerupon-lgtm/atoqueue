import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  createLocalCalendar,
  listTasks,
  type AppRepository,
} from "../../../../packages/domain/src";
import type {
  InstallExperience,
  InstallPromptPreference,
} from "../application/install-experience";
import { InstallPrompt } from "../features/install/InstallPrompt";
import "./AppShell.css";

type NavigationItem = {
  to: string;
  label: string;
  icon: "capture" | "inbox" | "today" | "tasks" | "settings";
  end?: boolean;
};

const navigation: NavigationItem[] = [
  { to: "/", label: "記録", icon: "capture", end: true },
  { to: "/inbox", label: "受信箱", icon: "inbox" },
  { to: "/today", label: "今日", icon: "today" },
  { to: "/tasks", label: "タスク", icon: "tasks" },
  { to: "/settings", label: "設定", icon: "settings" },
];

export interface AppShellProps {
  installExperience?: InstallExperience;
  installPromptPreference?: InstallPromptPreference;
  repository?: AppRepository;
  now?: () => string;
}

export function AppShell({
  installExperience,
  installPromptPreference,
  repository,
  now = () => new Date().toISOString(),
}: AppShellProps) {
  const location = useLocation();
  const [overdueCount, setOverdueCount] = useState(0);

  useEffect(() => {
    let current = true;
    if (!repository) return;
    void repository.load().then((snapshot) => {
      if (!current) return;
      const timestamp = now();
      setOverdueCount(
        listTasks(
          snapshot.tasks,
          {
            tab: "active",
            due: "overdue",
            now: timestamp,
            calendar: createLocalCalendar(snapshot.settings.timeZone),
          },
          snapshot.captures,
        ).length,
      );
    });
    return () => {
      current = false;
    };
  }, [location.key, now, repository]);

  return (
    <div className="app-shell">
      <nav className="app-shell__navigation" aria-label="主要ナビゲーション">
        {navigation.map(({ to, label, icon, end }) => (
          <NavLink
            aria-label={label}
            className="app-shell__nav-link"
            end={end}
            key={to}
            to={to}
          >
            <span aria-hidden="true" className="app-shell__nav-icon">
              <NavigationIcon name={icon} />
            </span>
            <span className="app-shell__nav-label">{label}</span>
            {to === "/tasks" && overdueCount > 0 ? (
              <span
                aria-label={`期限超過のタスク: ${overdueCount}件`}
                className="app-shell__nav-badge"
              >
                {overdueCount}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>
      <main className="app-shell__content">
        <p className="app-shell__wordmark">あとキュー</p>
        <Outlet />
      </main>
      {installExperience && installPromptPreference ? (
        <InstallPrompt
          experience={installExperience}
          preference={installPromptPreference}
        />
      ) : null}
    </div>
  );
}

function NavigationIcon({ name }: { name: NavigationItem["icon"] }) {
  const paths = {
    capture: (
      <>
        <path d="M5 19.5H3.75A1.75 1.75 0 0 1 2 17.75V5.25A1.75 1.75 0 0 1 3.75 3.5h12.5A1.75 1.75 0 0 1 18 5.25V10" />
        <path d="m12 16 6.25-6.25 2 2L14 18l-3 1 1-3Z" />
      </>
    ),
    inbox: (
      <>
        <path d="M3 5.5h18v12H3z" />
        <path d="M3 14h5l1.5 2h5L16 14h5" />
      </>
    ),
    today: (
      <>
        <circle cx="12" cy="12" r="3.25" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
      </>
    ),
    tasks: (
      <>
        <path d="M5 6.5h3M10 6.5h9M5 12h3M10 12h9M5 17.5h3M10 17.5h9" />
        <path d="m5.25 6.5 1 1 1.75-2" />
        <path d="m5.25 12 1 1L8 11" />
        <path d="m5.25 17.5 1 1 1.75-2" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="2.75" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.3 2.3-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51v.1h-3.22v-.1a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06-2.3-2.3.06-.06A1.65 1.65 0 0 0 6.6 15a1.65 1.65 0 0 0-1.51-1H5v-3.22h.1a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.3-2.3.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V4.4h3.22v.1a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06 2.3 2.3-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1h.1V14h-.1a1.65 1.65 0 0 0-1.51 1Z" />
      </>
    ),
  }[name];

  return (
    <svg
      data-icon={name}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
    >
      {paths}
    </svg>
  );
}
