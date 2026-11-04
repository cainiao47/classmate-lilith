import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedRatio } from '../public/modules/review-splitter.js';
test('review split keeps both panels readable, clamps persisted sizes and refuses a narrow layout',()=>{
  assert.equal(boundedRatio(.6,1014,520,300),.6);
  assert.equal(boundedRatio(-2,1014,520,300),.52);
  assert.equal(boundedRatio(5,1014,520,300),.7);
  assert.equal(boundedRatio(.5,800,520,300),null);
  assert.equal(boundedRatio(.7,534,260,260),.5);
  assert.equal(boundedRatio('broken',1014,520,300),.6);
});
