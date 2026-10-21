# 版本核对记录

核对日期：2026-10-21。本次只纠正本地版本元数据及说明，不发布、不安装、不修改旧客户端或用户数据。

## GitHub 与本地对应关系

| 位置 | 核对结果 |
| --- | --- |
| GitHub 最新正式 Release | [v0.21.1](https://github.com/cainiao47/classmate-lilith/releases/tag/v0.21.1)，2026-10-03 发布，含 Windows/macOS 便携包，不含 EXE 安装器 |
| GitHub 主分支 | `dc377b8230acc697961e4484c8bad66c147cc1e7`，`package.json` 为 `0.21.1` |
| GitHub 历史正式版本 | `v0.18.0` 已于 2026-10-02 发布，不可复用该编号发布不同程序 |
| D 盘现有客户端 | `D:\Classmate-Lilith-Windows-x64\Classmate-Lilith-Windows-x64\package.json` 为 `0.21.1`；保持不变 |
| 本地开发源码 | 本轮安装、更新与讲座成稿开发此前误用 `0.18.0`，现统一为 `0.22.0`，未发布 |
| 本地旧构建产物 | `dist/windows-0.18.0/` 保持原样，不能改名或用于覆盖 v0.21.1 |

依据：[最新 Release API](https://api.github.com/repos/cainiao47/classmate-lilith/releases/latest)、[主分支 package.json](https://github.com/cainiao47/classmate-lilith/blob/main/package.json)、[源码基线差异](https://github.com/cainiao47/classmate-lilith/compare/776a0f9...dc377b8230acc697961e4484c8bad66c147cc1e7)。核对时 `refs/tags/v0.22.0` 不存在。新增安装、应用内更新属于功能版本，所以下一个开发版本使用 `0.22.0`，不冒充已发布的 `0.21.1`。

## 不是只改数字就能安全升级

本地开发基于 `776a0f9`（v0.17.0），GitHub 此后还有三个提交：

- `b342079`：v0.18.0 独立桌面窗口。
- `76fcc9c`：v0.21.0 可靠性与安全修订。
- `dc377b8`：v0.21.1 项目历史改进。

这些改动尚未整合进本地安装版开发线。仅提高版本号不会自动带回窗口、历史管理与其他修订，故本次不重新打包、不推送标签，也不宣称覆盖升级已可用。

## 正式发布前检查

1. 合并 GitHub v0.21.1 后续改动，保留本轮安装、更新和学术讲座整理功能；按用户既定边界处理令牌、Origin/WebSocket 鉴权及 API 存储相关差异。
2. 使用隔离副本验证 v0.21.1 便携版数据迁移，以及独立窗口、历史、录音路径、设置和安装版升级；不要在用户原数据上试验。
3. 从合并后源码构建 v0.22.0 便携包与安装器，重新生成校验文件和签名更新清单；不能重命名旧 EXE/ZIP 或复用旧签名清单。
4. 发布前重新核对 GitHub，避免期间出现新版本导致编号冲突。本轮不构建或发布 macOS。
