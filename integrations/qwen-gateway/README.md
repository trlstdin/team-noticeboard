# 本机千问 API 网关

使用 Node 内置 HTTP 客户端直接调用已经安装的 Ollama 千问，不依赖智能体框架或模型 SDK。站点仍使用现有 Sites、原私密存储和权限体系。完整交接见 [HANDOFF-AI-EMBEDDING.md](../../HANDOFF-AI-EMBEDDING.md)。

## 启动

1. 启动已有 Ollama，保持仅监听 `127.0.0.1:11434`，确认 `/api/tags` 中存在 `qwen3-vl:4b`。
2. 在仓库之外的私密目录保存配置，参照 config.example.json。token 为随机生成的 32 字节十六进制值；后端 `QWEN_GATEWAY_HASH` 仅保存其 SHA256。绝不能把实际配置、配对码或 token 提交 Git。私密目录仅允许运行账户和系统读取。
3. 使用 Node 24 或更新版本：`node gateway.mjs /private/path/gateway.json`。Windows 示例：`node E:\xxm\team-noticeboard-agent\release\gateway.mjs E:\xxm\team-noticeboard-agent\release\state\gateway.json`。
4. 实际地址写入配置同目录的 endpoint.json；只监听系统分配的本机回环端口。进程没有注册系统服务或开机启动项。

## 本机 API

`GET /health` 返回运行状态。其余 API 使用 `Authorization: Bearer <私密 token>`：

- `GET /v1/models`：提供模型别名 `qwen-local`。
- `POST /v1/chat/completions`：OpenAI 兼容文本请求，`model: qwen-local`、`messages`、可选 `response_format: {type: json_object}`；当前不支持流式和工具执行。
- `POST /gateway/probe`：发起/读取公网固定文本检查，每个北京时间自然日最多创建一次，计入模型额度，不读取业务事项。

实际 API URL 位于指定机器的 endpoint.json，`127.0.0.1` 不是其他机器可直接访问的公网地址。告示板通过下述拉取队列使用网关，无需访问该回环地址。

## 公网任务通道

统一前缀 `https://team-noticeboard-rebuilt.loneivy1.chatgpt.site/api/points/gateway/`；全部 POST，鉴权 `Authorization: Gateway <token>`：

| 接口 | 用途 |
| --- | --- |
| heartbeat | 报告本机模型就绪，每30秒；90秒无心跳视为离线 |
| claim | 领取有权限发起人提交的任务，返回 requestId 和临时 leaseToken |
| renew | 延长90秒租约；本机每25秒续约 |
| result | 按请求及租约回传结果；重复回传幂等 |
| probe | 固定文本连通性检查，只允许固定输出，不接受自定义提示 |

站点不接受网关的任意账本、审批或任务编辑请求。请求人会话只在站点使用 DATA_KEY 加密保存，网关仅接收该次主动提交的任务上下文，不获得应用身份。领取和回传时重新校验权限、规则版本和事项指纹。

## 恢复与运维

- active-job.json 保存领取及结果检查点；网络断开按5–30秒退避重试。已经取得结果时只重发回执，不重复推理。
- 推理中进程异常退出后，不猜测上次推理是否完成；恢复时回报失败，由用户明确重试。远端领取租约过期可重新派发，系统不承诺分布式模型推理恰好执行一次，但旧租约不能覆盖新结果。
- 单次推理最多10分钟，站点任务1小时截止。任务可撤回；回传旧内容、撤权或取消后结果不能生效。
- 不删除未知锁文件或终止未知进程。检查 gateway.lock/owner.json 的 PID 与 gateway.mjs 命令行，确认属于本实例再操作。
- Ollama、电脑和网关须保持运行；休眠、断网或退出后不能继续处理新任务。没有在用户电脑增加公网监听、隧道或系统服务。
- 凭据轮换：在私密配置生成新随机 token，更新后端公开 SHA256，走原发布链路后重启本实例。旧 token 失效；不要修改 DATA_KEY。

自动测试使用替身覆盖原生及解释执行后端；真实千问/公网验收单独记录在交接文档，不把替身当作真实模型成功。
