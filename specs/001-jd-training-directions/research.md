# Phase 0 Research: JD 结构化提取与候选训练方向推荐

## 1. LLM structured output 机制

**Decision**: 使用 OpenAI 官方 `openai` npm SDK 自带的 `zodResponseFormat`(位于
`openai/helpers/zod`),直接把已有的 Zod schema 转换成 Structured Outputs 所需的
JSON schema 传给 `chat.completions.parse(...)`;拿到响应后再用同一个 Zod schema 对
`message.parsed` / 原始 JSON 做一次 `.parse()` 校验,双重保险后才写入图状态。

**Rationale**: `zodResponseFormat` 是 `openai` SDK 自带的 helper,不需要额外安装
`zod-to-json-schema` 之类的第三方转换库,天然满足 Constitution I("LLM structured
output 必须有对应 Zod schema,原始输出禁止未校验直接下游使用")且不增加清单外依赖。

**Alternatives considered**:
- 手写 JSON schema + 单独维护对应 Zod schema:两份 schema 容易漂移,且没有必要,
  因为 SDK 已经提供了从 Zod 生成的路径。
- 用 function calling / tool call 而非 `response_format`:效果等价,但 Structured
  Outputs(`response_format: {type: "json_schema", strict: true}`)对"必须严格匹配
  schema"这一点保证更强,更贴合"理由必须可追溯、字段必须完整"的验收标准。

## 2. Postgres 客户端

**Decision**: 使用 `drizzle-orm`(运行时,基于 `node-postgres` 驱动)+
`drizzle-kit`(开发期 schema/migration 工具),不使用裸驱动手写 SQL。

**Rationale**: 从纯实现复杂度看,两张表、一次事务性写入的规模用裸驱动 `pg` 本可以
更省事;但这是一个求职/学习项目,用户明确希望借机练习 schema-as-code、类型安全
query builder、migration 工作流这套目前招聘市场里更常被提及的技能组合,因此采用
Drizzle —— TS 里定义 `schema.ts`,表结构变更时查询的 TS 类型自动同步,`drizzle-kit`
负责生成/执行 migration,不需要再手写 SQL 迁移文件。

**Alternatives considered**:
- 裸驱动 `pg`:实现更简单、依赖更少,是"最小化实现路径"的选择,但不满足用户对
  这个项目应该顺带练到 ORM 工作流的学习目标,故不采用。
- Prisma:同样提供 schema-as-code 和 migration,但需要独立的 codegen 步骤和运行时
  引擎,链路比 Drizzle 更重;Drizzle 更贴近"薄封装 + 直接映射 SQL"的风格,与项目
  当前"不引入不必要抽象"的整体倾向更接近。

**已与用户确认**:选定 Drizzle。

## 3. 测试框架

**Decision**: 使用 Jest(纯 ESM 项目需配合 `ts-jest` 的 ESM 预设,或等价的
`NODE_OPTIONS=--experimental-vm-modules` 方案)。

**Rationale**: 单纯从"对纯 ESM + TS 项目零配置"这一点看,Vitest 更省事;但用户从
求职/学习角度出发,认为 Jest 生态最成熟、招聘方认知度最高,面试被问到"你用什么测试
框架"时是更"安全"的默认答案,因此选择 Jest,愿意承担额外的 ESM 转译配置成本 ——
这份配置本身也是值得在学习项目里踩一遍的坑。

**Alternatives considered**:
- Vitest:对当前纯 ESM 技术栈零配置、运行更快,mock/spy API 与 Jest 高度兼容,是
  更"顺"的技术选择,但认知度/招聘市场熟悉度不如 Jest,故未采用。
- Node 内置 `node:test`:足够轻量,但生态插件(覆盖率、mock 能力等)和招聘市场
  认知度都不如 Jest。

**已与用户确认**:选定 Jest + `ts-jest`(ESM 预设)。

## 4. LangGraph 状态图形状

**Decision**: 单一状态图,4 个阶段:
1. `extractJdStructure`(节点):一次 LLM 调用,输出 `{role, techStack[], seniority,
   seniorityInferred, sufficient, insufficientReason?}` —— 充分性判断
   (FR-011)直接作为提取结果的一个字段,由同一次 LLM 调用给出,而不是额外套一层
   启发式规则。
2. 条件边:`sufficient === false` → 直接进入 `rejectInput` 终止节点,返回 FR-011
   要求的拒绝提示,不再消耗第二次 LLM 调用。
3. `generateCandidateDirections`(节点):第二次 LLM 调用,输入为结构化提取结果 +
   **JD 原文全文**(不能只传摘要,否则理由无法追溯到原文用词,违反 FR-006),输出
   0~6 个候选方向(允许 <3,不允许 >6,FR-005/FR-012)。
4. `persistSubmission`(节点):在单个数据库事务内写入 JD 提交记录 + 候选方向列表
   (FR-013),返回给路由层用于响应。

**Rationale**: 每个节点单一职责、可独立 mock LLM/DB 测试(Constitution II);把
"是否充分"的判断内建在提取节点里,避免为一个简单的布尔字段单独建一个节点或一次
额外的 LLM 调用,符合"不为假设中的复杂度做设计"的原则。

**Alternatives considered**:
- 用一次 LLM 调用同时完成提取 + 方向生成:减少一次往返,但会导致"信息不足时被
  拒绝"和"信息充分但稀疏时返回 <3 个方向"这两条分支逻辑全部耦合进一次生成里,
  测试和 prompt 都更难维护;拆开后各自的失败模式(拒绝 vs. 数量不足)边界更清晰。
- 用独立的规则引擎判断"是否充分":JD 文本的语言/结构千变万化,规则引擎难以泛化,
  且引入了清单外的新组件;交给 LLM 在同一次提取调用里判断更简单可靠。

## 5. 候选方向数量下限的边界处理

**Decision**: 沿用 spec 现有 Assumptions 中已经做出的默认判断 —— 一旦 FR-011 判定
"信息充分"(即角色/技术栈可识别),`generateCandidateDirections` 节点最少返回 1 个
方向;0 个方向的情况只应发生在 FR-011 直接拒绝的分支,不会出现"充分但一个方向都
生成不出来"的中间态。

**Rationale**: spec 的 Assumptions 部分已经对这一模糊点做了说明并标注"如与预期不符
可通过 `/speckit-clarify` 调整",这里不重新引入新的未决问题,只是在实现层面明确
"充分性判断"和"数量下限"是同一个阈值的两侧,避免图里出现无法归类的第三态。

**Alternatives considered**: 无 —— 这是对 spec 既有假设的技术落地,不是新的设计
决策分支。
