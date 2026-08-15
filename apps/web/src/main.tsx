import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { NotificationApi } from "./infrastructure/notifications/notification-api";
import {
  backfillOverdueTaskNotifications,
  installOutboxFlush,
} from "./infrastructure/notifications/outbox-bootstrap";
import { flushOutbox } from "./infrastructure/notifications/outbox-sync";
import { LocalStorageRepository } from "./infrastructure/local-storage/local-storage-repository";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

const notificationRepository = new LocalStorageRepository(window.localStorage);
installOutboxFlush(window, async () => {
  await backfillOverdueTaskNotifications({ repository: notificationRepository });
  await flushOutbox({ repository: notificationRepository, api: new NotificationApi("https://api.atoqueue.sikumilab.com") });
});
