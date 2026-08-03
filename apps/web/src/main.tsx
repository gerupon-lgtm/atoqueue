import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
  return <main>あとキュー</main>;
}

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
