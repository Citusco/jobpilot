# JobPilot — Live Coding Training Generator

## Bash commands
- npm run dev: 启动本地开发服务器
- npm run test: 跑单元测试
- npm run typecheck: TypeScript 类型检查
- npm run lint: ESLint 检查

## Tech stack (不要引入未列出的库,先讨论)
- Backend: Node.js + TypeScript + Fastify
- Orchestration: LangGraph.js
- Vector store: pgvector (in Postgres)
- Data pipeline: AWS (S3 + EventBridge + Lambda + Step Functions + DynamoDB)
- Sandbox: Judge0 (自托管)

## LLM 调用(当前阶段)
直接调用 provider SDK(OpenAI / Bedrock)即可,不需要绕行任何网关。
未来会迁移到 Agent Forge 网关统一管理路由与预算,但当前阶段不做强约束——
先把业务逻辑跑通,迁移网关是后续一次独立的重构任务。

## Code style
- ES modules (import/export),不用 CommonJS
- Zod 做运行时校验,LLM structured output 必须有对应 Zod schema

## Testing
- 新功能必须有对应测试才算完成
- LangGraph 节点单独测试,mock 掉 LLM 调用,不要在单测里打真实 API
- 涉及新逻辑的测试,优先请求 test-reviewer subagent 做独立审查(避免实现者自己写测试自己判卷)

## Workflow(Spec-Driven Development)
本项目用 GitHub Spec Kit 管理开发流程,核心循环:
  /speckit-constitution(仅一次)→ /speckit-specify → /speckit-plan → /speckit-tasks → /speckit-implement
- 涉及数据库 schema、LangGraph 状态图设计、云资源改动的任务,必须走完整 SDD 流程
- 样式调整、日志格式修改等小改动,直接 Explore → Implement → Verify 即可,不必走全套
- 每个 spec 对应一个 feature branch 和一个 PR,不直接在 main 上改
- 完成后必须跑 typecheck + lint + test 全部通过才算完成
- 如果这次任务涉及新的技术点/踩坑,完成后提示我是否要生成学习笔记
