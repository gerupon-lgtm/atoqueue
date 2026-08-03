import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "./AppShell";

type PageDefinition = {
  index?: true;
  path?: string;
  label: string;
};

const pages: PageDefinition[] = [
  { index: true, label: "險倬鹸" },
  { path: "inbox", label: "蜿嶺ｿ｡邂ｱ" },
  { path: "today", label: "莉頑律" },
  { path: "tasks", label: "繧ｿ繧ｹ繧ｯ" },
  { path: "settings", label: "險ｭ螳啻" },
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
