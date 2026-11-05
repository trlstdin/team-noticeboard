## 2026-11-06 主管免登录链接补充

总主管可在权限管理签发免登录主管链接，使用现有受信 GitHub 身份会话，打开链接直接恢复主管权限，无需交互登录。链接最长14天且不超过来源身份有效期。未授权访客只可查看第一页；第二、第三页入口隐藏，服务端不返回账号、用户或授权链接数据。

# 当前权限与部署记录

更新日期：2026-11-06（Asia/Shanghai）。

公网主入口：https://team-noticeboard-rebuilt.loneivy1.chatgpt.site/

GitHub Pages 保留为镜像。远端 Edge 实际访问 Pages 曾返回 ERR_CONNECTION_CLOSED，因此登录返回和签发链接统一指向上述公网主站。

## 权限规则

- 总主管为 GitHub 数字 ID `215798043`（账号 `trlstdin`），身份必须由 GitHub 返回并核对。
- `alistrode` 的 active 组织成员可编辑所有项目，项目仓库属于谁不影响这条规则。其他组织成员、个人仓库所有者、仓库 push/maintain/admin 权限不会独立授予权限。
- 其他 GitHub 用户只读；另行签发的专属链接按用户角色、项目范围和 copy/edit/manage 明确授权执行。
- 管理后台支持修改已有链接的名称和范围；已打开会话每次请求重新读取链接授权，撤销即时生效。
- 未赋予平台登录头、邮箱或客户端自报角色任何主管权限。

## 登录与会话

复用 trlstdin 已注册的 Team Noticeboard 应用，采用 GitHub 官方设备授权。不生成或使用应用 Client Secret，不保留应用登记入口。公开应用标识随源码保留，无需用户保管密钥。

临时 ADMIN_TOKEN 入口和旧 admin 类型会话已从授权代码中移除，生产环境对应变量也已删除。主管通过 GitHub 账号登录；专属链接仍保留用户设计的范围授权。alistrode 成员仅按编辑权限处理，你的指定账号具备主管管理权限。

站点使用 14 天不透明会话，GitHub 用户凭据仅在服务端加密保存。读请求短时缓存成员查询，写请求重新核对。没有有效会话时进入 GitHub 授权流程；GitHub 已登录状态由 GitHub 自己复用，不读取 github.com Cookie。首次或过期后的授权仍需 GitHub 页面确认。

每个登录页使用独立 HttpOnly 临时 Cookie 与服务端绑定，多个标签页或窗口不会覆盖彼此。原先单个临时 Cookie 会导致“登录会话不匹配”，已修复并加入回归检查。前端请求等待时间由 7 秒调整为 30 秒，以适应真实身份查询延迟。

GitHub 要求组织所有者确认应用对 alistrode 的组织访问时，会弹出账号密码确认。这是 GitHub 的安全步骤，不是应用 Secret；助手没有读取、代填或猜测密码。组织访问现已放行。远端浏览器实际调用成员接口返回 GitHub 200、organization=alistrode、member=true、role=admin；实际授予 OAuth scope 仅为 read:org、read:user。没有读取或代填密码，没有生成应用 Secret。

## 存储与同步

新项目：`appgprj_6aec63d8c2688191b924e400030188b1`。

恢复了公开快照版本 22 与 22 条公开历史；旧站公开接口同为版本 22，活动项目和事项为空。原项目保留。旧项目私密记录与原 R2 全量状态未迁移，不把公开恢复记录写成完整备份。

内容同步使用固定本仓库、main 和指定工作流的 GitHub Actions OIDC，服务端验签；版本 22 已确认入库。DATA_KEY 保持新项目原值，未在代码、文档或日志中记录值。

## 当前代码检查与实测边界

24 项针对性检查通过，包含组织固定为 alistrode、跨项目编辑、非成员只读、仓库权限不提权、指定主管映射、链接权限即时调整、旧主管入口失效、设备授权无应用 Secret、多窗口登录互不覆盖、重复换取令牌的并发保护，以及同步身份限制。构建与生成 Worker 语法检查通过。

最新 Worker 保存版本 13，源码 `430efddfd93866014876028546b1f4863ba6c3bd`，部署 `appgdep_6aecc9f0b60481918bc3f2829f60e643` 已成功。

远端 5.6 连接已建立并记住设备，官方 gh 客户端实际返回账号 trlstdin 与上述数字 ID。早期临时主管会话曾在浏览器显示编辑和权限管理；该入口现已撤除。GitHub 曾实际显示设备连接成功，但旧版返回页遇到多窗口 Cookie 冲突，因此该历史结果不作为当前权限完整完成的依据。最新远端浏览器已实际显示 trlstdin、编辑模式、权限管理和新建项目可用；重新打开独立浏览器窗口后，这些权限仍由 Cookie 恢复。通过浏览器 Cookie 请求 /api/state 返回 signedIn=true、githubId=215798043、root/edit/manage 均为 true。/api/github/membership 最终实测返回 organization=alistrode、githubStatus=200、member=true、role=admin，组织访问已放行。该实测使用你的账号；其他成员及非成员的角色边界由针对性检查覆盖，没有冒称已用其他真实账号逐一登录。
