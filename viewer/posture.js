// Local only: image pixels and landmarks never leave this module.
export const POSTURE_SAMPLE_MS = 250;
export const LANDMARK_VISIBILITY = 0.65;
export const HEAD_DROP_THRESHOLD = 0.25;
export const TORSO_COMPRESSION_THRESHOLD = 0.22;
const visible = point => point && Number.isFinite(point.x) && Number.isFinite(point.y)
  && (point.visibility ?? 0) >= LANDMARK_VISIBILITY;

export function poseMeasurements(landmarks) {
  if (!Array.isArray(landmarks)) return null;
  const [nose, leftShoulder, rightShoulder, leftHip, rightHip] = [0, 11, 12, 23, 24].map(i => landmarks[i]);
  if (!visible(leftShoulder) || !visible(rightShoulder)) return null;
  const shoulderWidth = Math.hypot(leftShoulder.x-rightShoulder.x,leftShoulder.y-rightShoulder.y);
  if (shoulderWidth < 0.04) return null;
  const shoulderY = (leftShoulder.y+rightShoulder.y)/2;
  return {
    headClearance: visible(nose) ? (shoulderY-nose.y)/shoulderWidth : null,
    torsoRatio: visible(leftHip) && visible(rightHip) ? ((leftHip.y+rightHip.y)/2-shoulderY)/shoulderWidth : null,
  };
}

export function calibratePose(landmarks) {
  const measurements = poseMeasurements(landmarks);
  if (!measurements || measurements.headClearance === null) {
    throw new Error('Calibration needs a clearly visible nose and both shoulders. Sit comfortably, face the camera, and retry.');
  }
  return Object.freeze({...measurements});
}

export function classifyPose(landmarks, baseline) {
  const measurements = poseMeasurements(landmarks);
  return {
    present: Boolean(measurements),
    head_down: Boolean(measurements && baseline && measurements.headClearance !== null
      && baseline.headClearance-measurements.headClearance > HEAD_DROP_THRESHOLD),
    slouched: Boolean(measurements && baseline && baseline.torsoRatio !== null
      && measurements.torsoRatio !== null && baseline.torsoRatio > 0
      && (baseline.torsoRatio-measurements.torsoRatio)/baseline.torsoRatio > TORSO_COMPRESSION_THRESHOLD),
  };
}

export async function createLocalPosture({video,onSample,onStatus,onError,onLandmarks}) {
  const {FilesetResolver,PoseLandmarker} = await import('/vendor/vision_bundle.mjs');
  const fileset = await FilesetResolver.forVisionTasks('/vendor/wasm');
  const detector = await PoseLandmarker.createFromOptions(fileset,{
    baseOptions:{modelAssetPath:'/models/pose_landmarker_lite.task',delegate:'CPU'},
    runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.6,minPosePresenceConfidence:.6,minTrackingConfidence:.6,
  });
  let stopped=false,pending=false,lastTime=-1,latest=null,baseline=null;
  const stop=()=>{if(stopped)return;stopped=true;clearInterval(timer);latest=null;baseline=null;detector.close();};
  const timer=setInterval(async()=>{
    if(stopped || pending || video.readyState<2 || video.currentTime===lastTime)return;
    lastTime=video.currentTime;pending=true;
    try{
      const result=detector.detectForVideo(video,performance.now());
      latest=result.landmarks?.[0] || null;
      onLandmarks?.(latest);
      const sample=classifyPose(latest,baseline);
      onStatus(baseline?(sample.present?`Local heuristic active · head ${sample.head_down?'lowered':'neutral'} · torso ${baseline.torsoRatio===null?'out of view':sample.slouched?'compressed':'neutral'}`:'Local landmarks not confident: presence unavailable or out of frame.'):'Local inference ready. Sit upright and click Calibrate. Presence only until calibrated.');
      await onSample(sample);
    }catch(error){stop();onError?.(error);}
    finally{pending=false;}
  },POSTURE_SAMPLE_MS);
  return {
    stop,
    calibrate(){if(stopped)throw new Error('Enable posture awareness first.');baseline=calibratePose(latest);return {torsoVisible:baseline.torsoRatio!==null};},
  };
}
