# 告示板千问接入交接

## 目标与实现

项目 `trlstdin/team-noticeboard`，业务代码在 main。沿用现有公网入口：

https://team-noticeboard-rebuilt.loneivy1.chatgpt.site/

使用指定 Windows 机器已经部署的 `qwen3-vl:4b`（Qwen3-VL 4B，Q4_K_M），由自写 Node 网关调用 Ollama HTTP API。无需智能体框架。网站继续运行原有动态后端，不在固定加载器中运行 Node 框架。

```text
网页提交建议 → 现有后端鉴权并保存任务
                         ↑ HTTPS领取/续约/回传
                 本机 API 网关 → Ollama → 千问
                         ↓
              后端结构与业务校验 → 等待人工审批
```

浏览器不持有模型凭据；电脑只主动访问现有公网 API，不增加公开端口或新 Site。网关同时提供鉴权的本机 OpenAI 兼容 API；本次运行的本机 API 基址为 `http://127.0.0.1:63716`，聊天接口为 `/v1/chat/completions`；重启可能换端口，以本机 `release/state/endpoint.json` 为准。公网任务入口为 `/api/points/gateway/`，它是受鉴权的任务协议，并非匿名聊天接口。

## 代码与运行位置

| 位置 | 职责 |
| --- | --- |
| worker/index.js | 原业务、积分规则、审批、直接模型客户端与千问任务队列 |
| worker/github-auth.js | 原身份认证，沿用现有权限 |
| web/points.js | 模型来源选择、异步状态、撤回、人工审批 |
| integrations/qwen-gateway/gateway.mjs | Node 原生 HTTP API、Ollama 调用、拉取/续约/回传、恢复检查点 |
| tests/qwen-gateway.test.mjs | 原生及 ES5 解释执行队列/权限/幂等测试、本机 API 测试 |
| POINTS.md / DESIGN.md | 原方案业务约束与验收说明 |

指定机器工作根目录：`E:\xxm\team-noticeboard-agent`。dev 是仓库工作副本，backups 保存修改前源代码归档，release 是运行网关，release/state 是私密配置、进程地址及检查点。该私密目录不进入仓库；交接不包含 token、配对码或应用会话。

本机已有 Ollama 位于 `E:\ruanj\Ollama\ollama.exe`，使用原模型目录，监听 `127.0.0.1:11434`。本次没有下载替代模型、修改其他应用、设置系统启动或替换现有站点身份。远程管理使用用户指定的 5.9 连接，后续复用已记住设备，勿重新配对或重置连接身份。

## 业务边界

这是非营利开源协作工具，按原方案使用统一积分账本；没有另外创造贡献币种或分开核算贡献系统。现有规则、认领、质量证据、CI、结算、公共沉淀、审计和更正流程保持原业务约束。

千问可提供规则调整、阻塞、质量区间建议；不能执行任意工具、读全站私密数据、批准建议或发积分。规则调整仅总主管可批准；事项建议按原项目主管权限审批。模型不确定或校验失败时保留失败记录，可人工补全或明确重试。

网关只用随机256位密钥的专用身份；后端保存公开 SHA256，不给它主管权限。发起人的应用凭据用原 DATA_KEY 加密留在原存储，领取和回传都复核权限。旧规则、旧事项、撤回、会话撤销或过期结果不能生效。固定连通性检查仅发送固定文本，每日最多一条且计入额度。

## 操作与恢复

启动方式、API 请求格式、租约及检查点恢复见 [网关说明](integrations/qwen-gateway/README.md)。选择“本机千问网关”可明确指定该来源；自动模式在没有更优先的既有接入且网关在线时选择千问。不要把“已配对”或 `/health` 存活当成真实推理成功。

运行需要电脑、Ollama 和网关持续在线。遇到断网先查看状态和原请求 ID，网关会退避恢复；不要删除 active-job.json 盲目重复推理。网络回执丢失会重发保存的结果；推理进程中断会标记失败，不自动假定成功。

## 发布与验证

先读 [PUBLISHING.md](PUBLISHING.md)。仅修改业务源文件，提交前运行 `npm ci`、`npm test`、`npm run build`。推送 main 后检查 `Deploy public noticeboard` 中 `Push backend release to Sites` 成功，再检查公网 `/api/state` 响应头 source=repository、revision 与发布包 sourceCommit 一致。禁止手改根 index.html 或 backend-release.json。

保持原数据、权限、密钥、DATA_KEY、固定加载器、托管绑定和环境变量。不得另建 Site。生成文件由原 Actions 提交。

## 验收记录

- 本地完整140项测试通过，包含7项新增千问网关测试；构建成功。
- 指定机器真实调用 qwen3-vl:4b，返回 `{"ok":true,"provider":"qwen"}`，实际用量45 tokens。
- 桌面/手机浏览器通过千问来源选择、异步连接检查、建议队列回传及人工审批；浏览器自动化中的模型传输为替身，与上条真实模型验证分别记录。
- 2026-11-10 07:28 UTC：公网固定文本任务 `e775bf5e-fd77-459f-89c8-f2b529c93ddc` 经网站入队、本机领取、真实千问推理、网站回传，最终 `status: completed`，结果 `{"ok":true,"model":"qwen3-vl:4b","source":"qwen-gateway"}`。
- 本机 `/v1/chat/completions` 使用 Bearer 鉴权实际返回 OpenAI 兼容响应，模型别名 qwen-local、输出 `{"ok":true}`，该次用量25 tokens。没有把 Ollama 的存在或测试替身当作 API 成功。
- [最终业务发布工作流](https://github.com/trlstdin/team-noticeboard/actions/runs/42775320845) 全部成功，包含 Push backend release to Sites。公网 `/api/state` 实测 `x-noticeboard-backend-source: repository`，revision=`593c6f23e37ff959a89b7f223ec99506d083e061`，与 backend-release.json 的 sourceCommit 一致。
- 公网验收后仍为原1个项目、22条事项；仅增加固定连接检查及相应私密工作流记录，没有添加业务示例事项或修改积分余额。
- 远端运行的 gateway.mjs SHA256 为 `aec71a1c07e7fc570a1873849040a00dd4f44c913aad489e778dc59402628f26`，与仓库源文件一致。
