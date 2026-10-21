import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const source = await fs.readFile(new URL("../distribution/windows-installer.iss", import.meta.url), "utf8");
const initialize = source.slice(source.indexOf("function InitializeUninstall"), source.indexOf("procedure CurUninstallStepChanged"));

test("interactive uninstall offers keep, delete and cancel with visible storage paths", () => {
  assert.match(initialize, /卸载并保留数据（推荐）/);
  assert.match(initialize, /卸载并删除数据/);
  assert.match(initialize, /取消卸载/);
  assert.match(initialize, /用户数据目录/);
  assert.match(initialize, /UserDataRoot \+ '\\data'/);
  assert.match(initialize, /MB_YESNO or MB_DEFBUTTON2/);
  assert.match(initialize, /DeleteUserData := False/);
  assert.match(initialize, /if UninstallSilent then Exit/);
  assert.ok(initialize.indexOf("if UninstallSilent then Exit") < initialize.indexOf("Choice := TaskDialogMsgBox"));
});

test("data cleanup is post-uninstall, explicitly opted-in and confined to the per-user app folder", () => {
  assert.match(source, /CurUninstallStep <> usPostUninstall then Exit/);
  assert.match(source, /if not DeleteUserData then[\s\S]*?Exit;/);
  assert.match(source, /ExpandFileName\(ExpandConstant\('\{userdocs\}\\Classmate Lilith'\)\)/);
  assert.match(source, /DelTree\(DataPath, True, True, True\)/);
  assert.doesNotMatch(source, /DelTree\(ExpandConstant\('\{app\}/);
  assert.match(source, /#ifdef UninstallTestBuild[\s\S]*?TESTCHOICE[\s\S]*?#endif/);
});

test("the installer shows the Documents data path and automatically selects legacy installed data without merging", () => {
  assert.match(source, /Result := ExpandConstant\('\{userdocs\}\\Classmate Lilith'\)/);
  assert.match(source, /DirExists\(LegacyDataRoot \+ '\\data'\)/);
  assert.match(source, /MigrationEdit.Text := LegacyDataRoot/);
  assert.match(source, /not DirExists\(UserDataRoot \+ '\\data'\)/);
  assert.match(source, /数据保存到/);
});
