# Windows 安装与更新

## 安装版

下载 `Classmate-Lilith-Setup-版本号.exe`，按照向导安装。默认安装到当前用户的 `%LOCALAPPDATA%\Programs\Classmate Lilith`，无需管理员权限。可以创建开始菜单和桌面快捷方式。

安装版将设置、API 凭据、术语库、任务、人工版本和录音保存在 `%LOCALAPPDATA%\Classmate Lilith\data`，日志保存在同级的 `logs`。覆盖安装只替换程序文件，卸载默认保留用户数据。清理个人数据时请先备份并退出程序，再手工处理这个独立目录。

当前安装器及启动器尚未使用公开受信任的 Windows 代码签名证书。Windows 可能显示未知发布者提示，部分设备的安全策略可能阻止运行。应用的更新包签名用于核验更新来源，与 Windows 代码签名是两回事。

## 从旧便携版导入

1. 在旧版中保存任务，通过系统托盘“退出并停止服务”。保留完整旧版文件夹。
2. 首次运行安装器，在“保留旧版数据”页选择旧版目录，而不是其中的 `data` 子目录；不需要导入时留空。
3. 安装器复制并逐文件校验旧数据，将任务元数据中属于旧 `data` 目录的录音路径指向新目录，凭据文件保持原有格式。
4. 导入成功后启动并检查历史、录音与设置。旧文件夹不会被删除，可在确认后自行归档。

已有安装版数据时，向导会跳过导入，继续使用已有数据，不做覆盖合并。复制中断、空间不足或元数据损坏时不会删除旧数据，也不会自动启动空白工作台；错误记录位于 `%LOCALAPPDATA%\Classmate Lilith\migration-error.txt`。确认错误已处理且新目标目录没有既有数据后，可重新运行安装器导入。

## 应用内更新

工作台右上角有“检查更新”。程序启动后自动检查正式版，单次运行内缓存六小时；按钮可手动重新检查。网络失败不影响当前版本使用。

发现新版后可下载更新包。应用先验证内置公钥对应的 Ed25519 发布签名，再校验下载文件大小和 SHA-256。用户确认“保存并安装更新”后，程序保存当前任务，检查其他页面是否有未保存修改、实时录音或运行中的任务；有则停止安装，提示先处理。

准备安装时暂停新的后台写入和实时连接，备份程序及设置、术语库、任务和人工版本，录音原地保留。独立更新助手等待本地服务与托盘程序退出，再运行安装器，最后重启并检查新版服务。安装或启动失败时尝试恢复先前程序文件；用户元数据备份保留以供手动恢复，不自动用旧数据覆盖新数据。

更新缓存、程序回退副本和升级日志位于 `%LOCALAPPDATA%\Classmate Lilith\updates`。备份包含个人数据，请勿公开分享。录音文件不会为了每次升级再复制一份。备份和已下载更新可在确认新版稳定、退出程序后手工清理。

只有安装版支持应用内安装。便携版继续将数据放在自身的 `data` 和 `logs` 中，可检查更新并下载；转为安装版时按上面的导入步骤操作。

## 发布维护

- 版本号以 `package.json` 为准，正式更新只接受三段数字版本，测试版不进入自动更新通道。
- 更新签名公钥：`distribution/windows-update-public.pem`。私钥不随安装包分发，不提交 Git。
- 本机发布私钥首次生成在忽略目录 `release/keys/windows-update-private.pem`，必须单独备份，丢失后不能直接替换现有公钥来更新已安装的版本。
- GitHub 自动构建需要配置同一私钥的仓库 Secret：`WINDOWS_UPDATE_PRIVATE_KEY`。不要配置模型 API Key 或个人 GitHub Token 到客户端。
- 新的 `windows-release.yml` 只构建和发布 Windows。旧双平台发布流程保留为手动触发，本轮不构建或更新 macOS 包。
- 发布资产必须包括 EXE、校验文件和签名清单 `windows-update.json`；在 GitHub 正式发布后，客户端才能发现该版本。

## 本机构建与验证

```powershell
node distribution/sign-windows-update.mjs --init-key
.\distribution\build-windows-base.ps1 -RuntimeSeed C:\path\to\trusted-runtime
.\distribution\build-windows-installer.ps1 -PackageRoot .\dist\Classmate-Lilith-Windows-x64 -InnoCompiler C:\path\to\ISCC.exe
.\distribution\test-windows-installer.ps1 -Installer .\dist\Classmate-Lilith-Setup-版本号.exe
```

安装演练会在仓库 `temp` 下创建隔离的程序与数据目录，测试首次安装、保存设置与历史、覆盖重装、数据哈希、卸载保留数据。若发现已有正式安装的卸载登记则中止，避免影响用户安装。演练不会创建快捷方式、连接真实模型服务或使用现有用户数据。
