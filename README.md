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

Classmate Lilith 在用户自己的电脑上运行，完整工作流为：在线录音转写 → 人工修订 → AI 校订 → 人工复核 → 书面化整理。它不内置本地语音模型，Windows 和 macOS 使用相同的网页界面、在线服务适配层与任务格式。

## 下载

请从 [Releases](https://github.com/cainiao47/classmate-lilith/releases/latest) 下载，不要下载 GitHub 自动生成的 Source code 压缩包。

| 系统 | 文件 | 说明 |
| --- | --- | --- |
| Windows 10/11 x64 | `Classmate-Lilith-Windows-x64.zip` | 解压后双击 `Classmate Lilith.exe`，无需安装 |
| macOS 13+ Apple Silicon | `Classmate-Lilith-macOS-arm64.zip` | 适用于 M1/M2/M3/M4 等芯片，首次启动需手动放行 |

macOS 版目前未使用 Apple 开发者证书签名，也未公证。第一次运行时请按 [macOS 安装说明](docs/MACOS_INSTALL.md) 操作。Intel Mac 暂未提供预编译包。

Windows 版使用 WebView2独立应用窗口；Windows 11 已包含对应运行时，绝大多数 Windows 10 设备也已安装。若极少数电脑缺少 WebView2 Runtime，应用会明确提示，并保留使用系统浏览器打开的临时入口。

## 主要功能

- 录音/视频文件在线转写：千问 API 平台（默认）、腾讯云 ASR、OpenAI。
- 实时录音转写：连接异常时保持本机录音、自动重连并补送短时缓冲，结果可单独导出或一键送入人工修订。
- 千问实时模型可选 Qwen3-ASR、Qwen-Audio 3.0/3.1 与 Fun-ASR，覆盖更多中文方言场景。
- 可恢复的人工修订、AI 校订、待确认复核与录音定位。
- DeepSeek（默认）或 OpenAI 文本校订，以及“全文规划—分段改写—全文终审”的书面化整理。
- 全局术语库、任务历史、运行日志与 TXT/Markdown/Word/SRT 导出。
- API Key 只存放在本机，不提交到仓库。

## 当前版本：0.21.0

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

1. 双击 `Classmate Lilith.exe`。
   工作台会在独立窗口中打开；关闭窗口会缩到系统托盘，通过托盘菜单可重新显示或彻底退出。
2. 在“设置”中选择在线转写服务并保存对应凭据。
3. 选择录音或视频、语言和在线服务，然后开始转写。
4. 人工修改原始转写稿，再送入校订。
5. 逐条复核待确认项，必要时定位文字并回听录音。
6. 生成书面稿，并导出 TXT、Markdown 或 Word。

## macOS 预览版

macOS 版以 Apple Silicon（arm64）为首个目标，复用同一套网页、在线服务和任务格式。原生启动器会显示独立应用窗口和 Dock 图标，在窗口内载入工作台；菜单栏同时保留显示窗口、打开日志以及“退出并停止服务”等快捷入口。未公证版本的安装与首次放行方法见 `docs/MACOS_INSTALL.md`。

## 隐私与网络

本地网页服务只监听 `127.0.0.1`。录音会先在本机标准化和切片，再发送到用户选择的在线转写服务；校订文本会发送到用户选择的文字处理服务。删除历史任务时，任务专属录音会一并清理。

## 发布结构

Windows 便携包只包含应用代码、启动器、Node.js 和 FFmpeg；macOS 包为独立 `.app`。两者均不包含模型或本地 ASR 引擎。`data/`、`logs/` 和录音不得提交到 GitHub 或放入发布包。

## 从源码检查与构建

需要 Node.js 22 或更高版本。

```text
npm ci
npm run check
npm test
```

持续集成会在 Windows 与 macOS 上执行语法检查和 64 项自动测试。正式版本由带版本标签的 GitHub Actions 构建：Node.js、Windows FFmpeg 和 LAME 下载包会核对上游 SHA-256，macOS FFmpeg 从官方版本标签构建，最终生成两个平台压缩包及 SHA-256 校验文件。

构建说明见 [Windows 发布脚本](distribution/build-windows-base.ps1)、[macOS 发布脚本](distribution/build-macos-arm64.sh) 与 [macOS 验证清单](docs/MACOS_VALIDATION.md)。

## 开放许可

Classmate Lilith 是一项以生成式 AI 辅助开发为主的开放项目。在相关权利存在且由项目维护者持有的范围内：

- 原创程序代码采用 [0BSD License](LICENSE)，允许自由使用、复制、修改、商业使用和再分发，且不强制署名。
- 原创美术资源与项目文档采用 [CC0 1.0 Universal](ASSETS_LICENSE.md)，在法律允许范围内贡献至公共领域。
- Node.js、FFmpeg、LAME、`ws` 等第三方组件继续遵循各自的许可证，详见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。

许可证只能授予项目维护者实际拥有或有权授予的权利，不改变任何第三方材料的授权条件。
