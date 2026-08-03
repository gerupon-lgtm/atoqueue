import { createBrowserRouter } from "react-router-dom";
import { LocalStorageRepository } from "../infrastructure/local-storage/local-storage-repository";
import { QuickCapturePage } from "../features/capture/QuickCapturePage";
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

const applicationRepository = new LocalStorageRepository(window.localStorage);

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: pages.map((page) => ({
      ...(page.index ? { index: true } : { path: page.path }),
      element: page.index ? (
        <QuickCapturePage repository={applicationRepository} />
      ) : (
        <Page title={page.label} />
      ),
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
