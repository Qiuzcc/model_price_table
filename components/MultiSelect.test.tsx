import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import MultiSelect, { type MultiSelectOption } from "@/components/MultiSelect";

const OPTIONS: MultiSelectOption[] = [
  { value: "a", label: "Alpha", hint: "Acme" },
  { value: "b", label: "Beta", hint: "Acme" },
  { value: "c", label: "Gamma", hint: "Gadget", keywords: "gg" },
];

function Harness({ onChange }: { onChange?: (values: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <MultiSelect
      options={OPTIONS}
      selected={selected}
      onChange={(values) => {
        onChange?.(values);
        setSelected(values);
      }}
      label="具体模型"
    />
  );
}

const openButtonName = /具体模型/;
const searchPlaceholder = "搜索…";

async function openDropdown(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: openButtonName }));
}

describe("打开与关闭", () => {
  it("初始为关闭状态，点击后展开搜索与选项列表", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole("button", { name: openButtonName })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByPlaceholderText(searchPlaceholder)).not.toBeInTheDocument();

    await openDropdown(user);

    expect(screen.getByRole("button", { name: openButtonName })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByPlaceholderText(searchPlaceholder)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.getByText(/已选/)).toHaveTextContent("已选 0 / 当前结果 3");
  });

  it("按 Escape 关闭", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openDropdown(user);

    await user.keyboard("{Escape}");
    expect(screen.queryByPlaceholderText(searchPlaceholder)).not.toBeInTheDocument();
  });

  it("点击组件外部时关闭", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openDropdown(user);

    fireEvent.pointerDown(document.body);
    expect(screen.queryByPlaceholderText(searchPlaceholder)).not.toBeInTheDocument();
  });
});

describe("搜索过滤", () => {
  it("按 label 与 hint 过滤", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openDropdown(user);

    await user.type(screen.getByPlaceholderText(searchPlaceholder), "gam");

    expect(screen.getByRole("checkbox", { name: /Gamma/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Alpha/ })).not.toBeInTheDocument();
  });

  it("关键词（keywords）参与搜索匹配", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openDropdown(user);

    await user.type(screen.getByPlaceholderText(searchPlaceholder), "gg");

    expect(screen.getByRole("checkbox", { name: /Gamma/ })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Alpha/ })).not.toBeInTheDocument();
  });

  it("无匹配时显示空状态文案", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openDropdown(user);

    await user.type(screen.getByPlaceholderText(searchPlaceholder), "zzz");

    expect(screen.getByText("没有匹配的选项")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("勾选交互", () => {
  it("点击选项勾选并更新计数徽章，再次点击取消", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await openDropdown(user);

    await user.click(screen.getByRole("checkbox", { name: /Alpha/ }));
    expect(onChange).toHaveBeenLastCalledWith(["a"]);
    expect(screen.getByRole("checkbox", { name: /Alpha/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      within(screen.getByRole("button", { name: openButtonName })).getByText("1"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: /Alpha/ }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByRole("checkbox", { name: /Alpha/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("全选当前筛选结果", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await openDropdown(user);

    await user.click(screen.getByRole("button", { name: "全选" }));

    expect(onChange).toHaveBeenLastCalledWith(["a", "b", "c"]);
    expect(screen.getByRole("checkbox", { name: /Alpha/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("checkbox", { name: /Gamma/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("清空已选；无选中时清空按钮禁用", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await openDropdown(user);

    expect(screen.getByRole("button", { name: "清空" })).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /Beta/ }));
    expect(screen.getByRole("button", { name: "清空" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "清空" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByRole("button", { name: "清空" })).toBeDisabled();
  });
});
