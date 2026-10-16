// Opt-in, entirely on-device MediaPipe hand tracking. No camera pixels, landmarks,
// clicks, files or external desktop window handles are sent to a server.
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const bounded=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)
  &&p.x>=-.1&&p.x<=1.1&&p.y>=-.1&&p.y<=1.1;

export function classifyHand(landmarks){
  if(!Array.isArray(landmarks)||landmarks.length<21)return null;
  const required=[0,4,5,8,9,12,13,16,17,20];
  if(required.some(i=>!bounded(landmarks[i])))return null;
  const scale=distance(landmarks[5],landmarks[17]);
  if(scale<.045||scale>.7)return null; // Unreliable, distant or malformed hand.
  const thumb=landmarks[4],index=landmarks[8];
  const pinch=distance(thumb,index)<scale*.35;
  const fingertips=[8,12,16,20],knuckles=[5,9,13,17];
  const ratios=fingertips.map((tip,i)=>distance(landmarks[tip],landmarks[knuckles[i]])/scale);
  let kind=null,point=null;
  if(pinch){
    kind='pinch';point={x:(thumb.x+index.x)/2,y:(thumb.y+index.y)/2};
  }else if(ratios.every(r=>r<.65)){
    kind='grab';point={x:landmarks[9].x,y:landmarks[9].y};
  }else if(ratios.every(r=>r>1.05)){
    kind='release';point={x:landmarks[9].x,y:landmarks[9].y};
  }
  return kind?{kind,point}:null;
}

export class HandGestureGate {
  constructor({holdMs=260,releaseMs=150,lossMs=400}={}){
    this.holdMs=holdMs;this.releaseMs=releaseMs;this.lossMs=lossMs;
    this.reset();
  }
  reset(){
    const hadActive=Boolean(this.active);
    this.active=null;this.candidate=null;this.since=0;this.lastSeen=null;this.releaseSince=null;
    return hadActive?{type:'release'}:null;
  }
  accept(sample,now=performance.now()){
    if(!sample){
      if(this.active&&this.lastSeen!==null&&now-this.lastSeen>this.lossMs)return this.reset();
      if(!this.active)this.candidate=null;
      return null;
    }
    if(!['pinch','grab','release'].includes(sample.kind)||!bounded(sample.point))return null;
    this.lastSeen=now;
    if(this.active){
      if(sample.kind==='release'){
        if(this.releaseSince===null)this.releaseSince=now;
        if(now-this.releaseSince>=this.releaseMs)return this.reset();
        return null;
      }
      this.releaseSince=null;
      if(sample.kind!==this.active.kind)return this.reset();
      return sample.kind==='grab'?{type:'move',point:sample.point}:null;
    }
    if(sample.kind==='release'){this.candidate=null;return null;}
    if(this.candidate!==sample.kind){this.candidate=sample.kind;this.since=now;return null;}
    if(now-this.since<this.holdMs)return null;
    this.active={kind:sample.kind};
    return {type:sample.kind,point:sample.point};
  }
}

export function clampHandPanelPosition(left,top,viewport,panel){
  if(![left,top,viewport?.width,viewport?.height,panel?.width,panel?.height].every(Number.isFinite)){
    throw new Error('Invalid hand panel coordinates.');
  }
  const clamp=(x,min,max)=>Math.max(min,Math.min(Math.max(min,max),x));
  return {
    left:clamp(Math.round(left),12,viewport.width-panel.width-12),
    top:clamp(Math.round(top),12,viewport.height-panel.height-12),
  };
}

export async function createLocalHandTracking({
  video,onSample=()=>{},onGesture=()=>{},onError=()=>{},
  loadVision=()=>import('/vendor/vision_bundle.mjs')
}){
  const {FilesetResolver,HandLandmarker}=await loadVision();
  const fileset=await FilesetResolver.forVisionTasks('/vendor/wasm');
  const detector=await HandLandmarker.createFromOptions(fileset,{
    baseOptions:{modelAssetPath:'/models/hand_landmarker.task',delegate:'CPU'},
    runningMode:'VIDEO',numHands:1,minHandDetectionConfidence:.65,
    minHandPresenceConfidence:.65,minTrackingConfidence:.65,
  });
  const gate=new HandGestureGate();
  let stopped=false,pending=false,lastTime=-1;
  const stop=()=>{
    if(stopped)return;
    stopped=true;clearInterval(timer);
    const release=gate.reset();
    if(release)onGesture(release);
    onSample(null);
    detector.close();
  };
  const timer=setInterval(async()=>{
    if(stopped||pending||video.readyState<2||video.currentTime===lastTime)return;
    lastTime=video.currentTime;pending=true;
    try{
      const results=detector.detectForVideo(video,performance.now());
      if(stopped)return;
      const sample=classifyHand(results.landmarks?.[0]||null);
      onSample(sample);
      const action=gate.accept(sample);
      if(action)onGesture(action);
    }catch(error){stop();onError(error);}
    finally{pending=false;}
  },90);
  return {stop};
}
