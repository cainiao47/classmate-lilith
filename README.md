# Classmate Lilith

<p align="center">
  <img src="public/assets/lilith-app-icon.png" alt="Classmate Lilith" width="128" />
</p>

<p align="center">
  <strong>课堂录音转写、人工校订与书面化整理工作台</strong>
</p>

<p align="center">
  <a href="https://github.com/cainiao47/classmate-lilith/actions/workflows/check.yml"><img src="https://github.com/cainiao47/classmate-lilith/actions/workflows/check.yml/badge.svg" alt="Build status" /></a>
  <a href="https://github.com/cainiao47/classmate-lilith/releases/latest">下载最新版</a>
</p>

Classmate Lilith 在用户自己的电脑上运行，完整工作流为：在线录音转写 → 人工修订 → AI 校订 → 人工复核 → 书面化整理。它不内置本地语音模型，源码共用网页工作台、在线服务适配层与任务格式；Windows 和 macOS 的已发布版本进度不同。

## 下载

请从 [Releases](https://github.com/cainiao47/classmate-lilith/releases/latest) 下载，不要下载 GitHub 自动生成的 Source code 压缩包。

| 系统 | 文件 | 说明 |
| --- | --- | --- |
| Windows 10/11 x64 安装版 | [v0.30.0 安装包](https://github.com/cainiao47/classmate-lilith/releases/download/v0.30.0/Classmate-Lilith-Setup-0.30.0.exe) | 安装向导、旧版数据导入、应用内检查与安装更新 |
| Windows 10/11 x64 便携版 | [v0.30.0 便携包](https://github.com/cainiao47/classmate-lilith/releases/download/v0.30.0/Classmate-Lilith-Windows-x64.zip) | 解压后双击 `Classmate Lilith.exe`，无需安装 |
| macOS 13+ Apple Silicon | [v0.30.0 DMG 安装盘](https://github.com/cainiao47/classmate-lilith/releases/download/v0.30.0/Classmate-Lilith-macOS-arm64.dmg) | 拖入“应用程序”；提供签名更新组件，本轮未做 Mac 交互测试 |

Windows 安装与覆盖升级详见 [Windows 安装说明](docs/WINDOWS_INSTALL.md)。安装版将用户数据独立保存，升级保留数据；卸载时显示数据路径，可手动选择保留或经二次确认后删除。首次安装可以从旧便携版复制并校验数据。

当前版本为 **[v0.30.0](https://github.com/cainiao47/classmate-lilith/releases/tag/v0.30.0)**（2026-11-04），包含复核栏宽拖动、Mac 退出前保存保护、DMG/应用内更新，以及跨平台维护修复。已纳入原 v0.25.0 开发线的全部内容，Windows 支持从 v0.24.0 检查更新或覆盖升级；Mac 旧客户端首次需手动安装含更新组件的本版。详见 [发布说明](docs/RELEASE_0.30.0.md) 与 [维护记录](docs/MAINTENANCE_0.25.0.md)。

macOS 版目前未使用 Apple 开发者证书签名，也未公证。第一次运行时请按 [macOS 安装说明](docs/MACOS_INSTALL.md) 操作。Intel Mac 暂未提供预编译包。

Windows 版使用 WebView2独立应用窗口；Windows 11 已包含对应运行时，绝大多数 Windows 10 设备也已安装。若极少数电脑缺少 WebView2 Runtime，应用会明确提示，并保留使用系统浏览器打开的临时入口。

## 主要功能

- 录音/视频文件在线转写：千问 API 平台（默认）、腾讯云 ASR、OpenAI。
- 实时录音转写：连接异常时保持本机录音、自动重连并补送短时缓冲，结果可单独导出或一键送入人工修订。
- 千问实时模型可选 Qwen3-ASR、Qwen-Audio 3.0/3.1 与 Fun-ASR，覆盖更多中文方言场景。
- 可恢复的人工修订、AI 校订、待确认复核与录音定位。
- DeepSeek（默认）或 OpenAI 文本校订，以及“全文规划—分段改写—全文终审”的书面化整理。
- 学术讲座整理稿：主题章节、完整书面段落、逐段原文核查与修订，支持 Obsidian Markdown 和带标题层级的 Word 导出，详见 [成稿说明](docs/ACADEMIC_LECTURE.md)。
- 全局术语库、任务历史、运行日志与 TXT/Markdown/Word/SRT 导出。
- API Key 只存放在本机，不提交到仓库。

## Windows 当前版本：0.30.0

Windows 开发版本：0.30.1（未发布）。此开发分支仅修复 Mac 启动链路，现有 Windows 发布文件不变；Mac 修复预览尚未替换正式下载。

本版包含复核分栏宽度拖动、Mac 退出保护及 Sparkle 更新组件。升级前完全退出旧客户端，数据独立保留；Mac 首次需要手动安装本版，此后才可应用内更新。

- 一体化顶栏、轻量侧栏和 22px 窗口圆角；保留拖动、缩放、最小化、最大化及关闭至托盘，运行时不支持时回退系统标题栏。
- 素材导入、原文校订、人工复核、书面整理四阶段视图，配合底部操作栏、空态和前置条件提示；切换阶段不会自动启动处理。
- 中断工程恢复至可继续的阶段，明确区分继续处理与重新处理；文字导入和历史版本恢复提供明确入口、错误反馈及恢复前备份。
- 长文复核支持原文对照或单栏编辑，定位原文自动返回对照；整理稿完善加粗和目录预览，清空后保留编辑入口。
- 分开复制 Markdown 与纯文字；复制/导出提供持续反馈，导出固定当前标题与正文，阻止重复提交并处理超时与重试。
- 实时页区分录音、识别与工程保存状态，收尾确认超时后提示核对，仍等待本机音频写入结束。

### 0.23.1（历史版本）

- 第一批交互修订：切换前保存、处理中切换保护、恢复前自动备份及版本关联录音保留。
- 分离保存状态与结果有效性，修复成稿空态占位；增加整理稿阅读预览、目录、字号和专注模式。
- 补齐设置弹窗焦点与 Esc、实时页面离开保护，Windows 普通退出会先检查页面并保存。
- 语境默认折叠，主编辑区前移，调整字号与较小窗口布局。课程主题与术语框继续保持等高。
- 实时录音分段落盘与异常恢复、工程名称搜索和分页、可恢复的工程回收站。说明与限制见 [数据保护说明](docs/UX_IMPROVEMENTS.md)。
- 从本版源码重新构建，包含上述全部新增功能；不会替用户安装或修改正式数据。
- 仅恢复已经写入的部分，不保证异常前最后几秒、断电或磁盘故障时零丢失。回收站与录音恢复点暂不自动清理，会占用本机空间。

### 0.22.2（历史版本）

- 增加 EXE 安装向导、旧便携版数据迁移、快捷方式和卸载入口，安装版数据与程序分开保存。
- 增加应用内更新检查、签名和完整性验证、确认安装、程序与元数据备份，以及安装失败时的程序恢复。
- 新任务默认使用学术讲座整理稿，按主题成章、逐段原文核对，并改进 Markdown 与 Word 导出。
- 安装版数据改存系统“文档”下的 `Classmate Lilith\data`，日志和更新备份放在同级；兼容重定向的“文档”路径。上版安装数据会复制校验后导入，旧副本仍保留。
- Windows 启用 PerMonitorV2 高清缩放，修复高缩放比例下独立窗口文字被整体拉伸发糊的问题，并限制初始窗口不超出屏幕可用范围；需要 .NET Framework 4.7.2 或更新版本。
- macOS 本轮不构建或更新，下载继续使用 GitHub 已发布的 v0.21.1。

### 0.21.1（GitHub 已发布）

- Windows 改为 WebView2独立窗口，并保留系统托盘、完整退出和缺少运行时时的浏览器回退入口。
- Windows 与 macOS 原生窗口统一采用暖色标题栏、莉莉丝品牌启动页和更清晰的启动/错误状态。
- 原创代码以 0BSD 开放，原创美术和文档以 CC0 1.0 开放；发布包同时携带项目与第三方许可证。

### 0.17.0

- macOS 改为带 Dock 图标的独立原生窗口，工作台直接在应用内显示，不再依赖外部浏览器。
- 增加原生启动状态、错误重试、文件选择、导出保存和麦克风权限处理；菜单栏入口继续保留。

### 0.16.0

- 实时转写加入连接心跳、详细关闭日志、自动重连和 20 秒有界音频缓冲；上游临时断线不再结束本机录音。
- 新增 Qwen-Audio 3.0、Qwen-Audio 3.1 和 Fun-ASR 实时模型选项，兼顾更广方言覆盖、方言表达保留、热词和时间戳。
- 书面化整理升级为全文结构规划、分段正式改写和全文文体终审，并校验输出长度以拦截意外摘要。
- 在线文件转写对网络错误、限流和服务端故障自动退避重试，并保存分片检查点。
- 取消校订或书面化整理时会同步终止服务端模型请求；失败响应文件自动保留 30 天、最多 100 份。

### 0.14.1

- 加入“夜读者莉莉丝”网页背景与应用图标。
- 移除校订前无实际内容的结果占位卡片，并收窄桌面工作区以保留角色展示空间。
- 背景改为覆盖整个视口并加入顶部渐隐，滚动时不再在人物头部出现硬截断。

- 转写只使用在线服务，不包含本地 ASR 模式、模型、引擎或组件下载器。
- 在线转写支持千问 API 平台（默认）、腾讯云 ASR 和 OpenAI。
- FFmpeg 保留在基础包内，负责录音增强、标准化和按服务限制切片；它不是本地识别引擎。
- 文字校订与书面化支持 DeepSeek（默认）和 OpenAI。
- API Key 保存在本机 `data/settings.json`，使用轻量加密；不会写入任务历史或浏览器存储。
- 任务录音、转写时间轴、人工修改、校订结果、待确认项和书面稿均可恢复。
- 运行日志实时写入 `logs/`，最多保留 20 份。
- 校订“处理方式”紧邻开始校订操作，课程语境设置保持独立。

## Windows 使用

1. 安装版先运行 EXE 安装器，再从快捷方式启动；便携版双击 `Classmate Lilith.exe`。
   工作台在独立窗口中打开；关闭窗口会缩到系统托盘，可通过托盘菜单重新显示或彻底退出。
2. 在“设置”中选择在线转写服务并保存对应凭据。
3. 选择录音或视频、语言和在线服务，然后开始转写。
4. 人工修改原始转写稿，再送入校订。
5. 逐条复核待确认项，必要时定位文字并回听录音。
6. 生成书面稿，并导出 TXT、Markdown 或 Word。

## macOS 预览版

macOS 版以 Apple Silicon（arm64）为首个目标，复用同一套网页、在线服务和任务格式。原生启动器会显示独立应用窗口和 Dock 图标，在窗口内载入工作台；菜单栏同时保留显示窗口、打开日志以及“退出并停止服务”等快捷入口。未公证版本的安装与首次放行方法见 `docs/MACOS_INSTALL.md`。

## 隐私与网络

本地网页服务只监听 `127.0.0.1`。文件录音会先在本机标准化和切片，再发送到用户选择的在线转写服务；实时录音将音频流发送到所选语音服务，同时保留本机恢复分段；校订文本会发送到用户选择的文字处理服务。工程删除改为移入回收站，版本与录音保留，不等于永久擦除。v0.22.2 等旧版仍采用原先的删除行为。

## 发布结构

Windows 便携包只包含应用代码、启动器、Node.js 和 FFmpeg；macOS 包为独立 `.app`。两者均不包含模型或本地 ASR 引擎。`data/`、`logs/` 和录音不得提交到 GitHub 或放入发布包。

## 从源码检查与构建

需要 Node.js 22 或更高版本。

```text
npm ci
npm run check
npm test
```

持续集成会在 Windows 与 macOS 上执行语法检查和自动测试，不自动发布 macOS 包。Windows 可由本机验证后上传，或通过 Windows 发布工作流构建；标签对应的正式发布已具备完整 Windows 资源时，工作流跳过重复构建。CI 构建需要配置与发布公钥对应的签名私钥 secret；私钥不提交到源码或发布资源。跨平台发布工作流仅手动触发。构建脚本会校验下载的运行时和工具，发布包附 SHA-256 校验文件。

构建说明见 [Windows 发布脚本](distribution/build-windows-base.ps1)、[macOS 发布脚本](distribution/build-macos-arm64.sh) 与 [macOS 验证清单](docs/MACOS_VALIDATION.md)。

## 开放许可

Classmate Lilith 是一项以生成式 AI 辅助开发为主的开放项目。在相关权利存在且由项目维护者持有的范围内：

- 原创程序代码采用 [0BSD License](LICENSE)，允许自由使用、复制、修改、商业使用和再分发，且不强制署名。
- 原创美术资源与项目文档采用 [CC0 1.0 Universal](ASSETS_LICENSE.md)，在法律允许范围内贡献至公共领域。
- Node.js、FFmpeg、LAME、`ws` 等第三方组件继续遵循各自的许可证，详见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。

许可证只能授予项目维护者实际拥有或有权授予的权利，不改变任何第三方材料的授权条件。
