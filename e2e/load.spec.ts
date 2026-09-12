import { expect, test } from "@playwright/test";
import { gotoApp, mockApis } from "./fixtures";

test.describe("页面加载", () => {
  test("首屏加载：展示标题、筛选区、数据集统计与空状态", async ({ page }) => {
    await mockApis(page);
    await gotoApp(page);

    await expect(
      page.getByRole("heading", { level: 1, name: "模型价格对比" }),
    ).toBeVisible();
    await expect(
      page.getByText(/数据集共\s*4\s*个模型、\s*2\s*个供应商/),
    ).toBeVisible();
    await expect(
      page.getByText(/性能指标已匹配\s*2\/4\s*个模型/),
    ).toBeVisible();
    await expect(page.getByText("还没有选择要对比的模型")).toBeVisible();
  });

  test("价格接口失败：展示错误面板，恢复后重试成功", async ({ page }) => {
    const api = await mockApis(page, { failPricing: true });
    await page.goto("/");

    await expect(page.getByText("数据加载失败")).toBeVisible();
    await expect(page.getByText("上游数据源暂时不可用")).toBeVisible();

    // 恢复接口后点击重试，页面正常进入就绪状态
    api.setFailPricing(false);
    await page.getByRole("button", { name: "重试" }).click();

    await expect(page.getByText(/数据集共\s*4\s*个模型/)).toBeVisible();
    await expect(page.getByText("还没有选择要对比的模型")).toBeVisible();
  });
});
