# 模型价格对比

预览地址：

- https://edge.timegogo.top/
- https://model-price-table.vercel.app/

![alt text](image.png)

**一个用于横向对比大模型 API 价格的 Web 应用。**

支持供应商 / 模型两级筛选、数值列排序、价格极值高亮，以及人民币 / 美元汇率折算展示。

- 价格与规格数据来自 [LLMRates.ai](https://www.llmrates.ai) 开放数据集（CC BY 4.0）
- 性能指标（输出速度、首 Token 延迟）来自 [Artificial Analysis](https://artificialanalysis.ai/)（可选配置 API Key）
- 汇率参考 ECB（Frankfurter），折算结果仅供参考

## 项目背景

我目前在开发个人项目时使用的是两家国产的 IDE —— Qoder 和 Trae，由于如果要同时开两家的 coding plan 套餐成本有点过高，而且缺乏弹性（无法根据实际用量需求来调节成本），所以选择了使用国产主流模型的按量付费 API。在这个使用过程中，**出于把控成本的考量，我需要对每家模型的价格有一个整体的感知**。

如果按照传统方法，我需要去挨个查看模型官网披露的官方报价，这种方式不仅操作链路繁杂，而且无法直观地形成对比。

于是我就去网上寻找现成的解决方案，找到了如：[Atrificial Analysis](https://artificialanalysis.ai/)、[TrakToken](https://www.traktoken.com/)、[LLMRates](https://www.llmrates.ai/zh-Hans) 这些优质的网站。虽然这些网站提供的服务全面而且优质，但他们并没能解决我的一个高度垂直的需求——**快速且直观的横向对比多个（>5 个）模型的价格（及一些其它简单的性能参数）**。

于是我最终决定根据自己的垂直需求，手搓定制一个。

实际上，在这个项目中，定制的内容仅限于数据的交互和呈现形态；里面用到的数据依然来自于网上的公开数据。

## 快速开始

### 环境要求

- Node.js 20+
- pnpm（推荐，也可使用 npm / yarn / bun）

### 安装与启动

```bash
pnpm install
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可使用。

常用脚本：

| 命令         | 说明                   |
| ------------ | ---------------------- |
| `pnpm dev`   | 启动开发服务器         |
| `pnpm build` | 生产构建（含类型检查） |
| `pnpm start` | 启动生产服务器         |
| `pnpm lint`  | 运行 ESLint 检查       |

### 环境变量（可选）

在项目根目录的 `.env.local`（或 `.env`）中配置：

```bash
ARTIFICIAL_ANALYSIS_API_KEY=aa_你的key
```

| 变量                          | 必填 | 说明                                                                                                                                                                                                                                                                               |
| ----------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ARTIFICIAL_ANALYSIS_API_KEY` | 否   | [Artificial Analysis](https://artificialanalysis.ai/data-api) 免费 API Key（注册 Insights Platform 后生成）。配置后展示「输出速度」「首 Token 延迟」两列；未配置时两列显示 —，其余功能不受影响。免费层限 1,000 请求/日，本项目仅在服务端调用并做 12 小时缓存，实际用量远低于限额。 |

配置注意事项：

- Key 仅服务端使用（AA 条款要求），不会出现在浏览器请求中
- 修改环境变量后需**重启 dev server** 才会生效
- Next.js 环境变量文件优先级为 `.env.local` > `.env`，且**空值同样会覆盖**低优先级文件——同名变量务必只保留一处定义

## 缓存策略

客户端请求统一设置 `cache: no-store`。缓存分两处：**客户端首屏缓存**负责打开页面时的即显体验，**服务端缓存**负责数据本身的多层缓存与多源容灾。

### 客户端首屏缓存（IndexedDB，stale-while-revalidate）

最近一次成功取数后，价格 / 性能 / 汇率整体写入 IndexedDB（key `client-bundle-v1`，带结构版本号，字段调整时升级即可让旧缓存自然失效）。打开页面时：

1. 优先读取本地缓存立即渲染（不等待网络，弱网下无需白屏等待接口下载）；
2. 同时后台请求服务端最新数据；
3. 数据返回后无感刷新页面数据并回写缓存；请求失败时继续展示本地缓存并标记「同步失败」，不打断浏览。

价格数据集约 5MB，超出 localStorage 容量上限，因此统一走 IndexedDB（`lib/cache.ts`）；隐私模式、配额不足等异常自动退化为直连服务端。

### 服务端数据缓存

服务端缓存分为两层：

| 数据类型 | 缓存层级              | TTL     | 说明                                                                                                                                              |
| -------- | --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 价格数据 | 磁盘缓存 + 进程内镜像 | 6 小时  | 数据集体积较大（超 Next.js FetchCache 2MB 上限），写入 `.cache/pricing-catalog.json`；上游全失败时降级返回过期缓存                                |
| 性能数据 | 磁盘缓存 + 进程内镜像 | 12 小时 | Artificial Analysis API，写入 `.cache/performance-data.json`（服务重启后可快速恢复）；强制刷新最短间隔 1 小时保护免费额度；失败返回旧缓存或空映射 |
| 汇率数据 | 内存缓存              | 12 小时 | 主源 Frankfurter（ECB），兜底 open.er-api；失败返回旧缓存                                                                                         |

**容灾机制**：价格数据支持 `?source=<id>` 跳过缓存直接拉取指定源；上游全失败时降级返回过期数据（标记 `stale: true`）

价格数据源容灾链（按优先级逐个尝试）：

1. LLMRates.ai 动态 API（主源，原生币种、字段最全）
2. LLMRates GitHub 镜像（同一数据集，防单一端点故障）
3. [models.dev](https://models.dev)（独立第三方源，provider × model 结构与领域模型最接近）
4. [OpenRouter](https://openrouter.ai)（独立第三方源，公开 models API）

## 项目结构

```
model_price_table_deepseek_2/
├── app/
│   ├── api/
│   │   ├── pricing/route.ts        # 价格数据代理（LLMRates.ai + GitHub 兜底）
│   │   ├── performance/route.ts    # 性能数据代理（Artificial Analysis）
│   │   └── fx/route.ts             # 汇率数据代理（ECB）
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── PriceCompareApp.tsx         # 主容器：取数、状态、筛选与持久化
│   ├── CompareTable.tsx            # 对比表格：排序、极值标签、币种渲染
│   ├── ColumnSettings.tsx          # 列显示设置
│   ├── ModelPicker.tsx             # 模型多选（二级筛选）
│   ├── ProviderFilter.tsx          # 供应商多选（一级筛选）
│   └── MultiSelect.tsx             # 通用多选下拉（搜索 + 虚拟滚动）
├── lib/
│   ├── domain/
│   │   └── types.ts                # 领域模型：与数据源无关的抽象数据结构
│   ├── server/
│   │   ├── sources/
│   │   │   ├── types.ts            # 数据源适配器契约
│   │   │   ├── shared.ts           # 适配器共享解析工具
│   │   │   ├── llmrates.ts         # LLMRates.ai 适配器（API 主源 + GitHub 镜像）
│   │   │   ├── models-dev.ts       # models.dev 适配器（独立备源）
│   │   │   ├── openrouter.ts       # OpenRouter 适配器（独立备源）
│   │   │   └── registry.ts         # 数据源注册表（容灾优先级）
│   │   ├── pricing-source.ts       # 价格数据编排：多源回退 + 磁盘缓存
│   │   ├── performance-source.ts   # 性能数据源：AA API + 匹配 + 磁盘缓存
│   │   ├── fx-source.ts            # 汇率数据源：ECB + 兜底 + 内存缓存
│   │   └── aa-matching.ts          # 领域模型 ↔ AA 多级模型匹配
│   ├── api.ts                      # 客户端取数（代理服务端 API + 首屏缓存读写）
│   ├── cache.ts                    # IndexedDB 大体积数据缓存封装（首屏缓存）
│   ├── metrics.ts                  # 列定义、格式化、币种换算
│   └── store.ts                    # localStorage 偏好持久化
└── ...
```
