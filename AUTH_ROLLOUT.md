# 登录与链接权限重建记录

2026-11-05：按用户要求重建后端。新项目 `appgprj_6aec63d8c2688191b924e400030188b1`，服务地址 https://team-noticeboard-rebuilt.loneivy1.chatgpt.site 。原项目保留。

功能：GitHub OAuth 自动登录、经 GitHub 验证的数字 ID 主管映射、非组织成员只读、已有专属链接的权限调整。专属 Token 授权独立生效。GitHub 仓库拥有者身份及明确配置的总主管保留管理权。

总主管映射为 trlstdin（GitHub ID 215798043），与当前仓库已授权 GitHub 账号一致。新的主管会话可恢复后台访问；不在仓库中记录凭据。

若缺少 OAuth 应用配置，主管可在原登录按钮中选择“启用 GitHub 登录”，由 GitHub 确认应用登记，服务器校验回调 state、浏览器 Cookie、一次性状态及应用所有者后，将登录凭据加密保存到 R2 `config/github-oauth`。已有环境变量凭据优先，不重复登记已配置的应用。首次登记和授权仍需 GitHub 账号本人确认。确认前不能宣称 GitHub 登录已完成。

新存储恢复了仓库公开快照版本 22 及全部 22 条公开历史。旧站 GET /api/state 确认同为版本 22，活动项目和事项为空。旧站私密账号、用户、凭据、会话及未公开归档对象未迁移，原项目仍保留；不得把这写成完整 R2 备份。

Worker v2 已成功部署（部署 appgdep_6aec877dca408191a0a1ccc5119bdacc，源码 793987d3bbdd4f9d3282323eabb129580857e7f6）。Pages 从 main 独立发布，实际状态以对应 Actions 结果为准。BOARD_SYNC_KEY 在新 Worker 和 GitHub Actions 两侧同步配置，DATA_KEY 为新项目独立密钥。

验证：15 项权限检查通过，包括 OAuth 回调防重放、应用所有者核对、凭据加密、非成员拥有仓库管理权限仍只读、主管映射、已有会话权限即时变化。构建和 Worker 语法检查通过。公开 API 返回 HTTP 200，历史版本 22。实际 GitHub 浏览器往返需账号本人完成，未完成前保留此验证边界。未改配色或布局。
