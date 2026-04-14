import { useCallback, useRef } from "react";

const audioCtxRef = { current: null as AudioContext | null };

function getAudioContext() {
  if (!audioCtxRef.current) {
    audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtxRef.current;
}

function playBeep(freq: number, duration: number, type: OscillatorType = "sine") {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = 0.1;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.stop(ctx.currentTime + duration);
  } catch {}
}

export function usePosSound(enabled: boolean) {
  const scanBeep = useCallback(() => {
    if (!enabled) return;
    playBeep(1200, 0.1);
  }, [enabled]);

  const addBeep = useCallback(() => {
    if (!enabled) return;
    playBeep(800, 0.08);
  }, [enabled]);

  const errorBeep = useCallback(() => {
    if (!enabled) return;
    playBeep(300, 0.3, "square");
  }, [enabled]);

  const successChime = useCallback(() => {
    if (!enabled) return;
    playBeep(523, 0.1);
    setTimeout(() => playBeep(659, 0.1), 100);
    setTimeout(() => playBeep(784, 0.15), 200);
  }, [enabled]);

  return { scanBeep, addBeep, errorBeep, successChime };
}
