import { NES } from './src/nes.js';
import { Controller } from './src/controller.js';
// 1. Add this import at the top of nes-embed.js (with other imports):
import { initSaveStates, saveState, loadState, quickSave, quickLoad } from './nes-save-states.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const SCREEN_WIDTH = 256;
const SCREEN_HEIGHT = 240;
const FRAMEBUFFER_SIZE = SCREEN_WIDTH * SCREEN_HEIGHT;

const AUDIO_BUFFER_SIZE = 2048;
const AUDIO_BUFFER_MASK = AUDIO_BUFFER_SIZE - 1;
const PRE_BUFFER_FRAMES = 1; // Buffer this many frames before starting audio

// =============================================================================
// STATE
// =============================================================================

let canvasCtx, imageData, framebufferU8, framebufferU32;

// Audio
let audioCtx, gainNode;
let audioWorkletNode = null;
let scriptProcessor = null;
let usingWorklet = false;

// Sample accumulator - batches samples before sending
const sampleBatchL = new Float32Array(2048);
const sampleBatchR = new Float32Array(2048);
let batchPos = 0;

// Fallback buffer for ScriptProcessor
const fallbackL = new Float32Array(AUDIO_BUFFER_SIZE);
const fallbackR = new Float32Array(AUDIO_BUFFER_SIZE);
let fallbackWrite = 0;
let fallbackRead = 0;

let emulationRunning = false;

// Gamepad
let gamepadIndex = null;
const gamepadState = new Array(16).fill(false);
const GAMEPAD_MAP = {
  0: Controller.BUTTON_B, 1: Controller.BUTTON_A,
  2: Controller.BUTTON_A, 3: Controller.BUTTON_B,
  8: Controller.BUTTON_SELECT, 9: Controller.BUTTON_START,
  12: Controller.BUTTON_UP, 13: Controller.BUTTON_DOWN,
  14: Controller.BUTTON_LEFT, 15: Controller.BUTTON_RIGHT
};

// =============================================================================
// NES
// =============================================================================

export const nes = new NES({
  onFrame(fb24) {
    for (let i = 0; i < FRAMEBUFFER_SIZE; i++) {
      framebufferU32[i] = 0xFF000000 | fb24[i];
    }
  },
  onAudioSample(l, r) {
    if (usingWorklet) {
      // Batch samples for worklet
      sampleBatchL[batchPos] = l;
      sampleBatchR[batchPos] = r;
      batchPos++;
      
      // Flush when batch is full
      if (batchPos >= sampleBatchL.length) {
        flushAudio();
      }
    } else {
      // Direct write for ScriptProcessor fallback
      fallbackL[fallbackWrite] = l;
      fallbackR[fallbackWrite] = r;
      fallbackWrite = (fallbackWrite + 1) & AUDIO_BUFFER_MASK;
    }
  }
});

// =============================================================================
// AUDIO
// =============================================================================

async function initAudio() {
  audioCtx = new AudioContext({ sampleRate: 44100 });
  
  gainNode = audioCtx.createGain();
  gainNode.gain.value = 0.5; // Matches volume slider default
  gainNode.connect(audioCtx.destination);
  
  // Try AudioWorklet
  if (audioCtx.audioWorklet) {
    try {
      await audioCtx.audioWorklet.addModule('nes-audio-worklet.js');
      audioWorkletNode = new AudioWorkletNode(audioCtx, 'nes-audio-processor', {
        outputChannelCount: [2]
      });
      audioWorkletNode.connect(gainNode);
      usingWorklet = true;
      console.log('Audio: AudioWorklet');
      return;
    } catch (e) {
      console.warn('AudioWorklet failed:', e);
    }
  }
  
  // Fallback to ScriptProcessor
  scriptProcessor = audioCtx.createScriptProcessor(512, 0, 2);
  scriptProcessor.onaudioprocess = (e) => {
    const outL = e.outputBuffer.getChannelData(0);
    const outR = e.outputBuffer.getChannelData(1);
    const len = outL.length;
    const avail = (fallbackWrite - fallbackRead) & AUDIO_BUFFER_MASK;
    
    for (let i = 0; i < len; i++) {
      if (i < avail) {
        outL[i] = fallbackL[fallbackRead];
        outR[i] = fallbackR[fallbackRead];
        fallbackRead = (fallbackRead + 1) & AUDIO_BUFFER_MASK;
      } else {
        outL[i] = 0;
        outR[i] = 0;
      }
    }
  };
  scriptProcessor.connect(gainNode);
  console.log('Audio: ScriptProcessor');
}

function flushAudio() {
  if (!usingWorklet || !audioWorkletNode || batchPos === 0) return;
  
  // Send current batch
  const left = sampleBatchL.slice(0, batchPos);
  const right = sampleBatchR.slice(0, batchPos);
  audioWorkletNode.port.postMessage({ type: 'samples', left, right });
  batchPos = 0;
}

// =============================================================================
// MAIN LOOP
// =============================================================================

function onAnimationFrame() {
  requestAnimationFrame(onAnimationFrame);
  if (!emulationRunning) return;
  
  nes.frame();
  flushAudio();
  
  imageData.data.set(framebufferU8);
  canvasCtx.putImageData(imageData, 0, 0);
  
  pollGamepad();
}

// =============================================================================
// INPUT
// =============================================================================

function pollGamepad() {
  if (gamepadIndex === null) return;
  const gp = navigator.getGamepads()[gamepadIndex];
  if (!gp) return;
  
  for (const [btn, nesBtn] of Object.entries(GAMEPAD_MAP)) {
    const pressed = gp.buttons[btn]?.pressed ?? false;
    if (pressed !== gamepadState[btn]) {
      gamepadState[btn] = pressed;
      pressed ? nes.buttonDown(1, nesBtn) : nes.buttonUp(1, nesBtn);
    }
  }
}

function handleKey(callback, e) {
  const map = {
    38: Controller.BUTTON_UP, 40: Controller.BUTTON_DOWN,
    37: Controller.BUTTON_LEFT, 39: Controller.BUTTON_RIGHT,
    65: Controller.BUTTON_A, 81: Controller.BUTTON_A,
    83: Controller.BUTTON_B, 79: Controller.BUTTON_B,
    9: Controller.BUTTON_SELECT, 13: Controller.BUTTON_START
  };
  if (map[e.keyCode] !== undefined) {
    callback(1, map[e.keyCode]);
    e.preventDefault();
  }
}

// =============================================================================
// INIT
// =============================================================================

function nesInit(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return false;
  
  canvasCtx = canvas.getContext('2d');
  imageData = canvasCtx.getImageData(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  canvasCtx.fillStyle = 'black';
  canvasCtx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  
  const buf = new ArrayBuffer(imageData.data.length);
  framebufferU8 = new Uint8ClampedArray(buf);
  framebufferU32 = new Uint32Array(buf);
  return true;
}

async function nesBoot(romData) {
  if (!audioCtx) await initAudio();
  
  // Reset audio state
  batchPos = 0;
  fallbackWrite = 0;
  fallbackRead = 0;
  audioWorkletNode?.port.postMessage({ type: 'reset' });
  
  nes.loadROM(romData);

  initSaveStates(nes, logStatus);
  
  // Pre-buffer audio: run a few frames before starting playback
  for (let i = 0; i < PRE_BUFFER_FRAMES; i++) {
    nes.frame();
  }
  flushAudio();
  
  // Now start audio playback
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  
  emulationRunning = true;
  requestAnimationFrame(onAnimationFrame);
}

function convertRom(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return s;
}

async function nesLoadUrl(canvasId, path) {
  if (!nesInit(canvasId)) return;
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await nesBoot(convertRom(new Uint8Array(await res.arrayBuffer())));
  } catch (e) {
    console.error(e);
    logStatus(`Failed: ${e.message}`, 'error');
  }
}

async function nesLoadData(canvasId, romData) {
  if (!nesInit(canvasId)) return;
  await nesBoot(romData);
}

// =============================================================================
// UI
// =============================================================================

function logStatus(msg, type = 'info') {
  const s = document.getElementById('status');
  if (!s) return;
  if (s.innerHTML.includes('Waiting')) s.innerHTML = '';
  s.innerHTML += `<div class="${type}">${msg}</div>`;
  s.scrollTop = s.scrollHeight;
}

function hideOverlay() {
  const o = document.getElementById('overlay');
  if (o) { o.style.opacity = '0'; setTimeout(() => o.style.display = 'none', 300); }
}

async function startEmulator() {
  hideOverlay();
  logStatus('▶️ Starting...', 'success');
  await nesLoadUrl('nes-canvas', 'roms/BladeBuster.nes');
  logStatus('✓ ROM loaded', 'info');
  if (nes?.rom) logStatus(`📋 Mapper: ${nes.rom.mapperType} (${nes.rom.getMapperName()})`, 'info');
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('gameContainer')?.classList.remove('drag-over');
  
  const file = e.dataTransfer.files[0];
  if (!file?.name.toLowerCase().endsWith('.nes')) {
    logStatus('❌ Drop a .nes file', 'error');
    return;
  }
  
  hideOverlay();
  logStatus(`📦 Loading: ${file.name}`, 'info');
  
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      await nesLoadData('nes-canvas', convertRom(new Uint8Array(ev.target.result)));
      logStatus('✓ ROM loaded', 'success');
      if (nes?.rom) logStatus(`📋 Mapper: ${nes.rom.mapperType} (${nes.rom.getMapperName()})`, 'info');
    } catch (err) {
      logStatus(`❌ ${err.message}`, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function setVolume(v) { if (gainNode) gainNode.gain.value = v * v; }
function pause() { emulationRunning = false; audioCtx?.suspend(); }
function resume() { emulationRunning = true; audioCtx?.resume(); }

export { pause, resume, setVolume };

// =============================================================================
// EVENTS
// =============================================================================

document.addEventListener('keydown', e => handleKey(nes.buttonDown, e));
document.addEventListener('keyup', e => handleKey(nes.buttonUp, e));

window.addEventListener('gamepadconnected', e => {
  gamepadIndex = e.gamepad.index;
  const s = document.getElementById('gamepadStatus');
  if (s) { s.textContent = `Gamepad: ${e.gamepad.id.slice(0,15)}...`; s.className = 'connected'; }
});

window.addEventListener('gamepaddisconnected', e => {
  if (gamepadIndex === e.gamepad.index) {
    gamepadIndex = null;
    const s = document.getElementById('gamepadStatus');
    if (s) { s.textContent = 'Gamepad: Not connected'; s.className = 'disconnected'; }
  }
});

window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('overlay')?.addEventListener('click', startEmulator);
  const gc = document.getElementById('gameContainer');
  if (gc) {
    gc.addEventListener('drop', handleDrop);
    gc.addEventListener('dragover', e => { e.preventDefault(); gc.classList.add('drag-over'); });
    gc.addEventListener('dragleave', () => gc.classList.remove('drag-over'));
  }
  document.getElementById('volume')?.addEventListener('input', e => setVolume(e.target.value / 100));
});

document.getElementById('btn-save')?.addEventListener('click', () => {
  const slot = parseInt(document.getElementById('save-slot').value);
  saveState(slot);
});

document.getElementById('btn-load')?.addEventListener('click', () => {
  const slot = parseInt(document.getElementById('save-slot').value);
  loadState(slot);
});
