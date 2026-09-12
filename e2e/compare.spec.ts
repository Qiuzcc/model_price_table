import { expect, test } from "@playwright/test";
import {
  firstDataRow,
  gotoApp,
  mockApis,
  selectModels,
  selectProvider,
} from "./fixtures";

test.describe("筛选与对比", () => {
  test("供应商筛选联动候选模型，勾选后渲染对比表格", async ({ page }) => {
    await mockApis(page);
    await gotoApp(page);

    // 一级筛选：勾选 Acme AI 后候选模型收敛为 2 个（JSX 换行折叠为空格，正则需兼容）
    await selectProvider(page, "Acme AI");
    await expect(
      page.getByText(/当前候选\s*2\s*个模型\s*（已筛\s*1\s*个供应商）/),
    ).toBeVisible();

    // 二级筛选：勾选两个模型进入对比列表
    await selectModels(page, ["Alpha 1", "Beta Mini"]);

    await expect(page.getByRole("heading", { name: "对比结果" })).toBeVisible();
    await expect(page.getByText(/共\s*2\s*个模型/)).toBeVisible();

    const alphaRow = page.getByRole("row", { name: /Alpha 1/ });
    const betaRow = page.getByRole("row", { name: /Beta Mini/ });
    // 原生币种展示：USD $1、CNY ¥7（单元格内可能带「最低 / 最高」极值标签，按内容匹配）
    await expect(alphaRow.locator("td", { hasText: "$1" })).toBeVisible();
    await expect(betaRow.locator("td", { hasText: "¥7" })).toBeVisible();
    // 弃用模型带标签
    await expect(betaRow.getByText("已弃用")).toBeVisible();
    // 匹配到性能数据的模型展示速度与延迟
    await expect(alphaRow.getByText("120.5", { exact: true })).toBeVisible();
    await expect(alphaRow.getByText("420 ms", { exact: true })).toBeVisible();
  });

  test("点击表头可循环排序：升序 → 降序 → 取消", async ({ page }) => {
    await mockApis(page);
    await gotoApp(page);
    await selectModels(page, ["Gamma Pro", "Delta Ultra"]);

    // 未排序时保持勾选顺序
    await expect(firstDataRow(page).getByRole("rowheader")).toContainText(
      "Gamma Pro",
    );

    const sortButton = page.getByRole("button", {
      name: "输入价格",
      exact: true,
    });

    // 升序：Gamma Pro（$0.5）在前
    await sortButton.click();
    await expect(page.locator('th[aria-sort="ascending"]')).toHaveCount(1);
    await expect(firstDataRow(page).getByRole("rowheader")).toContainText(
      "Gamma Pro",
    );

    // 降序：Delta Ultra（$10）在前
    await sortButton.click();
    await expect(page.locator('th[aria-sort="descending"]')).toHaveCount(1);
    await expect(firstDataRow(page).getByRole("rowheader")).toContainText(
      "Delta Ultra",
    );

    // 取消：恢复勾选顺序
    await sortButton.click();
    await expect(page.locator("th[aria-sort]")).toHaveCount(0);
    await expect(firstDataRow(page).getByRole("rowheader")).toContainText(
      "Gamma Pro",
    );
  });

  test("币种切换：美元价格按汇率折算为人民币", async ({ page }) => {
    await mockApis(page);
    await gotoApp(page);
    await selectModels(page, ["Alpha 1"]);

    const alphaRow = page.getByRole("row", { name: /Alpha 1/ });
    await expect(alphaRow.getByText("$1", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "¥ 人民币", exact: true }).click();

    // $1 → ¥7.2（输入），$4 → ¥28.8（输出）
    await expect(alphaRow.getByText("¥7.2", { exact: true })).toBeVisible();
    await expect(alphaRow.getByText("¥28.8", { exact: true })).toBeVisible();
    await expect(page.getByText(/价格已折算为人民币/)).toBeVisible();

    // 切回原生币种
    await page.getByRole("button", { name: "原生", exact: true }).click();
    await expect(alphaRow.getByText("$1", { exact: true })).toBeVisible();
  });

  test("列设置：隐藏列与恢复默认", async ({ page }) => {
    await mockApis(page);
    await gotoApp(page);
    await selectModels(page, ["Alpha 1"]);

    const contextColumn = page.getByRole("columnheader", {
      name: /上下文窗口/,
    });
    await expect(contextColumn).toBeVisible();

    // 隐藏「上下文窗口」列
    await page.getByRole("button", { name: /列设置/ }).click();
    await page.getByRole("checkbox", { name: /上下文窗口/ }).click();
    await page.keyboard.press("Escape");
    await expect(contextColumn).toHaveCount(0);

    // 恢复默认列集
    await page.getByRole("button", { name: /列设置/ }).click();
    await page.getByRole("button", { name: "恢复默认" }).click();
    await page.keyboard.press("Escape");
    await expect(contextColumn).toBeVisible();
  });
});
