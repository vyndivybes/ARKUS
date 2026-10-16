import test from 'node:test';
import assert from 'node:assert/strict';
import {requestScreenCapture} from './screen_capture.js';

test('requests screen capture without a forced displaySurface constraint', async () => {
  let constraints;
  const stream = {};
  const result = await requestScreenCapture({
    getDisplayMedia: async value => { constraints = value; return stream; }
  });
  assert.equal(result, stream);
  assert.deepEqual(constraints, {video: true, audio: false});
});

test('reports unsupported screen sharing clearly', async () => {
  await assert.rejects(requestScreenCapture({}), /supported browser/);
});
