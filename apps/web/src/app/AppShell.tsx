import { NavLink, Outlet } from "react-router-dom";
import "./AppShell.css";

type NavigationItem = {
  to: string;
  label: string;
  end?: boolean;
};

const navigation: NavigationItem[] = [
  { to: "/", label: "險倬鹸", end: true },
  { to: "/inbox", label: "蜿嶺ｿ｡邂ｱ" },
  { to: "/today", label: "莉頑律" },
  { to: "/tasks", label: "繧ｿ繧ｹ繧ｯ" },
  { to: "/settings", label: "險ｭ螳啻" },
];

export function AppShell() {
  return (
    <div className="app-shell">
      <nav className="app-shell__navigation" aria-label="主要ナビゲーション">
        {navigation.map(({ to, label, end }) => (
          <NavLink
            className="app-shell__nav-link"
            end={end}
            key={to}
            to={to}
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <main className="app-shell__content">
        <Outlet />
      </main>
    </div>
  );
}
