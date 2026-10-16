import test from 'node:test';import assert from 'node:assert/strict';import {validateSceneParts} from './cad_preview.js';
test('render specification normalizes numeric parametric dimensions and positions',()=>{
 const result=validateSceneParts([{shape:'tube',dimensions:{radius:'18',wall:'2',height:'70'},position:[0,10,20]}]);
 assert.equal(result[0].dimensions.radius,18);
 assert.deepEqual(result[0].position,[0,10,20]);
});
test('invalid geometry and excessive assemblies are refused before rendering',()=>{
 assert.throws(()=>validateSceneParts([{shape:'tube',dimensions:{radius:8,wall:12,height:5},position:[0,0,0]}]));
 assert.throws(()=>validateSceneParts([{shape:'box',dimensions:{length:4,width:2,height:6},position:[Number.NaN,0,0]}]));
 assert.throws(()=>validateSceneParts([]));
});
