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
  if ServiceRunning then Result := '请先保存任务，并在系统托盘选择“退出并停止服务”，然后重试安装。安装器不会强制结束录音或转写。';
end;

function InitializeUninstall: Boolean;
begin
  Result := not ServiceRunning;
  if not Result then MsgBox('请先保存任务，并在系统托盘退出 Classmate Lilith。', mbInformation, MB_OK);
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
  Description.Caption := '如需导入，请选择包含 Classmate Lilith.exe 和 data 文件夹的旧版目录。留空则跳过。原目录不会被删除。';
  MigrationEdit := TNewEdit.Create(MigrationPage); MigrationEdit.Parent := MigrationPage.Surface;
  MigrationEdit.SetBounds(0, ScaleY(75), MigrationPage.SurfaceWidth - ScaleX(90), ScaleY(24));
  MigrationEdit.Text := ExpandConstant('{param:MIGRATEFROM|}');
  Browse := TNewButton.Create(MigrationPage); Browse.Parent := MigrationPage.Surface;
  Browse.SetBounds(MigrationPage.SurfaceWidth - ScaleX(80), ScaleY(74), ScaleX(80), ScaleY(26));
  Browse.Caption := '浏览…'; Browse.OnClick := @BrowseOldApp;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = MigrationPage.ID) and DirExists(ExpandConstant('{localappdata}\Classmate Lilith\data'));
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
  if (CurStep = ssPostInstall) and (MigrationEdit.Text <> '') and not DirExists(ExpandConstant('{localappdata}\Classmate Lilith\data')) then
  begin
    DataPath := ExpandConstant('{localappdata}\Classmate Lilith\data');
    Arguments := '"' + ExpandConstant('{app}\distribution\migrate-portable.mjs') + '" --source "' + AddBackslash(MigrationEdit.Text) + '." --destination "' + DataPath + '"';
    if not Exec(ExpandConstant('{app}\runtime\node\node.exe'), Arguments, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code) then Code := 1;
    MigrationFailed := Code <> 0;
    if MigrationFailed then MsgBox('数据迁移没有完成，旧数据完整保留。请查看 %LOCALAPPDATA%\Classmate Lilith\migration-error.txt，处理后重新导入；暂不自动启动程序。', mbError, MB_OK);
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
