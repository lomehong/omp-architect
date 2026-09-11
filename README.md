# omp-architect

架构师 Agent 的 **omp（oh-my-pi）宿主外壳**：把宿主中立核心 `architect-core`（纯函数，唯一事实源）注册为 omp 工具面。

## 工具（4）

| 工具 | 作用 |
|---|---|
| `architect_digest` | 需求准入（六项覆盖检查 → 结论与补齐清单） |
| `architect_design` | 方案覆盖自检（六维度+五问，设计期） |
| `architect_review` | 方案评审评分 + 评审结论骨架（评审期） |
| `architect_lint` | 知识库机械校验 R1~R9（**知识库改动提交前必跑**；含设备路径禁止入库） |

## 结构与约束

- **分层**：校验/评分逻辑全部在 `architect-core`（大脑仓 `packages/architect-core/`，单一事实源）；本仓只做注册与呈现，禁止复制逻辑；
- **位置约束（阶段一）**：本仓以**子模块**形式位于大脑仓内（`<大脑仓>/omp-architect`），核心经相对路径 `../packages/architect-core/src` 引用（Bun 直接加载 TS，零安装）；后续核心发布 npm 包后改为版本依赖；
- **挂载（v3 容器）**：`~/.omp/agent/tools/architect/index.ts` → 本仓 `src/index.ts`；
- **治理**：omp 无 dsh 账本 → push/发布/删除数据一律停并 `ask` 主人，不得静默放行。

## 用法

容器内（v3）：`docker exec -it -u pi oh-my-pi omp`，工具面即含上述 4 工具；
bash 兜底校验：`node /opt/architect/dsh-architect/scripts/lint-knowledge.mjs /opt/architect/architect-knowledge`。
