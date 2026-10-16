import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandUI} from './hand_ui.js';
function setup(){
  const cursor={hidden:true,style:{},dataset:{}},source={
    hidden:false,style:{},contains:hit=>hit?.region==='source',
    getBoundingClientRect:()=>({left:700,top:100,width:260,height:220})
  };
  const notes={contains:hit=>hit?.region==='notes'};
  let active=null;const selected=[];
  const controls=createHandUI({source,notes,cursor,elementAt:()=>active,
    viewport:()=>({width:1000,height:800}),
    onSelect:id=>selected.push(id)});
  return {controls,source,cursor,selected,setHit:hit=>active=hit};
}
test('pinch only selects explicit knowledge note, never arbitrary button',()=>{
  const {controls,selected,setHit}=setup();
  const point={x:.2,y:.25};
  setHit({region:'settings',matches:()=>true,dataset:{nodeId:'bad'}});
  assert.equal(controls.action({type:'pinch',point}),'pinch outside notes');
  setHit({region:'notes',matches:()=>true,dataset:{nodeId:'node-a'}});
  assert.equal(controls.action({type:'pinch',point}),'note selected');
  assert.deepEqual(selected,['node-a']);
});
test('fist can move ARKUS source panel only if initiated over source header',()=>{
  const {controls,setHit,source}=setup();
  setHit({region:'notes',closest:()=>null});
  assert.match(controls.action({type:'grab',point:{x:.2,y:.15}}),/outside/);
  assert.equal(controls.action({type:'move',point:{x:.02,y:.98}}),'ignored');
  setHit({region:'source',closest:()=>null});
  assert.equal(controls.action({type:'grab',point:{x:.2,y:.17}}),'source grabbed');
  assert.equal(controls.action({type:'move',point:{x:-1,y:99}}),'source moved');
  assert.equal(source.style.left,'728px'); // viewport-clamped
  assert.equal(source.style.right,'auto');
  assert.equal(controls.action({type:'release'}),'released');
  assert.equal(controls.action({type:'move',point:{x:.5,y:.5}}),'ignored');
});
test('hand cursor is opt-in, mirrored and hidden immediately on loss or stop',()=>{
  const {controls,cursor}=setup();
  controls.sample({kind:'pinch',point:{x:.8,y:.25}});
  assert.equal(cursor.hidden,false);
  assert.equal(cursor.style.left,'200px');assert.equal(cursor.style.top,'200px');
  controls.sample(null);assert.equal(cursor.hidden,true);
  controls.sample({kind:'grab',point:{x:.8,y:.25}});
  controls.stop();assert.equal(cursor.hidden,true);
});
