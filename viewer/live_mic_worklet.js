// Microphone capture inside AudioWorklet. No speech recognition and no network access.
// Sample blocks are transferred to the trusted local UI thread for 16 kHz encoding.
class ArkusLiveCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(2048);
    this.used = 0;
  }
  process(inputs, outputs) {
    // Every output is silence; never feed microphone sound into speakers.
    for(const output of outputs) for(const channel of output)channel.fill(0);
    const channels=inputs[0];
    if(channels?.[0]){
      const pcm=channels[0];
      for(let n=0;n<pcm.length;n++){
        this.frame[this.used++]=pcm[n];
        if(this.used===this.frame.length){
          this.port.postMessage(this.frame,[this.frame.buffer]);
          this.frame=new Float32Array(2048);
          this.used=0;
        }
      }
    }
    return true;
  }
}
registerProcessor('arkus-live-capture',ArkusLiveCapture);
