import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "domain",
      root: "./packages/domain",
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "api",
      root: "./apps/api",
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "web",
      root: "./apps/web",
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
    },
  },
]);
