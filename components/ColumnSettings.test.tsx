import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import ColumnSettings from "@/components/ColumnSettings";

function Harness({ onReset }: { onReset?: () => void }) {
  const [visible, setVisible] = useState<string[]>(["inputPrice", "outputPrice"]);
  return (
    <ColumnSettings
      visible={visible}
      onChange={setVisible}
      onReset={() => {
        onReset?.();
        setVisible(["inputPrice"]);
      }}
    />
  );
}

const trigger = () => screen.getByRole("button", { name: /列设置/ });

describe("ColumnSettings", () => {
  it("触发器展示已显示列数，初始面板关闭", () => {
    render(<Harness />);
    expect(within(trigger()).getByText("2")).toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("勾选需要在对比表格中展示的指标列")).not.toBeInTheDocument();
  });

  it("点击展开全部列选项，勾选状态与 visible 一致", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("勾选需要在对比表格中展示的指标列")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /^输入价格/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("checkbox", { name: /^输出价格/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("checkbox", { name: /上下文窗口/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("点击未显示列加入 visible，点击已显示列移除", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());

    await user.click(screen.getByRole("checkbox", { name: /上下文窗口/ }));
    expect(screen.getByRole("checkbox", { name: /上下文窗口/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(trigger()).getByText("3")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /^输入价格/ }));
    expect(screen.getByRole("checkbox", { name: /^输入价格/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(within(trigger()).getByText("2")).toBeInTheDocument();
  });

  it("恢复默认重置为默认列集", async () => {
    const onReset = vi.fn();
    const user = userEvent.setup();
    render(<Harness onReset={onReset} />);
    await user.click(trigger());

    await user.click(screen.getByRole("button", { name: "恢复默认" }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("checkbox", { name: /^输入价格/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("checkbox", { name: /^输出价格/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("完成按钮、Escape 与外部点击均可关闭面板", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(trigger());
    await user.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.queryByText("勾选需要在对比表格中展示的指标列")).not.toBeInTheDocument();

    await user.click(trigger());
    await user.keyboard("{Escape}");
    expect(screen.queryByText("勾选需要在对比表格中展示的指标列")).not.toBeInTheDocument();

    await user.click(trigger());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText("勾选需要在对比表格中展示的指标列")).not.toBeInTheDocument();
  });
});
