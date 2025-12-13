// =============================================================================
// NES Audio Worklet - with proper underrun handling
// =============================================================================

class NESAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    
    this.bufferSize = 2048;
    this.bufferMask = this.bufferSize - 1;
    this.samplesL = new Float32Array(this.bufferSize);
    this.samplesR = new Float32Array(this.bufferSize);
    this.writeIndex = 0;
    this.readIndex = 0;
    
    this.port.onmessage = (event) => {
      if (event.data.type === 'samples') {
        const { left, right } = event.data;
        const count = left.length;
        
        for (let i = 0; i < count; i++) {
          this.samplesL[this.writeIndex] = left[i];
          this.samplesR[this.writeIndex] = right[i];
          this.writeIndex = (this.writeIndex + 1) & this.bufferMask;
        }
      } else if (event.data.type === 'reset') {
        this.samplesL.fill(0);
        this.samplesR.fill(0);
        this.writeIndex = 0;
        this.readIndex = 0;
      }
    };
  }
  
  available() {
    return (this.writeIndex - this.readIndex) & this.bufferMask;
  }
  
  process(inputs, outputs, parameters) {
    const outputL = outputs[0][0];
    const outputR = outputs[0][1];
    const len = outputL.length;
    const avail = this.available();
    
    if (avail >= len) {
      // Normal playback
      for (let i = 0; i < len; i++) {
        outputL[i] = this.samplesL[this.readIndex];
        outputR[i] = this.samplesR[this.readIndex];
        this.readIndex = (this.readIndex + 1) & this.bufferMask;
      }
    } else {
      // Underrun - play what we have, then hold last sample
      let lastL = 0, lastR = 0;
      
      for (let i = 0; i < len; i++) {
        if (i < avail) {
          lastL = outputL[i] = this.samplesL[this.readIndex];
          lastR = outputR[i] = this.samplesR[this.readIndex];
          this.readIndex = (this.readIndex + 1) & this.bufferMask;
        } else {
          // Fade to silence to avoid clicks
          const fade = 1 - ((i - avail) / (len - avail));
          outputL[i] = lastL * fade;
          outputR[i] = lastR * fade;
        }
      }
    }
    
    return true;
  }
}

registerProcessor('nes-audio-processor', NESAudioProcessor);
