#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef PackageRoot
  #error PackageRoot is required
#endif
#ifndef OutputRoot
  #error OutputRoot is required
#endif
#ifndef BuildCompression
  #define BuildCompression "lzma2"
#endif
#ifdef TestUserDataRoot
  #ifndef UninstallTestBuild
    #error TestUserDataRoot requires UninstallTestBuild
  #endif
#endif
#ifdef TestLegacyDataRoot
  #ifndef UninstallTestBuild
    #error TestLegacyDataRoot requires UninstallTestBuild
  #endif
#endif
#ifdef UninstallTestBuild
  #ifndef TestUserDataRoot
    #error UninstallTestBuild requires an isolated TestUserDataRoot
  #endif
#endif

[Setup]
AppId={{63217C39-F1A7-48D1-9BC3-366859B24099}
AppName=Classmate Lilith
AppVersion={#AppVersion}
AppPublisher=Classmate Lilith
AppPublisherURL=https://github.com/cainiao47/classmate-lilith
DefaultDirName={localappdata}\Programs\Classmate Lilith
DefaultGroupName=Classmate Lilith
DisableProgramGroupPage=yes
AllowNoIcons=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
UsePreviousAppDir=yes
AppMutex=Local\ClassmateLilithLauncher-4178
SetupMutex=Local\ClassmateLilithSetup
CloseApplications=no
RestartApplications=no
UninstallDisplayIcon={app}\Classmate Lilith.exe
SetupIconFile={#PackageRoot}\assets\app.ico
OutputDir={#OutputRoot}
OutputBaseFilename=Classmate-Lilith-Setup-{#AppVersion}
Compression={#BuildCompression}
SolidCompression=yes
WizardStyle=modern
Uninstallable=yes

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："

[Files]
Source: "{#PackageRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "data\*,logs\*,SHA256SUMS.txt"

[Icons]
Name: "{group}\Classmate Lilith"; Filename: "{app}\Classmate Lilith.exe"; Check: not WizardNoIcons
Name: "{userdesktop}\Classmate Lilith"; Filename: "{app}\Classmate Lilith.exe"; Tasks: desktopicon; Check: not WizardNoIcons

[Run]
Filename: "{app}\Classmate Lilith.exe"; Parameters: "--after-install"; Description: "启动 Classmate Lilith"; Flags: postinstall nowait skipifsilent; Check: CanLaunch

[Code]
var
  MigrationPage: TWizardPage;
  MigrationEdit: TNewEdit;
  MigrationFailed: Boolean;
  DeleteUserData: Boolean;

function UserDataRoot: String;
begin
#ifdef UninstallTestBuild
  Result := ExpandConstant('{#TestUserDataRoot}');
#else
  Result := ExpandConstant('{userdocs}\Classmate Lilith');
#endif
end;

function LegacyDataRoot: String;
begin
#ifdef TestLegacyDataRoot
  Result := ExpandConstant('{#TestLegacyDataRoot}');
#else
  Result := ExpandConstant('{localappdata}\Classmate Lilith');
#endif
end;

function ServiceRunning: Boolean;
var Request: Variant;
begin
  Result := False;
  try
    Request := CreateOleObject('WinHttp.WinHttpRequest.5.1');
    Request.SetProxy(1);
    Request.SetTimeouts(800, 800, 800, 800);
    Request.Open('GET', 'http://127.0.0.1:4178/api/health', False);
    Request.Send;
    Result := Pos('classmate-lilith', Request.ResponseText) > 0;
  except
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not IsDotNetInstalled(net472, 0) then
  begin
    Result := '高清显示适配需要 Microsoft .NET Framework 4.7.2 或更新版本。请先安装微软官方运行时，再重新运行安装包。';
    Exit;
  end;
  if ServiceRunning then Result := '请先保存任务，并在系统托盘选择“退出并停止服务”，然后重试安装。安装器不会强制结束录音或转写。';
end;

function InitializeUninstall: Boolean;
var Choice: Integer; Description: String;
begin
  DeleteUserData := False;
  Result := not ServiceRunning;
  if not Result then
  begin
    if not UninstallSilent then MsgBox('请先保存任务，并在系统托盘退出 Classmate Lilith。', mbInformation, MB_OK);
    Exit;
  end;
#ifdef UninstallTestBuild
  { Only the isolated test binary has this hook; it is absent in release builds. }
  Description := ExpandConstant('{param:TESTCHOICE|keep}');
  if Description = 'delete' then DeleteUserData := True
  else if Description = 'cancel' then Result := False;
  Exit;
#endif
  { Silent uninstall and upgrade tooling always preserve data. }
  if UninstallSilent then Exit;
  Description := '用户数据目录：'#13#10 + UserDataRoot + '\data'#13#10#13#10 +
    '日志、窗口缓存及更新备份目录：'#13#10 + UserDataRoot + #13#10#13#10 +
    '保留数据：以后重装可继续使用设置、术语、工程、人工版本和录音。'#13#10 +
    '删除数据：永久删除上述目录中的设置、API 配置、工程、录音、缓存、日志及更新备份。'#13#10 +
    '不会删除旧便携版、上版旧位置的数据副本或你另外制作的备份。';
  Choice := TaskDialogMsgBox('卸载 Classmate Lilith 后，是否保留用户数据？', Description,
    mbConfirmation, MB_YESNOCANCEL, ['卸载并保留数据（推荐）', '卸载并删除数据', '取消卸载'], 0);
  Result := (Choice = IDYES) or (Choice = IDNO);
  if Choice = IDNO then
  begin
    Result := MsgBox('确认永久删除以下目录及其中的全部用户数据？此操作不可撤销。'#13#10#13#10 +
      UserDataRoot + #13#10#13#10 + '请确认需要保留的数据已有独立备份。',
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
    DeleteUserData := Result;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var DataPath: String;
begin
  if CurUninstallStep <> usPostUninstall then Exit;
  DataPath := UserDataRoot;
  if not DeleteUserData then
  begin
    Log('用户数据已保留：' + DataPath);
    Exit;
  end;
  { Release builds have one fixed per-user target, never the program folder, a drive root,
    the old portable folder, or an arbitrary command-line path. DelTree removes
    reparse points without following their targets. }
#ifndef UninstallTestBuild
  if CompareText(ExpandFileName(DataPath), ExpandFileName(ExpandConstant('{userdocs}\Classmate Lilith'))) <> 0 then
    RaiseException('数据目录校验失败，未删除用户数据。');
#endif
  if DirExists(DataPath) then
    if not DelTree(DataPath, True, True, True) then
    begin
      Log('部分用户数据未能删除：' + DataPath);
      if not UninstallSilent then MsgBox('程序已卸载，但部分数据仍被占用，未能完全删除。请检查：'#13#10 + DataPath,
        mbInformation, MB_OK);
      Exit;
    end;
  Log('已按用户选择删除数据：' + DataPath);
end;

procedure BrowseOldApp(Sender: TObject);
var Folder: String;
begin
  Folder := MigrationEdit.Text;
  if BrowseForFolder('选择旧便携版文件夹', Folder, False) then MigrationEdit.Text := Folder;
end;

procedure InitializeWizard;
var Description: TNewStaticText; Browse: TNewButton;
begin
  MigrationFailed := False;
  MigrationPage := CreateCustomPage(wpSelectTasks, '保留旧版数据', '首次安装可导入旧便携版的数据；升级安装继续使用已有数据。');
  Description := TNewStaticText.Create(MigrationPage);
  Description.Parent := MigrationPage.Surface; Description.AutoSize := False; Description.WordWrap := True;
  Description.SetBounds(0, 0, MigrationPage.SurfaceWidth, ScaleY(65));
  Description.Caption := '数据保存到：' + UserDataRoot + '\data'#13#10 +
    '可选择包含 data 的旧便携版或上版安装数据目录。原目录不会被删除。';
  MigrationEdit := TNewEdit.Create(MigrationPage); MigrationEdit.Parent := MigrationPage.Surface;
  MigrationEdit.SetBounds(0, ScaleY(75), MigrationPage.SurfaceWidth - ScaleX(90), ScaleY(24));
  MigrationEdit.Text := ExpandConstant('{param:MIGRATEFROM|}');
  if (MigrationEdit.Text = '') and DirExists(LegacyDataRoot + '\data') then
    MigrationEdit.Text := LegacyDataRoot;
  Browse := TNewButton.Create(MigrationPage); Browse.Parent := MigrationPage.Surface;
  Browse.SetBounds(MigrationPage.SurfaceWidth - ScaleX(80), ScaleY(74), ScaleX(80), ScaleY(26));
  Browse.Caption := '浏览…'; Browse.OnClick := @BrowseOldApp;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = MigrationPage.ID) and DirExists(UserDataRoot + '\data');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = MigrationPage.ID) and (MigrationEdit.Text <> '') then
    if not DirExists(AddBackslash(MigrationEdit.Text) + 'data') and not FileExists(AddBackslash(MigrationEdit.Text) + 'config\api-settings.json') then
    begin
      MsgBox('所选目录没有找到 data 文件夹或旧版设置文件。', mbError, MB_OK);
      Result := False;
    end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var Code: Integer; Arguments, DataPath: String;
begin
  if (CurStep = ssPostInstall) and (MigrationEdit.Text <> '') and not DirExists(UserDataRoot + '\data') then
  begin
    DataPath := UserDataRoot + '\data';
    Arguments := '"' + ExpandConstant('{app}\distribution\migrate-portable.mjs') + '" --source "' + AddBackslash(MigrationEdit.Text) + '." --destination "' + DataPath + '"';
    if not Exec(ExpandConstant('{app}\runtime\node\node.exe'), Arguments, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) then Code := 1;
    MigrationFailed := Code <> 0;
    if MigrationFailed then MsgBox('数据迁移没有完成，旧数据完整保留。请查看：'#13#10 + UserDataRoot + '\migration-error.txt'#13#10 + '处理后重新导入；暂不自动启动程序。', mbError, MB_OK);
  end;
end;

function CanLaunch: Boolean;
begin
  Result := not MigrationFailed;
end;

function GetCustomSetupExitCode: Integer;
begin
  Result := 0;
  if MigrationFailed then Result := 20;
end;
