import {
  createBrowserRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { LocalStorageRepository } from "../infrastructure/local-storage/local-storage-repository";
import { createNotificationSyncService } from "../application/notification-sync-service";
import { resetDeviceData } from "../application/device-data-reset-service";
import { NotificationApi } from "../infrastructure/notifications/notification-api";
import {
  createBrowserPushAdapter,
  enableNotifications,
  unsubscribeBrowserPush,
} from "../infrastructure/notifications/push-subscription";
import { QuickCapturePage } from "../features/capture/QuickCapturePage";
import { InboxPage } from "../features/inbox/InboxPage";
import { TaskCandidatePage } from "../features/inbox/TaskCandidatePage";
import { TodayReviewPage } from "../features/review/TodayReviewPage";
import { ReviewResultPage } from "../features/review/ReviewResultPage";
import { TaskDetailPage } from "../features/tasks/TaskDetailPage";
import { TaskListPage } from "../features/tasks/TaskListPage";
import { AppShell } from "./AppShell";
import { SettingsPage } from "../features/settings/SettingsPage";

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
const notificationApi = new NotificationApi(
  "https://api.atoqueue.sikumilab.com",
);
const notificationSync = createNotificationSyncService({
  repository: applicationRepository,
  api: notificationApi,
});
const setupNotifications = () =>
  enableNotifications({
    repository: applicationRepository,
    api: notificationApi,
    browser: createBrowserPushAdapter(),
  });

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell repository={applicationRepository} />,
    children: [
      ...pages.map((page) => ({
        ...(page.index ? { index: true } : { path: page.path }),
        element: page.index ? (
          <QuickCapturePage
            onNotificationChanged={() => notificationSync.flush()}
            repository={applicationRepository}
            setupNotifications={setupNotifications}
          />
        ) : page.path === "inbox" ? (
          <InboxRoute />
        ) : page.path === "today" ? (
          <TodayReviewRoute />
        ) : page.path === "tasks" ? (
          <TaskListPage repository={applicationRepository} />
        ) : page.path === "settings" ? (
          <SettingsPage
            deleteDeviceData={async () => {
              await resetDeviceData({
                repository: applicationRepository,
                api: notificationApi,
                unsubscribeBrowserPush,
              });
              window.location.assign("/");
            }}
            flushNotifications={() => notificationSync.flush()}
            repository={applicationRepository}
            setupNotifications={setupNotifications}
          />
        ) : (
          <Page title={page.label} />
        ),
      })),
      { path: "inbox/:captureId", element: <TaskCandidateRoute /> },
      {
        path: "today/result",
        element: <ReviewResultPage repository={applicationRepository} />,
      },
      { path: "tasks/:taskId", element: <TaskCorrectionRoute /> },
    ],
  },
]);

function Page({ title }: { title: string }) {
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title">{title}</h1>
    </section>
  );
}

function InboxRoute() {
  const navigate = useNavigate();
  return (
    <InboxPage
      onTaskCandidate={(captureId) => navigate(`/inbox/${captureId}`)}
      repository={applicationRepository}
    />
  );
}

function TaskCandidateRoute() {
  const navigate = useNavigate();
  const { captureId } = useParams();

  if (!captureId) return <Page title="受信箱" />;
  return (
    <TaskCandidatePage
      captureId={captureId}
      onReturn={() => navigate("/inbox")}
      onNotificationChanged={() => notificationSync.flush()}
      repository={applicationRepository}
    />
  );
}

function TodayReviewRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <TodayReviewPage
      onFinished={() => navigate("/today/result")}
      preferredReminderId={
        new URLSearchParams(location.search).get("reminder") ?? undefined
      }
      repository={applicationRepository}
      sync={() => notificationSync.flush()}
    />
  );
}

function TaskCorrectionRoute() {
  const navigate = useNavigate();
  const { taskId } = useParams();
  if (!taskId) return <Page title="タスク" />;
  return (
    <TaskDetailPage
      onReturn={() => navigate("/tasks")}
      repository={applicationRepository}
      sync={() => notificationSync.flush()}
      taskId={taskId}
    />
  );
}
