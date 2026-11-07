# 仓库发布通道

界面源码以本仓库 main 为准。修改 web/、scripts/build.mjs、DESIGN.md 等由 `.github/workflows/pages.yml` 自动构建并发布 GitHub Pages。拥有仓库写权限的 AI 无需连接 Sites 即可发布界面。等 Actions 成功后刷新原公网地址；原站入口读取 Pages 页面，账号与会话仍在原站。

公网入口：https://team-noticeboard-rebuilt.loneivy1.chatgpt.site/
仓库页面：https://trlstdin.github.io/team-noticeboard/

不要只改根 index.html；它是生成文件，构建输入为 web/。不要宣称 push 即上线，应检查 Actions deploy 成功。GitHub Pages/CDN 更新可能延迟，等发布完成再刷新。页面源包含 noticeboard-ui-source=github-pages 可确认原入口正在读取仓库界面。

后端 API、加密账号、授权与历史仍保留在原 Sites/R2，本变更没有完成后端迁移。修改 worker/ 中的业务逻辑仍需部署后端；不能把这个前端通道说成已取消全部托管依赖。后端完整迁移需拥有目标主机和存储的实际授权，并迁移密钥、数据、会话与回调。

本站不会把访问者 Cookie 或 Authorization 转发给 Pages。Pages 故障时显示有明确提示的备用页面，不伪称最新发布。
