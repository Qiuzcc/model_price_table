import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import CompareTable from "@/components/CompareTable";
import {
  DEFAULT_VISIBLE_COLUMNS,
  toModelRow,
  type ModelRow,
} from "@/lib/metrics";
import type {
  DisplayCurrency,
  FxRates,
  Model,
  ModelPricing,
  PerformanceMetrics,
} from "@/lib/domain/types";

function makePricing(overrides: Partial<ModelPricing> = {}): ModelPricing {
  return {
    inputPerMillion: null,
    outputPerMillion: null,
    cachedInputPerMillion: null,
    cachedWritePerMillion: null,
    thinkingOutputPerMillion: null,
    currency: "USD",
    tier: "standard",
    region: null,
    sourceUrl: null,
    ...overrides,
  };
}

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    sid: "acme/model",
    name: "Model",
    slug: "model",
    family: null,
    modelType: "general",
    contextWindow: 128_000,
    maxOutput: 16_384,
    modalities: ["text"],
    supportsTools: true,
    supportsBatch: false,
    supportsCaching: false,
    supportsStreaming: true,
    releaseDate: null,
    knowledgeCutoff: null,
    deprecatedAt: null,
    provider: { name: "Acme", slug: "acme", type: "direct" },
    pricing: [makePricing()],
    ...overrides,
  };
}

interface RowOptions {
  currency?: string;
  deprecatedAt?: string | null;
  performance?: PerformanceMetrics | null;
}

function makeRow(
  name: string,
  inputPerMillion: number | null,
  options: RowOptions = {},
): ModelRow {
  return toModelRow(
    makeModel({
      sid: `acme/${name}`,
      name,
      slug: name.toLowerCase(),
      deprecatedAt: options.deprecatedAt ?? null,
      pricing: [
        makePricing({
          inputPerMillion,
          currency: options.currency ?? "USD",
        }),
      ],
    }),
    options.performance ?? null,
  );
}

const fxRates: FxRates = {
  base: "USD",
  rates: { USD: 1, CNY: 7.2 },
  asOf: "2026-09-12",
  fetchedAt: 1,
  source: "frankfurter",
};

interface RenderOptions {
  rows: ModelRow[];
  visibleColumns?: string[];
  fx?: FxRates | null;
}

function renderTable({
  rows,
  visibleColumns = DEFAULT_VISIBLE_COLUMNS,
  fx = null,
}: RenderOptions) {
  const onRemove = vi.fn();
  const onClear = vi.fn();
  render(
    <CompareTable
      rows={rows}
      visibleColumns={visibleColumns}
      onVisibleColumnsChange={vi.fn()}
      onResetColumns={vi.fn()}
      onRemove={onRemove}
      onClear={onClear}
      displayCurrency="native"
      onDisplayCurrencyChange={vi.fn()}
      fx={fx}
    />,
  );
  return { onRemove, onClear };
}

function renderTableWithCurrency({
  rows,
  fx,
}: {
  rows: ModelRow[];
  fx: FxRates | null;
}) {
  function Wrapper() {
    const [currency, setCurrency] = useState<DisplayCurrency>("native");
    return (
      <CompareTable
        rows={rows}
        visibleColumns={DEFAULT_VISIBLE_COLUMNS}
        onVisibleColumnsChange={vi.fn()}
        onResetColumns={vi.fn()}
        onRemove={vi.fn()}
        onClear={vi.fn()}
        displayCurrency={currency}
        onDisplayCurrencyChange={setCurrency}
        fx={fx}
      />
    );
  }
  render(<Wrapper />);
}

function rowByText(name: RegExp) {
  const header = screen.getByRole("rowheader", { name });
  const row = header.closest("tr");
  if (!row) throw new Error("未找到模型行");
  return row;
}

function firstDataRow() {
  return screen.getAllByRole("row")[1];
}

describe("表格渲染", () => {
  it("展示模型行、供应商与可见列，统计模型数", () => {
    renderTable({ rows: [makeRow("Alpha", 1), makeRow("Beta", 2)] });

    const header = screen.getByRole("heading", { name: "对比结果" }).closest("header");
    expect(header).toHaveTextContent("共 2 个模型");

    expect(screen.getByRole("rowheader", { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: /Beta/ })).toBeInTheDocument();
    expect(screen.getAllByText("Acme")).toHaveLength(2);

    expect(screen.getByRole("columnheader", { name: /^输入价格/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /上下文窗口/ })).toBeInTheDocument();
  });

  it("价格按原生币种格式化展示", () => {
    renderTable({
      rows: [makeRow("Alpha", 1.5, { currency: "USD" }), makeRow("Beta", 7, { currency: "CNY" })],
    });

    expect(screen.getByText("$1.5")).toBeInTheDocument();
    expect(screen.getByText("¥7")).toBeInTheDocument();
  });

  it("仅渲染 visibleColumns 中的列", () => {
    renderTable({ rows: [makeRow("Alpha", 1)], visibleColumns: ["inputPrice"] });

    expect(screen.getByRole("columnheader", { name: /^输入价格/ })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /上下文窗口/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /输出价格/ })).not.toBeInTheDocument();
  });

  it("缺失价格与性能数据显示 —，弃用模型带标签", () => {
    renderTable({
      rows: [makeRow("Alpha", null, { deprecatedAt: "2026-01-01" })],
    });

    expect(screen.getByText("已弃用")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("匹配到性能数据时展示速度与延迟", () => {
    renderTable({
      rows: [
        makeRow("Alpha", 1, {
          performance: {
            outputTokensPerSecond: 100,
            timeToFirstTokenSeconds: 0.5,
            sourceModelSlug: "alpha",
          },
        }),
      ],
    });

    expect(screen.getByText("100.0")).toBeInTheDocument();
    expect(screen.getByText("500 ms")).toBeInTheDocument();
  });
});

describe("价格极值标记", () => {
  it("按当前展示币种比较，标记最低与最高", () => {
    renderTable({ rows: [makeRow("Alpha", 1), makeRow("Beta", 2)] });

    expect(within(rowByText(/Alpha/)).getByText("最低")).toBeInTheDocument();
    expect(within(rowByText(/Beta/)).getByText("最高")).toBeInTheDocument();
  });

  it("所有值相同时不标记", () => {
    renderTable({ rows: [makeRow("Alpha", 1), makeRow("Beta", 1)] });

    expect(screen.queryByText("最低")).not.toBeInTheDocument();
    expect(screen.queryByText("最高")).not.toBeInTheDocument();
  });

  it("无汇率时按原始数值比较", () => {
    renderTable({
      rows: [makeRow("Alpha", 1, { currency: "USD" }), makeRow("Beta", 5, { currency: "CNY" })],
    });

    // 无汇率无法折算：$1 与 ¥5 直接按数值 1 < 5 比较
    expect(within(rowByText(/Alpha/)).getByText("最低")).toBeInTheDocument();
    expect(within(rowByText(/Beta/)).getByText("最高")).toBeInTheDocument();
  });
});

describe("表头排序", () => {
  it("点击循环 升序 → 降序 → 取消，缺失值恒排最后", async () => {
    const user = userEvent.setup();
    renderTable({ rows: [makeRow("Alpha", 2), makeRow("Beta", 1), makeRow("Gamma", null)] });

    const header = screen.getByRole("columnheader", { name: /^输入价格/ });
    const sortButton = within(header).getByRole("button");

    // 升序：Beta(1) → Alpha(2) → Gamma(缺失，最后)
    await user.click(sortButton);
    expect(header).toHaveAttribute("aria-sort", "ascending");
    let rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByRole("rowheader", { name: /Beta/ })).toBeInTheDocument();
    expect(within(rows[1]).getByRole("rowheader", { name: /Alpha/ })).toBeInTheDocument();
    expect(within(rows[2]).getByRole("rowheader", { name: /Gamma/ })).toBeInTheDocument();

    // 降序：Alpha(2) → Beta(1) → Gamma(缺失，最后)
    await user.click(sortButton);
    expect(header).toHaveAttribute("aria-sort", "descending");
    rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByRole("rowheader", { name: /Alpha/ })).toBeInTheDocument();
    expect(within(rows[2]).getByRole("rowheader", { name: /Gamma/ })).toBeInTheDocument();

    // 取消：恢复传入顺序
    await user.click(sortButton);
    expect(header).not.toHaveAttribute("aria-sort");
    expect(
      within(firstDataRow()).getByRole("rowheader", { name: /Alpha/ }),
    ).toBeInTheDocument();
  });

  it("不可排序列没有排序按钮", () => {
    renderTable({ rows: [makeRow("Alpha", 1)] });

    const header = screen.getByRole("columnheader", { name: /上下文窗口/ });
    expect(within(header).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("币种切换", () => {
  it("有汇率时可折算为人民币并展示页脚说明", async () => {
    const user = userEvent.setup();
    renderTableWithCurrency({
      rows: [makeRow("Alpha", 1, { currency: "USD" }), makeRow("Beta", 10, { currency: "CNY" })],
      fx: fxRates,
    });

    await user.click(screen.getByRole("button", { name: "¥ 人民币" }));

    expect(screen.getByRole("button", { name: "¥ 人民币" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // USD 价格按汇率折算，CNY 价格保持原值
    expect(screen.getByText("¥7.2")).toBeInTheDocument();
    expect(screen.getByText("¥10")).toBeInTheDocument();
    expect(screen.getByText(/价格已折算为人民币/)).toBeInTheDocument();
  });

  it("切回原生币种恢复原始展示", async () => {
    const user = userEvent.setup();
    renderTableWithCurrency({ rows: [makeRow("Alpha", 1)], fx: fxRates });

    await user.click(screen.getByRole("button", { name: "¥ 人民币" }));
    await user.click(screen.getByRole("button", { name: "原生" }));

    expect(screen.getByText("$1")).toBeInTheDocument();
    expect(screen.getByText(/未做汇率换算/)).toBeInTheDocument();
  });

  it("无汇率时折算按钮禁用且保持原生展示", () => {
    renderTable({ rows: [makeRow("Alpha", 1)], fx: null });

    expect(screen.getByRole("button", { name: "原生" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "¥ 人民币" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "$ 美元" })).toBeDisabled();
    expect(screen.getByText("$1")).toBeInTheDocument();
  });
});

describe("行操作", () => {
  it("点击移除按钮回调对应 sid", async () => {
    const user = userEvent.setup();
    const { onRemove } = renderTable({ rows: [makeRow("Alpha", 1)] });

    await user.click(screen.getByRole("button", { name: "移除 Alpha" }));

    expect(onRemove).toHaveBeenCalledWith("acme/Alpha");
  });

  it("点击清空列表触发回调", async () => {
    const user = userEvent.setup();
    const { onClear } = renderTable({ rows: [makeRow("Alpha", 1)] });

    await user.click(screen.getByRole("button", { name: "清空列表" }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
