import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "./AppShell";

type PageDefinition = {
  index?: true;
  path?: string;
  label: string;
};

const pages: PageDefinition[] = [
  { index: true, label: "記録" },
  { path: "inbox", label: "受信箱" },
  { path: "today", label: "今日" },
  { path: "tasks", label: "タスク" },
  { path: "settings", label: "設定" },
];

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: pages.map((page) => ({
      ...(page.index ? { index: true } : { path: page.path }),
      element: <Page title={page.label} />,
    })),
  },
]);

function Page({ title }: { title: string }) {
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title">{title}</h1>
    </section>
  );
}
