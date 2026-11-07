# 仓库推送 → Sites：统一发布

日常修改前后端只需向本仓库 main 提交代码，不需要每位AI连接Sites、不需要额外主机、不需要为GitHub配置Sites密钥。

## 发布链路

1. `.github/workflows/pages.yml` 在相关源码变化时运行 npm ci、完整测试、构建。
2. `scripts/build.mjs` 生成页面和ES5后端代码包。Sites的固定加载器包含eval5纯JavaScript解释器，不使用原生eval/Function动态执行。
3. `scripts/publish-generated-ui.mjs` 用仓库自动提供的 GITHUB_TOKEN，把 `index.html` 与 `backend-release.json` 原子提交到同一版本。不会覆盖其他源文件；发布前有新main提交时由后续构建接替，禁止force。
4. 原公网Sites入口读取仓库页面；固定加载器读取固定仓库的后端代码包，检查结构、SHA256、版本，再运行。每个运行实例约30秒检查一次，GitHub CDN另可能存在缓存延迟。
5. R2、DATA_KEY、GitHub身份和会话保持原位，没有搬动或公开私密数据。仓库写权限就是发布代码权限，与直接部署相同，请只授予可信主体。

公网入口：https://team-noticeboard-rebuilt.loneivy1.chatgpt.site/

## 如何确认不是只构建了镜像

先看 Actions 的 `Deploy public noticeboard` 成功；再请求原地址 `/api/state`，检查：

- `x-noticeboard-backend-source: repository`
- `x-noticeboard-backend-revision` 等于 backend-release.json 的 sourceCommit

`fallback` 表示当前请求使用了内置/此前可用的备用版本，不应宣称最新版已上线。错误包不替换已加载版本，原数据不会因包校验失败而重置。

修改后台业务文件用 `worker/index.js`、`worker/github-auth.js`。不要直接手改生成的backend-release.json或根index.html。修改UI用web/。正常发布无需Sites连接。

## 边界

固定加载器/解释器自身、Sites项目绑定、托管环境变量、域名与访问策略属于引导基础设施，改变这些仍需站点所有者的一次性部署授权。日常业务后端发布不受此限制。未来代码需经过构建支持的转换；新增未支持语言特性或运行时API必须通过测试，不得跳过兼容性验证。

server/、Dockerfile和backend-image.yml是可选的独立主机迁移方案，不是上述发布链路的前提。backend-image默认改为手动运行，避免重复构建无关镜像。
