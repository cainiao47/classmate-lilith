import fs from 'node:fs/promises';
import path from 'node:path';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

export function createMacAppcast({ version, archive, privateKey, expectedPublicKey }) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw Error('Invalid release version');
  const key = createPrivateKey(privateKey), publicKey = createPublicKey(key);
  const rawPublic = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
  if (rawPublic !== expectedPublicKey.trim()) throw Error('Mac update signing key does not match the bundled public key');
  const signature = sign(null, archive, key);
  if (!verify(null, archive, publicKey, signature)) throw Error('Archive signature verification failed');
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel><title>Classmate Lilith macOS Updates</title><item>
    <title>Classmate Lilith ${version}</title>
    <sparkle:version>${version}</sparkle:version>
    <sparkle:shortVersionString>${version}</sparkle:shortVersionString>
    <sparkle:minimumSystemVersion>13.0.0</sparkle:minimumSystemVersion>
    <description>更新会保留用户目录中的设置、工程和录音。请先完成并保存工作。</description>
    <enclosure url="https://github.com/cainiao47/classmate-lilith/releases/download/v${version}/Classmate-Lilith-macOS-arm64.zip" sparkle:os="macos" sparkle:edSignature="${signature.toString('base64')}" length="${archive.length}" type="application/octet-stream" />
  </item></channel>
</rss>
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const version = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
  const plist = await fs.readFile(new URL('../launcher/macos/Info.plist', import.meta.url), 'utf8');
  const expectedPublicKey = plist.match(/<key>SUPublicEDKey<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
  if (!expectedPublicKey) throw Error('Mac update public key is missing');
  const privateKey = process.env.WINDOWS_UPDATE_PRIVATE_KEY || await fs.readFile(path.join(root, 'release/keys/windows-update-private.pem'), 'utf8');
  const output = process.argv[2] || path.join(root, 'dist');
  const archive = await fs.readFile(path.join(output, 'Classmate-Lilith-macOS-arm64.zip'));
  await fs.writeFile(path.join(output, 'macos-appcast.xml'), createMacAppcast({ version, archive, privateKey, expectedPublicKey }));
  console.log(`Signed macOS ${version} archive and generated appcast.`);
}
