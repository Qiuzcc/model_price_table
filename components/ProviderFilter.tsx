"use client";

import { useMemo } from "react";
import MultiSelect, { type MultiSelectOption } from "./MultiSelect";
import { PROVIDER_TYPE_LABELS } from "@/lib/metrics";
import type { Provider } from "@/lib/domain/types";

interface ProviderFilterProps {
  /** 全量供应商列表（含 0 模型供应商） */
  providers: Provider[];
  selected: string[];
  onChange: (slugs: string[]) => void;
}

/** 一级过滤：模型供应商 */
export default function ProviderFilter({ providers, selected, onChange }: ProviderFilterProps) {
  const options: MultiSelectOption[] = useMemo(
    () =>
      providers.map((provider) => ({
        value: provider.slug,
        label: provider.nameLocal ? `${provider.name}（${provider.nameLocal}）` : provider.name,
        hint: `${provider.modelCount} 个模型`,
        keywords: `${provider.slug} ${PROVIDER_TYPE_LABELS[provider.type] ?? provider.type}`,
      })),
    [providers],
  );

  return (
    <MultiSelect
      options={options}
      selected={selected}
      onChange={onChange}
      label="模型供应商"
      searchPlaceholder="搜索供应商…"
      emptyText="没有匹配的供应商"
      popoverClassName="w-[320px]"
    />
  );
}
