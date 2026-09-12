import { expect, test } from "@playwright/test";
import { gotoApp, mockApis, selectModels } from "./fixtures";

test.describe("刷新与偏好持久化", () => {
  test("刷新按钮：携带 force 参数请求并提示刷新结果", async ({ page }) => {
    const api = await mockApis(page);
    await gotoApp(page);

    await page.getByRole("button", { name: "刷新数据" }).click();

    await expect(page.getByText("数据已刷新")).toBeVisible();
    expect(api.pricingUrls.some((url) => url.includes("force=1"))).toBe(true);
  });

  test("已选模型与列设置持久化：整页刷新后保留", async ({ page }) => {
    await mockApis(page);
    await gotoApp(page);

    await selectModels(page, ["Gamma Pro", "Delta Ultra"]);

    // 隐藏「上下文窗口」列
    await page.getByRole("button", { name: /列设置/ }).click();
    await page.getByRole("checkbox", { name: /上下文窗口/ }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("columnheader", { name: /上下文窗口/ })).toHaveCount(0);

    // 等待偏好写入 localStorage（useEffect 在渲染后异步执行）
    await expect
      .poll(() =>
        page.evaluate(() => window.localStorage.getItem("mpt:selected-sids")),
      )
      .toContain("gadget/gamma-pro");
    await expect
      .poll(() =>
        page.evaluate(() => window.localStorage.getItem("mpt:visible-columns")),
      )
      .not.toContain("contextWindow");

    // 整页刷新后从本地偏好恢复
    await page.reload();

    await expect(page.getByRole("heading", { name: "对比结果" })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /Gamma Pro/ })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /Delta Ultra/ })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /上下文窗口/ })).toHaveCount(0);
    // 未选择的模型不会出现
    await expect(page.getByRole("rowheader", { name: /Alpha 1/ })).toHaveCount(0);
  });
});
