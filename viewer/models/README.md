# Local posture model

`pose_landmarker_lite.task` is the official Google MediaPipe Pose Landmarker Lite float16 model, downloaded from:

https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task

SHA-256: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`

Runtime documentation and model information: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker

The runtime comes from pinned `@mediapipe/tasks-vision` and its Apache-2.0 licensed distribution. Model notices and license terms remain with the upstream model publisher; verify them before commercial redistribution. All inference assets are served locally. No model download or camera frame upload occurs at runtime.

## Hand tracking model (optional)

`hand_landmarker.task` is downloaded only by `npm run prepare:hand-model` or Windows packaging, not by the running application. The source is pinned to the published ADA V2 public model asset at commit `d005af742fc5c604074b8b92bd9a223d7fca7447` (`public/hand_landmarker.task`; 7,819,105 bytes), with Git blob SHA-1 `0d53faf3786146e95c5bc010c48029ff16b7fa59`. Installer verification rejects changes or unexpectedly sized downloads. ADA V2's code repository is MIT-licensed; model files may carry separate original-publisher terms. Verify those terms before commercial redistribution. Local hand landmark inference uses the already pinned MediaPipe runtime, never uploads hand landmark data, and runs only after camera preview plus separate hand-gesture consent.
