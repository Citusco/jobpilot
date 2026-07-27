# Quickstart: JD 结构化提取与候选训练方向推荐

## 前置条件

- Node.js 20 LTS,已 `npm install`(引入 Fastify / `@langchain/langgraph` / `openai`
  / `zod` / `drizzle-orm` + `drizzle-kit` / `jest` + `ts-jest`,均已在 plan.md
  「Complexity Tracking」中确认)
- 本地或可达的 PostgreSQL 实例,已启用 `pgvector` 扩展(即便本 feature 不用 vector
  列,扩展需已存在以匹配项目统一的数据库配置)
- 环境变量:
  - `OPENAI_API_KEY`:直连 OpenAI SDK 用(Constitution IV,当前阶段不经网关)
  - `DATABASE_URL`:指向上述 Postgres 实例,同时供 `drizzle.config.ts` 读取

## 启动步骤

```bash
npm install
npm run db:generate  # drizzle-kit generate:据 src/db/schema.ts 生成 migration
npm run db:migrate   # drizzle-kit migrate:对 DATABASE_URL 执行 migration
npm run dev          # 启动 Fastify 开发服务器
```

## 验证场景(对应 spec 的三条 Acceptance Scenarios)

### 场景 1:信息完整的 JD → 返回结构摘要 + 3~6 个方向

```bash
curl -X POST http://localhost:3000/jd-submissions \
  -H "Content-Type: application/json" \
  -d '{"text": "我们招聘一名高级后端工程师,要求精通 Node.js、TypeScript、PostgreSQL,\n熟悉分布式系统设计,有 Kafka 或类似消息队列经验者优先。"}'
```

**期望**:HTTP 201;响应体 `status = "accepted"`;`extraction.role` 含"后端工程师"
相关表述;`extraction.techStack` 包含 Node.js / TypeScript / PostgreSQL;
`extraction.seniority` 为"高级"且 `seniorityInferred = false`(原文明示);
`directions` 长度在 [3, 6] 之间,每项都有非空 `rationale`(且理由中的关键词能在
请求体的 `text` 里找到)、非空 `tags`、`suggestedQuestionCount > 0`。参见
[contracts/openapi.yaml](./contracts/openapi.yaml) 的 `JdSubmissionAccepted` schema。

### 场景 2:理由可追溯性人工核查(对应 SC-002)

对场景 1 返回的每个 `directions[i].rationale`,人工确认其中引用/复述的技术点或
短语确实出现在提交的 JD 原文中,而非模型编造。此项在自动化测试里通过
`tests/integration/jdSubmissionFlow.test.ts` 用固定 JD 文本 + mock 的 LLM 响应做
断言(mock 响应本身在测试里手工构造,确保覆盖"理由引用原文"这一形状约束;真实
LLM 输出质量的抽查是人工 QA 职责,不在自动化测试范围内)。

### 场景 3:技术栈信息极丰富的 JD → 方向数量不超过 6

```bash
curl -X POST http://localhost:3000/jd-submissions \
  -H "Content-Type: application/json" \
  -d '{"text": "<一段涵盖前端/后端/数据/DevOps/算法等多个方向技术栈的长 JD>"}'
```

**期望**:`directions` 数组长度 ≤ 6,即使 JD 内容可映射出远多于 6 个方向。

## 边界场景验证

- **JD 文本过短/明显非职位描述**:提交 `{"text": "asdkjaskjd"}`,期望 HTTP 422,
  `status = "rejected"`,`reason` 提示补充完整 JD 内容(FR-011)。
- **未提及明确职级**:提交不含职级词汇的 JD,期望 `seniorityInferred = true`且
  `seniority` 仍有一个推断值(FR-010)。
- **技术栈稀疏、不足以支撑 3 个方向**:提交只提到一两项技术的简短 JD,期望
  `status = "accepted"` 但 `directions` 长度 < 3(而不是报错,也不是被凑数到 3
  个,FR-012)。

## 单元/集成测试入口

```bash
npm run test          # 跑 tests/unit + tests/contract + tests/integration(Jest)
npm run typecheck
npm run lint
```

- `tests/unit/graph/*`:每个 LangGraph 节点独立测试,mock `openai` client 与
  Drizzle client(Constitution II)。
- `tests/contract/jdSubmissions.contract.test.ts`:用 Fastify `inject()` 校验
  请求/响应形状与 `contracts/openapi.yaml` 一致。
- `tests/integration/jdSubmissionFlow.test.ts`:跑通完整状态图(LLM/DB 均 mock),
  覆盖上面列出的 3 条 Acceptance Scenarios + 3 条边界场景。
