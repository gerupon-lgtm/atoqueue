import { NavLink, Outlet } from "react-router-dom";
import "./AppShell.css";

type NavigationItem = {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
};

const navigation: NavigationItem[] = [
  { to: "/", label: "記録", icon: "✎", end: true },
  { to: "/inbox", label: "受信箱", icon: "▣" },
  { to: "/today", label: "今日", icon: "☀" },
  { to: "/tasks", label: "タスク", icon: "✓" },
  { to: "/settings", label: "設定", icon: "⚙" },
];

export function AppShell() {
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
              {icon}
            </span>
            <span className="app-shell__nav-label">{label}</span>
          </NavLink>
        ))}
      </nav>
      <main className="app-shell__content">
        <Outlet />
      </main>
    </div>
  );
}
