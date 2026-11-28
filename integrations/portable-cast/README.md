# 独立盘投屏 → 公有账号

一个当前投屏 URL 对应一个账号，使用现有账号池、加密和授权；环境关闭后撤下对应账号。投屏发布使用绑定 sourceId 的独立机器凭据，不依赖主管登录会话。链接和会话只保存在独立盘私密状态及服务端加密存储，不提交仓库。

`noticeboard-sync.cjs` 是独立盘发布器源文件，安装于已有 `public-cast/` 模块同目录，复用其 `runtime/` 依赖。独立盘配置在 `state/public-cast/noticeboard-publisher.json`，权限 600；机器发布配置包含 enabled、sourceId、publisherCredential 和原环境 proxy。发布凭据在目标机随机生成并独立保存在同目录 noticeboard-publisher-key（0600），启动时加载，避免旧进程配置回写覆盖，服务端 CAST_PUBLISHERS 只登记对应的 SHA-256 摘要与 sourceId。旧版主管会话发布接口继续兼容。该配置含运行凭据，不得公开或提交。

投屏后台仅需实例化发布器，并在现有完整环境扫描后调用 `observe(rows)`。`start(row)` 接原有、按环境排队的启动操作，`link(row)` 只返回本管理器所属运行实例的链接；后台退出时等待发布器 `close()`。环境首次打开自动启动投屏；原实例内手动关闭投屏的指令不会被周期轮询覆盖。

服务端 `/api/cast/sync` 使用 X-Cast-Publisher-Key 验证已登记来源，凭据只作用于该来源的投屏发布。地址变化按 sourceId 与 environmentId 更新同一账号，保留原分配并撤下重复旧记录，URL 加密保存。正常关闭主动撤下；来源意外失联时，30 秒在线期限到期后不再显示或允许复制。心跳单独保存在原 R2，不追加每次心跳事件、不竞争告示内容的版本写入。账号页和权限页每 2 秒更新一次，原告示板刷新节奏不变。

发布沿用仓库 main → GitHub Actions → 原 Sites 加载器，无需 Sites 权限。源变更在 worker/index.js 和 web/app.js；不要手改生成页面或 backend-release.json。

发布器收到服务端成功确认后，将确认时间与账号 ID 写入同目录 noticeboard-sync-status.json。机器凭据不授予其他告示栏接口权限，公有账号的查看、复制与分配规则继续由原业务接口处理。
