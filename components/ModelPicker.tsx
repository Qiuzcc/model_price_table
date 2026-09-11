"use client";

import { useMemo } from "react";
import MultiSelect, { type MultiSelectOption } from "./MultiSelect";
import { PROVIDER_TYPE_LABELS } from "@/lib/metrics";
import type { ModelInfo } from "@/lib/types";

interface ModelPickerProps {
  /** 二级过滤后的候选模型（未选供应商时为全量模型） */
  candidates: ModelInfo[];
  /** 已选中的模型 sid 列表（即进入对比列表的模型） */
  selected: string[];
  onChange: (sids: string[]) => void;
}

/** 二级过滤 + 勾选：候选模型多选下拉，勾选即进入对比列表 */
export default function ModelPicker({ candidates, selected, onChange }: ModelPickerProps) {
  const options: MultiSelectOption[] = useMemo(() => {
    const sorted = [...candidates].sort(
      (a, b) =>
        a.provider.name.localeCompare(b.provider.name, "zh") || a.name.localeCompare(b.name, "zh"),
    );
    return sorted.map((model) => ({
      value: model.sid,
      label: model.name,
      hint: model.provider.name,
      keywords: [model.slug, model.family, PROVIDER_TYPE_LABELS[model.provider.providerType]]
        .filter(Boolean)
        .join(" "),
    }));
  }, [candidates]);

  return (
    <MultiSelect
      options={options}
      selected={selected}
      onChange={onChange}
      label="具体模型"
      searchPlaceholder="搜索模型名称 / slug / 家族…"
      emptyText="没有匹配的模型"
      virtualized
      popoverClassName="w-[440px]"
    />
  );
}
