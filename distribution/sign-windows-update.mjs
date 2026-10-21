import fs from "node:fs/promises";
import path from "node:path";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sha256, verifyUpdateEnvelope, RELEASE_REPO } from "../lib/windows-updates.mjs";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
const value = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const publicFile = path.join(root, "distribution", "windows-update-public.pem");
const privateFile = value("--key", path.join(root, "release", "keys", "windows-update-private.pem"));
if (args.includes("--init-key")) {
  let privateKey;
  try { privateKey = createPrivateKey(await fs.readFile(privateFile, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    try { await fs.access(publicFile); throw new Error("发布公钥已存在，不能生成替换密钥；请恢复原私钥。"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    privateKey = generateKeyPairSync("ed25519").privateKey;
    await fs.mkdir(path.dirname(privateFile), { recursive: true });
    await fs.writeFile(privateFile, privateKey.export({ format: "pem", type: "pkcs8" }), { flag: "wx", mode: 0o600 });
  }
  const publicKey = createPublicKey(privateKey).export({ format: "pem", type: "spki" });
  try {
    const existing = createPublicKey(await fs.readFile(publicFile, "utf8")).export({ format: "der", type: "spki" });
    const expected = createPublicKey(publicKey).export({ format: "der", type: "spki" });
    if (!existing.equals(expected)) throw new Error("公钥与现有私钥不匹配。");
  }
  catch (error) { if (error.code !== "ENOENT") throw error; await fs.writeFile(publicFile, publicKey, { flag: "wx" }); }
  console.log("Windows 更新签名密钥已准备。私钥仅保存在忽略目录中，请单独备份，不要提交到 Git。");
} else {
  const version = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")).version;
  const installer = value("--installer"), output = value("--output");
  if (!installer || !output) throw new Error("请指定 --installer 和 --output。");
  const privateKey = createPrivateKey(process.env.WINDOWS_UPDATE_PRIVATE_KEY || await fs.readFile(privateFile, "utf8"));
  const publicKey = await fs.readFile(publicFile, "utf8");
  const manifest = { format: 1, version, platform: "win32", arch: "x64", url: `https://github.com/${RELEASE_REPO}/releases/download/v${version}/Classmate-Lilith-Setup-${version}.exe`,
    sha256: await sha256(installer), size: (await fs.stat(installer)).size, publishedAt: new Date().toISOString() };
  const payload = Buffer.from(JSON.stringify(manifest), "utf8");
  const envelope = { payload: payload.toString("base64"), signature: sign(null, payload, privateKey).toString("base64") };
  verifyUpdateEnvelope(envelope, publicKey);
  await fs.writeFile(output, JSON.stringify(envelope, null, 2) + "\n", "utf8");
  await fs.writeFile(`${installer}.sha256`, `${manifest.sha256}  ${path.basename(installer)}\n`, "ascii");
  console.log(`已签名 Windows ${version} 更新清单。`);
}
