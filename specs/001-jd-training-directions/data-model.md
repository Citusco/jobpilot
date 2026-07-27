# Phase 1 Data Model: JD 结构化提取与候选训练方向推荐

## 实体总览

对应 spec 的 Key Entities:JD 提交记录(JD Submission)、候选训练方向(Candidate
Training Direction),一对多关系(一次提交 → 3~6 个,或信息稀疏时更少个,方向)。

## JD Submission (`jd_submissions` 表)

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | 供 FR-013 未来引用 |
| `raw_text` | `text` | NOT NULL | 原始 JD 文本,理由追溯(FR-006)依赖此字段 |
| `role` | `text` | NULL | 提取出的职位角色;被拒绝的提交此字段为 NULL |
| `tech_stack` | `text[]` | NULL | 提取出的技术栈列表 |
| `seniority` | `text` | NULL | 提取或推断出的职级(初级/中级/高级/资深) |
| `seniority_inferred` | `boolean` | NOT NULL, default `false` | 对应 FR-010,标注职级是否为推断而非原文明示 |
| `status` | `text` | NOT NULL, CHECK IN (`'accepted'`, `'rejected'`) | 对应 FR-011 的拒绝分支 |
| `rejection_reason` | `text` | NULL | 仅 `status = 'rejected'` 时填充 |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**校验规则**(应用层,写库前已由 Zod 校验通过):
- `status = 'rejected'` 时,`role` / `tech_stack` / `seniority` 均为 NULL,
  `rejection_reason` 必填(FR-011)。
- `status = 'accepted'` 时,`role`、`tech_stack`(至少 1 项)必填;`seniority` 必填,
  且 `seniority_inferred` 需与提取节点的判断一致(FR-010)。

**状态转换**:仅有单次写入,无后续状态变更(本 feature 范围内不支持编辑/重新提交,
FR-009 明确出题环节不在本 feature 范围)。

## Candidate Training Direction (`candidate_training_directions` 表)

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | |
| `jd_submission_id` | `uuid` | NOT NULL, FK → `jd_submissions.id` ON DELETE CASCADE | 关联所属提交(FR-013) |
| `name` | `text` | NOT NULL | 方向名称 |
| `rationale` | `text` | NOT NULL | 推荐理由,MUST 含可核对的 JD 原文引用(FR-006) |
| `tags` | `text[]` | NOT NULL, 至少 1 项 | 描述性标签(FR-007) |
| `suggested_question_count` | `integer` | NOT NULL, CHECK > 0 | 建议题目数量(FR-008) |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**校验规则**:
- 同一 `jd_submission_id` 下的记录数 ∈ [0, 6];当所属提交 `status = 'accepted'`
  时应 ≥ 1(见 research.md §5 的边界处理决策);当 `status = 'rejected'` 时应为 0
  (数据库层面用应用逻辑保证,不额外加 CHECK 触发器,避免过度设计)。
- `rationale` 字段只做非空校验;"是否真的可追溯到原文"由 SC-002 的人工抽查保证,
  不在数据库层做语义校验。

## 数据库层实现方式

以上两张表在 `src/db/schema.ts` 中用 `drizzle-orm/pg-core` 的 `pgTable(...)` 定义
(而非手写 SQL DDL);表结构变更时,`drizzle-kit generate` 自动生成对应 migration
文件到 `src/db/migrations/`,`drizzle-kit migrate` 负责执行。查询层直接使用
Drizzle 从 schema 推导出的 TS 类型,不再单独维护一份手写的行类型定义(选型理由见
research.md §2)。

## 对应的 Zod Schema(LLM I/O 边界,Constitution I)

### `jdExtraction.schema.ts`

```ts
extractionResultSchema = z.object({
  sufficient: z.boolean(),
  insufficientReason: z.string().optional(), // sufficient=false 时必填,用 refine 校验
  role: z.string().optional(),
  techStack: z.array(z.string()).optional(),
  seniority: z.string().optional(),
  seniorityInferred: z.boolean().optional(),
})
```

### `candidateDirections.schema.ts`

```ts
candidateDirectionSchema = z.object({
  name: z.string(),
  rationale: z.string(),
  tags: z.array(z.string()).min(1),
  suggestedQuestionCount: z.number().int().positive(),
})

candidateDirectionsResultSchema = z.object({
  directions: z.array(candidateDirectionSchema).max(6),
})
```

两个 schema 均通过 `zodResponseFormat`(见 research.md §1)注入 OpenAI Structured
Outputs 请求,响应回来后用同一 schema `.parse()` 二次校验。

## 与 Fastify 响应 DTO 的关系

路由层响应体直接复用上述 Zod schema 推导出的 TypeScript 类型
(`z.infer<typeof ...>`)拼装,外加数据库生成的 `id` / `createdAt`,避免维护第三份
重复的类型定义。
