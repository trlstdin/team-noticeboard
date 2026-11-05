# GitHub 登录与链接权限发布说明

此改动提供 `/auth/github`、`/auth/github/callback` 和 `/api/auth/config`。
前端在服务端报告 OAuth 已配置且当前身份为匿名时自动跳转一次；主动退出后本标签页不会立即重新登录，可从原授权按钮选择 GitHub 登录。有效专属链接仍按独立授权生效。

GitHub 普通用户只有组织成员才能取得组织项目编辑权限，外部协作者即使拥有 push、maintain 或 admin 权限也只读。个人仓库所有者保留主管身份。总主管通过服务端 `ROOT_GITHUB_ID`（优先）或 `ROOT_GITHUB_LOGIN` 与 GitHub 验证身份匹配；不依据 URL 用户名或前端字段授权。

后台每条有效链接新增权限编辑，可调整名称和 copy/edit/manage 范围，空范围表示停用全部能力；已撤销链接不可重新启用。已有会话每次请求重新读取链接范围。修改管理链接仅总主管可执行。

## 发布顺序

1. 恢复 `.openai/hosting.json` 指向的原 Sites 项目访问，保留 audience、R2、DATA_KEY 和其他已有配置，不能新建空项目代替。
2. 复用已有 GitHub OAuth App，回调设置为 `https://team-noticeboard-trlstdin.taproom-61-rumples.chatgpt.site/auth/github/callback`。在 Sites 配置 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`，不写入 Git。
3. 确认总主管账号后，以其 GitHub 数字 ID 配置 `ROOT_GITHUB_ID`。当前公开 API 返回 trlstdin 的 ID 为 `215798043`，但该记录不是变更主管配置的确认。
4. 保持 `PUBLIC_ORIGIN=https://trlstdin.github.io`、`FRONTEND_URL=https://trlstdin.github.io/team-noticeboard/`。
5. 先构建并发布 Worker，确认 OAuth 配置与回调，再合并发布 GitHub Pages，避免前端调用旧后端。
6. 使用实际 GitHub 登录检查主管、成员、非成员和链接权限调整；不要往生产添加示例数据。

## 已执行检查与限制

`node --test tests/permissions.test.mjs`：14 项通过；`npm run build`、生成 Worker 语法检查、`git diff --check` 通过。
新增检查覆盖非成员拥有仓库管理权限仍只读、GitHub 数字 ID 主管映射、已有会话随链接范围即时变化、OAuth Cookie/state 匹配与一次使用、凭据加密。

当前 Sites 的 get_site 和源码写凭据接口均返回 project_not_found。因此此记录不代表已部署，也不代表真实 OAuth 往返已验收；恢复项目访问并完成 OAuth 配置后才能发布。未改动样式、布局或生产数据。
