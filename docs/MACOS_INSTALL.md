# macOS 安装与首次打开

当前 macOS 预览版面向 Apple Silicon（M 系列芯片），采用免费临时签名，不经过 Apple Developer ID 签名或公证。

## 安装

1. 从 GitHub Releases 下载 `Classmate-Lilith-macOS-arm64.zip`，不要下载仓库的 Source code ZIP。
2. 双击 ZIP 解压，得到 `Classmate Lilith.app`。
3. 将应用拖入“应用程序”文件夹。
4. 双击尝试打开一次。如果 macOS 阻止运行，关闭提示窗口。
5. 打开“系统设置”>“隐私与安全性”，滚动到“安全性”，点击与 Classmate Lilith 对应的“仍要打开”。
6. 输入 Mac 登录密码并确认。此后可以像普通应用一样双击打开。

Apple 通常只在第一次失败启动后的一段时间内显示“仍要打开”。官方说明：https://support.apple.com/guide/mac-help/mh40616/mac

## 运行与退出

启动后，Classmate Lilith 会显示独立的应用窗口和 Dock 图标，工作台直接在应用内打开，不再跳转到浏览器。屏幕顶部菜单栏仍保留快捷入口，可用于重新显示窗口、打开日志或完全退出应用。

关闭主窗口不会停止本地服务。可以点击 Dock 图标或菜单栏图标重新显示窗口；需要完全退出时，按 `Command-Q`，或从菜单栏选择“退出并停止服务”。如果后台服务无法启动，应用窗口会直接显示错误、重新尝试和日志入口。

第一次使用实时录音时，macOS 会询问麦克风权限。请选择“允许”；之后可以在“系统设置”>“隐私与安全性”>“麦克风”中修改授权。

## 数据位置

- 设置、API Key、历史任务和录音：`~/Library/Application Support/Classmate Lilith/data`
- 日志：`~/Library/Logs/Classmate Lilith`

替换或删除 `.app` 不会自动删除这些数据。彻底卸载时，可以在删除应用后手工删除上述两个 Classmate Lilith 文件夹。

## 安全说明

未公证意味着 Apple 没有验证开发者身份或扫描此构建。只应从项目自己的 GitHub Release 下载，并对照 Release 中的 SHA-256 校验值。不要关闭整个系统的 Gatekeeper，也不要使用来源不明的终端命令绕过安全保护。
