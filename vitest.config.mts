import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Vite 8 原生解析 tsconfig 的 paths（@/* → 项目根）
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // E2E 用例（Playwright）与构建产物不参与单元测试
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.cache/**",
      "**/dist/**",
      "**/e2e/**",
    ],
  },
});
