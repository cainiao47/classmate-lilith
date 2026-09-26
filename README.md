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

## 主要功能

- 录音/视频文件在线转写：千问 API 平台（默认）、腾讯云 ASR、OpenAI。
- 实时录音转写：结果可单独导出，也可一键送入人工修订。
- 可恢复的人工修订、AI 校订、待确认复核与录音定位。
- DeepSeek（默认）或 OpenAI 文本校订与书面化整理。
- 全局术语库、任务历史、运行日志与 TXT/Markdown/Word/SRT 导出。
- API Key 只存放在本机，不提交到仓库。

## 当前版本：0.15.1

- 新增独立的实时录音转写页面，支持千问、腾讯云和 OpenAI 实时接口。
- 实时结果可导出 TXT、Markdown、SRT 和本机录音，也可保存为历史任务或一键送入人工修订。
- 麦克风采集、音频转换和服务适配层均使用跨平台 Web 标准与纯 JavaScript，为 macOS 共用同一套实现留出空间。

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
2. 在“设置”中选择在线转写服务并保存对应凭据。
3. 选择录音或视频、语言和在线服务，然后开始转写。
4. 人工修改原始转写稿，再送入校订。
5. 逐条复核待确认项，必要时定位文字并回听录音。
6. 生成书面稿，并导出 TXT、Markdown 或 Word。

## macOS 预览版

macOS 版以 Apple Silicon（arm64）为首个目标，复用同一套网页、在线服务和任务格式。原生菜单栏启动器负责启动本地服务、打开浏览器、显示日志入口以及“退出并停止服务”。未公证版本的安装与首次放行方法见 `docs/MACOS_INSTALL.md`。

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

持续集成会在 Windows 与 macOS 上执行语法检查和 56 项自动测试。正式版本由带版本标签的 GitHub Actions 构建：Node.js、Windows FFmpeg 和 LAME 下载包会核对上游 SHA-256，macOS FFmpeg 从官方版本标签构建，最终生成两个平台压缩包及 SHA-256 校验文件。

构建说明见 [Windows 发布脚本](distribution/build-windows-base.ps1)、[macOS 发布脚本](distribution/build-macos-arm64.sh) 与 [macOS 验证清单](docs/MACOS_VALIDATION.md)。

## 许可证状态

当前尚未选择正式的开源许可证。公开源代码用于审阅、测试和协作准备，不自动授予复制、修改或再分发权。莉莉丝人物图、应用图标、背景图和项目品牌也暂未授权复用；代码与美术资源的许可证将在正式发布前分别确定。

