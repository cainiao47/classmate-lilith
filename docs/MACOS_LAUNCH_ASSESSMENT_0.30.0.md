# macOS v0.30.0 无窗口启动评估

评估对象：已发布的 `Classmate-Lilith-macOS-arm64.zip` 内实际二进制、Info.plist，以及对应 Swift 启动器和构建流程。用户环境为 M5 / macOS 27；用户补充：第一次打开时 Dock 有图标但无窗口，强制关闭后再次打开不再出现 Dock 图标。本机为 Windows，没有在该 Mac 上复现；本次不修改应用、不重新发布。

## 结论

发现一个应优先修复的启动链路缺口：应用没有主 Nib/Storyboard，也没有显式创建、持有并绑定 AppDelegate，却把所有初始化放在该代理的 `applicationDidFinishLaunching` 回调中。这与“运行后没有窗口、没有托盘或服务启动反馈”高度吻合。它是强证据的代码问题，但尚不能仅凭源码认定为用户机器上唯一的实际原因。

第一次出现 Dock 图标提高了“进程进入图形应用启动阶段但未建窗口”的可能性，更应优先检查代理注册和窗口初始化。图标出现不代表应用初始化成功，也不能完全排除之后被系统终止。强制关闭后的再次启动属于第二阶段现象，需要区分残留应用进程、重复启动请求转交旧进程但未显示窗口，以及新进程立即退出；不能在没有进程或崩溃记录的情况下把两阶段认定为同一原因。

重新打开处理也需要防御性修订：当前 applicationShouldHandleReopen 直接调用 showMainWindow，后者无条件访问隐式解包的 mainWindow。正常初始化完成后可以工作，但缺少“窗口尚未创建则先创建”的兜底。这里是风险点，尚不是已复现的崩溃原因。

## 已核对的事实

- Swift 类在第 28 行使用 `@main`，没有自定义 `static main()`，没有 `NSApplication.shared.delegate = ...` 或等效绑定。
- 应用自身 Info.plist 没有 `NSMainNibFile`/`NSMainStoryboardFile`；ZIP 中也没有该应用的主 Nib/Storyboard。Sparkle 自带的对话框 Nib 不是应用启动 Nib。
- 已发布二进制含 `NSApplicationDelegate` 默认 `main` 的调用符号，符合源码所示的默认 AppKit 启动路径；方法符号存在本身不代表代理被实例化或收到回调。
- 窗口、菜单栏入口、更新器和服务启动都在 `applicationDidFinishLaunching` 内调用，缺少代理时这些代码不会正常接入启动生命周期。
- 启动器与随包 Node、FFmpeg 均为 arm64；启动器最低系统标记为 macOS 13.0、构建 SDK 为 14.5。暂未发现把它归因于 M5 架构不受支持的证据；使用旧 SDK 也不能单独证明不兼容 macOS 27。
- Sparkle 框架存在于包内，启动器的 rpath 为 `@executable_path/../Frameworks`，与框架安装位置匹配。
- 启动器代码签名 flags 为 `0x2`（临时签名），没有据此发现启用 Hardened Runtime/Library Validation 的标记。不能直接认定是 Sparkle 文档中“临时签名 + Library Validation”的已知组合；仍需系统实际拒绝记录判断。

Apple 的默认 NSApplicationMain 启动过程依赖主 Nib 创建应用代理等启动对象。对于本项目这样完全用代码创建界面的应用，应明确完成代理创建、绑定和生命周期持有，而不能只凭 `@main` 和方法存在判断启动链路完整。[Apple 启动流程](https://developer.apple.com/library/archive/documentation/General/Conceptual/MOSXAppProgrammingGuide/CoreAppDesign/CoreAppDesign.html)、[Apple 关于程序化启动的说明](https://developer.apple.com/forums/thread/823570)。

## 其他需要一起处理的缺口

| 项目 | 确定程度 | 影响 |
| --- | --- | --- |
| 启动日志创建太晚 | 已确认 | launcher.log 仅在 startServer 内创建；代理未执行、窗口初始化失败或更新器初始化前退出，都可能完全没有应用日志。没有日志不等于没有故障。 |
| 首个窗口显示过晚 | 已确认顺序，是否触发故障未知 | configureMainWindow 会先创建 WKWebView；configureUpdater 也在首次 showMainWindow 之前。任一步卡住或异常都可能让用户看不到启动提示。 |
| Sparkle 是启动期动态依赖 | 已确认，加载失败待查 | 即使延后创建更新器，动态库缺失或被系统拒绝仍可能在 main 之前终止；需要 dyld 或 .ips 信息，不能仅靠应用内错误窗口处理。 |
| 当前测试不验证真实启动生命周期 | 已确认 | macos-package 测试主要检查源码中是否出现 NSWindow、WKWebView 等内容；编译、验签和 ZIP/DMG 生成也不会证明窗口实际出现。这是此前维护遗漏的验证点。 |

Sparkle 的框架位置/rpath 和签名要求参照[官方接入文档](https://sparkle-project.org/documentation/)。当前没有证据支持通过关闭系统安全保护来解决问题，也不建议这样处理。

## 建议修订顺序

1. 补上明确的程序化入口：创建 NSApplication 和 AppDelegate，绑定 delegate，强引用持有代理，再进入 NSApplicationMain。保留 macOS 正常生命周期，而不是直接手动调用 applicationDidFinishLaunching 来掩盖问题。
2. 将最早启动日志移到应用入口，分段记录“入口已执行、代理绑定、启动回调、窗口创建、窗口显示、WebView 初始化、更新器初始化、服务启动”。失败时同时保留标准错误输出。
3. 先显示最小原生启动窗口，再初始化 WebView、更新器和本机服务。更新器异常不应成为应用主界面显示的前置条件；但动态库装载故障仍需单独诊断。
   同时使重新打开入口可重复调用：窗口尚未创建时建立窗口，已有窗口时恢复显示；服务复用不应替代界面创建，也不能把“端口有服务”视为“用户已经有可见窗口”。
4. 在 Apple Silicon 上补充一次最小启动生命周期验证：进程存在、代理回调到达、窗口真实可见。macOS 27/M5 是否有额外问题只能由对应系统日志或真机结果确认，不能由 macos-14 的构建成功代替。
5. 先做专门的 Mac 启动修订版，不改动 Windows 启动器，不碰现有用户数据或重做整个前端。

## 当前机器可用于定因的信息

- 活动监视器中是否保留 `Classmate Lilith` 进程。
- `~/Library/Logs/DiagnosticReports/` 是否产生以该应用相关名称开头的新 `.ips`；重点看 `Termination Reason`、`Exception Type` 和 `Dyld Error Message`。
- `~/Library/Logs/Classmate Lilith/launcher.log` 是否存在，以及本次启动是否更新。无日志应继续检查入口/系统终止，不能只排查 Node。

如需直接观察启动器错误，可在 Mac 终端启动已安装的可执行文件：

```sh
"/Applications/Classmate Lilith.app/Contents/MacOS/Classmate Lilith"
```

此操作会尝试正常启动原应用，不删除或迁移数据；出现动态库、签名或权限错误时，终端信息有助于区分上述原因。代码签名检查可单独执行：

```sh
codesign --verify --deep --strict --verbose=2 "/Applications/Classmate Lilith.app"
```

验签通过不等于已经公证或必然获准运行。本次结论是评估结果，尚未宣称修复成功。
