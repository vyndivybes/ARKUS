export async function requestScreenCapture(mediaDevices) {
  if (typeof mediaDevices?.getDisplayMedia !== 'function') {
    throw new Error('Screen sharing requires a supported browser on localhost or HTTPS.');
  }
  return mediaDevices.getDisplayMedia({ video: true, audio: false });
}
