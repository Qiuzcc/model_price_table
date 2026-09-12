import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom 未实现滚动相关 API，组件（虚拟滚动容器等）调用时补桩（node 环境无 Element）
if (typeof Element !== "undefined") {
  Element.prototype.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
}

// 非 globals 模式下 React Testing Library 不会自动清理 DOM，需显式注册
afterEach(() => {
  cleanup();
});
