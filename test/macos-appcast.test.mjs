import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { createMacAppcast } from '../distribution/sign-macos-update.mjs';
test('Mac update feed binds a standard Ed25519 signature to the exact archive and pinned key',()=>{
  const keys=generateKeyPairSync('ed25519'), archive=Buffer.from('synthetic archive, never executable');
  const privateKey=keys.privateKey.export({format:'pem',type:'pkcs8'});
  const expectedPublicKey=Buffer.from(keys.publicKey.export({format:'jwk'}).x,'base64url').toString('base64');
  const feed=createMacAppcast({version:'0.25.0',archive,privateKey,expectedPublicKey});
  assert.match(feed,/<sparkle:version>0\.25\.0<\/sparkle:version>/);
  assert.match(feed,/releases\/download\/v0\.25\.0\/Classmate-Lilith-macOS-arm64.zip/);
  const signature=Buffer.from(feed.match(/edSignature="([^"]+)"/)[1],'base64');
  assert.equal(verify(null,archive,keys.publicKey,signature),true);
  assert.equal(verify(null,Buffer.concat([archive,Buffer.from('changed')]),keys.publicKey,signature),false);
  assert.throws(()=>createMacAppcast({version:'0.25.0',archive,privateKey,expectedPublicKey:'wrong'}),/does not match/);
  assert.throws(()=>createMacAppcast({version:'<xml>',archive,privateKey,expectedPublicKey}),/Invalid release/);
});
