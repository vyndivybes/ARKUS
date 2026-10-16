// Local contactless controls derived from existing on-device MediaPipe pose landmarks.
// This is arm-raise detection, NOT pinch, hand pose, or identity recognition.
function visible(p){return p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&(p.visibility??0)>=0.7}
export function classifyGesture(pose){
 if(!Array.isArray(pose)||pose.length<17)return null;
 const [leftShoulder,rightShoulder,leftWrist,rightWrist]=[11,12,15,16].map(n=>pose[n]);
 if(!visible(leftShoulder)||!visible(rightShoulder))return null;
 const left=visible(leftWrist)&&leftWrist.y<leftShoulder.y-.18;
 const right=visible(rightWrist)&&rightWrist.y<rightShoulder.y-.18;
 return left&&right?'both':left?'left':right?'right':null;
}
export class GestureGate{
 constructor({holdMs=650,cooldownMs=1800}={}){this.holdMs=holdMs;this.cooldownMs=cooldownMs;this.pose=null;this.since=0;this.last=-Infinity;this.fired=false;}
 accept(pose,now=performance.now()){
  if(!pose){this.pose=null;this.since=now;this.fired=false;return null;}
  if(this.pose!==pose){this.pose=pose;this.since=now;this.fired=false;return null;}
  if(this.fired||now-this.since<this.holdMs||now-this.last<this.cooldownMs)return null;
  this.fired=true;this.last=now;return pose;
 }
}
