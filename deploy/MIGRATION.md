# 后端脱离 Sites：部署与切换状态

本仓库新增 Node24 服务、SQLite存储、容器镜像构建与可选自托管runner发布。未修改线上业务数据或切换后端。

## 已验证

- 原 Worker API 在 Node 服务运行，HTTP health=200、session=200、HttpOnly cookie及会话恢复正常。
- SQLite保留对象值、etag、并发条件写和重启持久性。
- 35项测试通过。

## 自动发布

提交相关后端文件到main后，`backend-image.yml`使用仓库自带GITHUB_TOKEN构建并推送 ghcr.io/trlstdin/team-noticeboard:提交SHA。无需每位AI连接Sites。

在你控制的长期在线Linux服务器上一次性安装Docker、注册GitHub官方self-hosted runner并加标签`noticeboard-production`。部署目录`/opt/noticeboard`中放置compose.yml及仅主机可读的.env。反向代理提供HTTPS到127.0.0.1:3000。配置仓库变量PRODUCTION_RUNNER_ENABLED=true后，后续提交自动发布到该runner；默认不开启，避免在没有生产主机时假装部署或永久排队。

runner对仓库写入者开放生产代码执行，仅注册在专用主机，不要未经确认把个人日常桌面作为生产runner。不要放开PR或不可信fork的runner执行。

## 数据迁移前置

必须从旧站完整导出R2对象（journal、auth、sessions、device-login）和原DATA_KEY。Sites环境读取接口会遮蔽DATA_KEY和BOARD_SYNC_KEY；目前本环境没有可用明文，不能通过生成新密钥替代。绝不能只用公开board-data快照当作完整迁移。

在迁移目标准备好后，通过旧后端总主管身份执行受保护的完整导出，私密传输到目标，停写/冻结旧站后最终增量同步并校验对象、版本、历史、账号解密和会话。确认无误再切换前端apiBase、GitHub登录回调与同步workflow目标；保留旧站回滚，不删除旧数据。

## 运行变量

DATA_KEY=旧站原密钥（必须保留）
BOARD_SYNC_KEY=原同步密钥（若继续使用）
PUBLIC_URL=https://实际后端域名/
FRONTEND_URL=https://实际前端域名/
PUBLIC_ORIGIN=https://实际前端域名
GITHUB_CLIENT_ID=Ov23liS0697dsfZdr4JL
GITHUB_ORGANIZATION=alistrode
ROOT_GITHUB_ID=215798043

以上仅为变量名称及公开值。不要将实际密钥提交到仓库或镜像。无客户端应用Secret或临时ADMIN_TOKEN。

## 尚缺且不能虚报

尚无已授权的生产目标主机/HTTPS域名，未注册生产runner，未完成原私密R2及密钥导出，未切换流量。因此镜像构建完成也不等于后端迁移完成。
