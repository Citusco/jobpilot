# Implementation Plan: JD 结构化提取与候选训练方向推荐

**Branch**: `001-jd-training-directions` | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-jd-training-directions/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

接受一段自由格式 JD 文本,通过一次 LLM 调用提取角色/技术栈/职级并判断信息是否充分
(不充分则拒绝,FR-011);若充分,再通过第二次 LLM 调用基于结构化摘要 + JD 原文生成
3~6 个(信息稀疏时可少于 3 个,FR-012)候选训练方向,每个方向带可追溯理由、标签、
建议题目数量。两次 LLM 输出都必须先通过对应 Zod schema 校验才能向下传递或持久化
(Constitution I)。整个流程建模为一个 LangGraph.js 状态图(提取节点 → 条件边 → 方向
生成节点 → 持久化节点),每个节点可独立单测、LLM 调用在测试中被 mock(Constitution
II)。结果通过 Fastify 暴露为单个同步 HTTP 端点,并持久化到 Postgres,与产生它的 JD
提交记录关联(FR-013),供后续题目生成阶段引用。LLM 直连 OpenAI SDK,不接 Agent
Forge 网关(Constitution IV,当前阶段明确要求)。

## Technical Context

**Language/Version**: TypeScript 5.4+ on Node.js 20 LTS,ES modules only

**Primary Dependencies**: Fastify 4.x;`@langchain/langgraph`(状态图编排);`openai`
官方 SDK(含 `openai/helpers/zod` 的 `zodResponseFormat`,用于把已有 Zod schema 转成
OpenAI Structured Outputs 的 JSON schema,不需要额外的 schema 转换库);`zod`(LLM
structured output 校验 + HTTP 请求体校验);`drizzle-orm` + `drizzle-kit`(Postgres
ORM 与 schema/migration 工具 — **新增依赖,constitution 技术栈清单里只写了
"pgvector (in Postgres)",未点名 ORM/驱动层,按 CLAUDE.md"不要引入未列出的库,先讨论"
的要求在此明确标出;已与你确认,选择 Drizzle 而非裸驱动 `pg`,理由见 research.md §2**)

**Storage**: PostgreSQL(启用 pgvector 扩展,与项目其余部分共用同一实例;本 feature
自身的两张表是纯关系型数据,不使用 vector 列 — pgvector 扩展保留给未来基于 embedding
的功能使用,这里不强行引入用不上的向量字段)

**Testing**: Jest + `ts-jest`(ESM 预设)(**同样是新增技术选型 — CLAUDE.md 只写了
`npm run test` 这个壳命令,没有点名具体测试框架,已与你确认选择 Jest,理由见
research.md §3:生态最成熟、面试/招聘认知度最高,对纯 ESM + TS 需要额外的
`ts-jest`/ESM 配置,但这份配置成本本身也是学习项目里值得练一遍的内容)

**Target Platform**: Linux server(容器化部署的 Node.js 服务;本 feature 目前只有
backend,没有 frontend)

**Project Type**: single project(backend-only web service)

**Performance Goals**: 非高并发场景(内部工具,预期日提交量为几十到低百级别);单次
请求延迟主要由两次 LLM 调用的串行耗时决定,目标 p95 端到端(含持久化)在数十秒量级,
远低于 SC-004 所要求的"几分钟内完成一轮评估"

**Constraints**:
- 未经 Zod 校验的 LLM 原始输出不得进入下游逻辑或被持久化(Constitution I)
- 候选方向数量上限 6、下限由信息丰富度决定(可少于 3,不可无限增长,不可为凑数而
  编造,FR-005/FR-012)
- 信息不足以识别角色/技术栈时必须拒绝而非返回低置信度结果(FR-011)
- 每个方向的理由必须可追溯到 JD 原文(FR-006),因此生成理由的 LLM 调用必须能访问
  JD 原文全文,而不能仅依赖提取后的摘要

**Scale/Scope**: MVP 单一用户故事;数据库 scope 为 2 张表(JD 提交记录、候选训练
方向);单一 HTTP 端点

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Result |
|---|---|---|
| I. Schema-Validated LLM I/O | 两次 LLM 调用(提取、方向生成)均定义对应 Zod schema,响应先 `.parse()` 校验成功后才进入图状态或写库 | PASS |
| II. Independently Testable LangGraph Nodes | 图拆分为 4 个节点(`extractJdStructure` / 条件边 / `generateCandidateDirections` / `persistSubmission`),单测中 mock OpenAI client 与 Drizzle client,不打真实 API/DB | PASS |
| III. Plan-Before-Build for Structural Changes | 本 feature 涉及新数据库 schema(2 张新表)与新 LangGraph 状态图设计,因此必须走完整 SDD 流程 —— 本 plan 即是该流程的一部分,后续仍需 `/speckit-tasks` → `/speckit-implement` | PASS(正在走) |
| IV. Locked Technology Stack | Fastify / LangGraph.js / OpenAI SDK 直连 / Zod 均在清单内且用法一致;`drizzle-orm`/`drizzle-kit` 与 `jest` 未被逐字点名,已列入下方 Complexity Tracking 并与你确认选定 | FLAGGED→已确认(见下表,非阻断性违规,是清单未覆盖到的具体包选型,已拍板) |
| V. Definition of Done: Typed, Tested, Reviewed | 每个节点、每个 schema 都规划了对应单测;新逻辑测试计划交由 `test-reviewer` subagent 独立审查;完成定义包含 typecheck + lint + test 全部通过 | PASS |

**Post-Design Re-check(Phase 1 完成后)**:data-model.md / contracts / quickstart.md
产出后重新核对 —— 两张表的写入路径(`persistSubmission` 节点)仍在事务边界内完成,
未引入新的跨节点共享可变状态;两个 Zod schema(`jdExtraction` / `candidateDirections`)
与 `zodResponseFormat` 的配对未新增任何清单外依赖;唯一的两处 FLAGGED 项
(`drizzle-orm`/`drizzle-kit` / `jest`)未扩大,仍与 Phase 0 结论一致,且已经过用户
确认。**结论:PASS,无新增违规。**

## Project Structure

### Documentation (this feature)

```text
specs/001-jd-training-directions/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── openapi.yaml
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── server.ts                          # Fastify app 启动入口
├── routes/
│   └── jdSubmissions.ts               # POST /jd-submissions 路由
├── graph/
│   ├── state.ts                       # LangGraph 状态定义(rawText/extraction/directions/...)
│   ├── index.ts                       # 编译好的 StateGraph 实例
│   └── nodes/
│       ├── extractJdStructure.ts      # 节点1: 提取 + 充分性判断(单次 LLM 调用)
│       ├── generateCandidateDirections.ts  # 节点2: 生成候选方向(单次 LLM 调用)
│       └── persistSubmission.ts       # 节点3: 事务写入 JD 提交记录 + 候选方向
├── llm/
│   └── openaiClient.ts                # OpenAI SDK 客户端的薄封装(直连,不经网关)
├── schemas/
│   ├── jdExtraction.schema.ts         # 提取结果 Zod schema(含 sufficient/insufficientReason)
│   └── candidateDirections.schema.ts  # 候选方向列表 Zod schema
├── db/
│   ├── client.ts                       # Drizzle client 初始化(基于 node-postgres 驱动)
│   ├── schema.ts                       # Drizzle schema:jdSubmissions / candidateTrainingDirections
│   ├── migrations/                     # drizzle-kit 生成的 SQL migration(不手写)
│   └── repositories/
│       └── jdSubmissionRepository.ts   # 持久化 + 按 id 查询
└── types/
    └── index.ts

drizzle.config.ts                       # drizzle-kit 配置(schema 路径、migrations 输出目录、DATABASE_URL)

tests/
├── unit/
│   ├── graph/
│   │   ├── extractJdStructure.test.ts
│   │   ├── generateCandidateDirections.test.ts
│   │   └── persistSubmission.test.ts
│   └── schemas/
│       ├── jdExtraction.schema.test.ts
│       └── candidateDirections.schema.test.ts
├── contract/
│   └── jdSubmissions.contract.test.ts # 对照 contracts/openapi.yaml 校验请求/响应形状
└── integration/
    └── jdSubmissionFlow.test.ts       # 全图跑通(LLM/DB 均 mock),覆盖 spec 三条 Acceptance Scenarios
```

**Structure Decision**: 采用单项目结构(Option 1)。当前阶段 JobPilot 只有 backend,
没有 frontend,因此不使用 Option 2 的 backend/frontend 拆分。LangGraph 图代码独立成
`src/graph/`,便于 Constitution II 要求的节点级独立测试;Zod schema 集中在
`src/schemas/`,同时供 LLM structured output 校验和(未来)HTTP 层复用。

## Complexity Tracking

> 以下两项不是对现有 Locked Technology Stack 的违反或替换,而是清单中未点名、必须
> 有人明确拍板的具体包选型(Constitution IV:"不得静默引入")。已与用户确认,决策
> 依据是"这是一个求职/学习项目"这一具体上下文,而非纯粹的实现最简路径。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 新增依赖 `drizzle-orm` + `drizzle-kit` | Constitution 只把 Postgres/pgvector 列为技术栈,未点名 ORM/驱动层;FR-013 的持久化需要某种数据访问方式 | 裸驱动 `pg` 实现上更简单(无额外抽象层),但用户明确希望借这个项目练习 schema-as-code / 类型安全 query builder / migration 工作流这套更贴近当前招聘市场的技能,因此按用户决定采用 Drizzle |
| 新增测试框架 `jest`(+ `ts-jest` ESM 预设) | CLAUDE.md 只定义了 `npm run test` 这个壳命令,未点名具体框架;Constitution II 要求 LangGraph 节点可独立单测且 mock LLM | Vitest 对纯 ESM + TS 项目零配置、复杂度更低,但 Jest 在招聘市场认知度更高、资料更多,用户明确选择 Jest,需额外配置 `ts-jest`(或等价 ESM 转译方案)以支持纯 ESM |
