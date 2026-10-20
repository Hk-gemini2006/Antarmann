'use client';
import { useState, useRef, useEffect } from 'react';

const TECHNIQUES = {
  anapana:        { name: 'Anapana',               sub: 'breath awareness',          family: 'breath' },
  breath_478:     { name: '4-7-8 Breathing',       sub: 'follow the orb',            family: 'breath478' },
  body_scan:      { name: 'Body Scan',             sub: 'moving attention slowly',   family: 'body' },
  grounding:      { name: '5-4-3-2-1 Grounding',   sub: 'arriving in your senses',   family: 'ground' },
  walking:        { name: 'Walking Meditation',    sub: 'one step at a time',        family: 'ground' },
  metta:          { name: 'Metta',                 sub: 'loving-kindness',           family: 'heart' },
  self_compassion:{ name: 'Self-Compassion Pause', sub: 'kindness toward yourself',  family: 'heart' },
  tonglen:        { name: 'Tonglen',               sub: 'taking in, sending out',    family: 'heart' },
  metta_absent:   { name: 'Metta for the Absent',  sub: 'warmth for someone missed', family: 'heart' },
  trataka:        { name: 'Trataka',               sub: 'steady gaze',               family: 'focus' },
  mantra:         { name: 'Mantra',                sub: 'inner rhythm',              family: 'focus' },
  choiceless:     { name: 'Choiceless Awareness',  sub: 'letting everything be',     family: 'space' },
  noting:         { name: 'Noting',                sub: 'naming what arises',        family: 'space' },
  neti_neti:      { name: 'Neti Neti',             sub: 'not this, not this',        family: 'space' },
  witness:        { name: 'Witness Consciousness', sub: 'watching thoughts pass',    family: 'space' },
  impermanence:   { name: 'Impermanence',          sub: 'everything changes',        family: 'space' },
  yoga_nidra:     { name: 'Yoga Nidra',            sub: 'deep rest',                 family: 'rest' },
  visualization:  { name: 'Visualization',         sub: 'a safe inner space',        family: 'rest' },
};

const SPEECH_RMS = 0.02;
const SILENCE_MS = 400;

// Barge-in: how confidently the mic has to hear real speech, while
// Antarmann is talking, before it stops itself and listens. Higher
// threshold + a required sustain window than normal speech detection,
// specifically to avoid the speaker's own voice leaking into the mic
// and triggering a false interruption.
const BARGE_IN_RMS = 0.045;
const BARGE_IN_GRACE_MS = 500;
const BARGE_IN_SUSTAIN_MS = 250;

// Pre-practice settling: a brief, visible threshold before a technique's
// first instruction, so beginning a practice feels like crossing into
// something rather than the app just talking faster. Kept short for the
// acute/distress techniques — someone already in distress shouldn't be
// made to wait through a ritual.
const PREP_MS_DEFAULT = 12000;
const PREP_MS_SHORT = 6000;
const PREP_SHORT_KEYS = new Set(['anapana', 'breath_478', 'grounding']);

// Pool of ambient tracks. One is picked at random each session start
// and used for the entire session (prep + practice), so it feels
// consistent within a session but varies across sessions.
const AMBIENT_POOL = [
  '/sounds/ambient_atlas.mp3',
  '/sounds/ambient_leberch.mp3',
  '/sounds/ambient_marlowe.mp3',
  '/sounds/ambient_deep_hum.mp3',
  '/sounds/ambient_flute.mp3',
  '/sounds/ambient_rain.mp3',
  '/sounds/ambient_tanpura.mp3',
  '/sounds/ambient_veena.mp3',
];

// Pick once per page load — stable across the session.
// Assigned inside a ref (client-only) to avoid SSR/hydration mismatch.
// Do NOT call Math.random() at module level in a Next.js client component.

const AMBIENT_PREP_GAIN = 0.55;      // during the settling countdown
const AMBIENT_PRACTICE_GAIN = 0.32;  // ducked, through the practice itself

// Rotating idle prompts — one picked per session, shown below the orb
// to give first-time users a sense of what to say.
const IDLE_PROMPTS = [
  "what\'s stirring right now?",
  'how does this moment feel?',
  "what\'s weighing on you today?",
  "what\'s alive in you right now?",
  'what does this day feel like?',
  "just speak — I\'m here",
  "what\'s on your mind?",
  "something you\'ve been carrying?",
  'what brought you here today?',
  'how are you, really?',
];

export default function Home() {
  const [status, setStatus] = useState('idle'); // idle | listening | thinking | speaking | preparing | practicing
  const [technique, setTechnique] = useState(null);
  const [notice, setNotice] = useState('');
  const [prepSecondsLeft, setPrepSecondsLeft] = useState(0);
  const [practiceTimeText, setPracticeTimeText] = useState('0:00');
  const [practiceProgress, setPracticeProgress] = useState(0);
  const [userName, setUserName] = useState('');
  const [idlePrompt, setIdlePrompt] = useState('');
  const [isPaused, setIsPaused] = useState(false);

  const phaseRef = useRef('idle');
  const modeRef = useRef('grounding');
  const activeRef = useRef(false);
  const historyRef = useRef([]);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const rafRef = useRef(null);
  const hasSpokenRef = useRef(false);
  const silenceStartRef = useRef(null);
  const recordingActiveRef = useRef(false);
  const levelRef = useRef(0);
  const audioRef = useRef(null);
  const audioResolveRef = useRef(null);
  const iosUnlockedRef = useRef(null);        // pre-unlocked Audio element for TTS (iOS)
  const iosAmbientUnlockedRef = useRef(null); // pre-unlocked Audio element for ambient (iOS)
  const rootRef = useRef(null);
  const isProcessingRef = useRef(false);

  // Barge-in tracking
  const speakingAudioStartRef = useRef(0);
  const interruptVoiceStartRef = useRef(null);

  // Pre-practice settling
  const ambientRef = useRef(null);
  // Picked once client-side to avoid SSR/hydration mismatch from Math.random()
  const sessionAmbientRef = useRef(null);
  const prepResolveRef = useRef(null);
  const prepTimerRef = useRef(null);
  const prepStartRef = useRef(0);

  // Practice-duration timer
  const practiceDurationMsRef = useRef(0);
  const practiceEndTimerRef = useRef(null);
  const timeTickerRef = useRef(null);
  const pausedAtRef = useRef(0);       // timestamp when pause began
  const pausedElapsedRef = useRef(0);  // ms already elapsed before this pause
  const isPausedRef = useRef(false);

  // What Claude has already spoken in this specific practice. Passed
  // back to the practice route each check-in so it can explicitly
  // avoid repeating itself.
  const practiceUtterancesRef = useRef([]);

  // Name — stored in localStorage so it persists per browser. Loaded
  // from storage on mount; the ref lets other handlers read it without
  // waiting for a React re-render.
  const nameRef = useRef('');
  const awaitingNameRef = useRef(false);
  const nameAttemptsRef = useRef(0);

  // Practice-mode state
  const techniqueRef = useRef(null);
  const practiceStartRef = useRef(0);
  const lastSpokenAtRef = useRef(0);
  const cycleCountRef = useRef(0);
  const isCheckingRef = useRef(false);
  const practiceTimerRef = useRef(null);

  // ── Pacing: measured live from how this specific person talks ──
  const wpmSamplesRef = useRef([]);
  const latencySamplesRef = useRef([]);
  const listenStartAtRef = useRef(0);
  const firstSpeechAtRef = useRef(0);
  const lastUtteranceDurationMsRef = useRef(0);

  function avg(arr, fallback) {
    if (!arr.length) return fallback;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function getPaceProfile() {
    const wpm = avg(wpmSamplesRef.current, 130);
    const latencyMs = avg(latencySamplesRef.current, 1500);
    let label = 'moderate';
    if (wpm < 100 || latencyMs > 2500) label = 'slow';
    else if (wpm > 160 && latencyMs < 1000) label = 'quick';
    return { wpm: Math.round(wpm), latencyMs: Math.round(latencyMs), label };
  }

  function recordUtterancePace(text) {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    const durationSec = lastUtteranceDurationMsRef.current / 1000;
    if (durationSec > 1 && words > 0) {
      const wpm = Math.min(220, Math.max(40, (words / durationSec) * 60));
      wpmSamplesRef.current.push(wpm);
      if (wpmSamplesRef.current.length > 6) wpmSamplesRef.current.shift();
    }
  }

  // Pull a name out of a free-form response like "I'm Himanshu" or
  // "my name is Riya". Returns an empty string if nothing name-shaped
  // was found; the caller then re-asks.
  function extractName(text) {
    if (!text) return '';
    let s = text.trim()
      .replace(/[.?!,]+$/, '')
      .replace(/^(hi|hello|hey|yes|yeah|sure|well|um|uh|oh|okay|ok)[,.\s]+/i, '')
      .replace(/^(i\s*['']?\s*m|i\s*am|my\s*name\s*is|the\s*name\s*is|this\s*is|it\s*['']?\s*s|its|call\s*me|you\s*can\s*call\s*me|name\s*is)\s+/i, '')
      .trim();
    const first = (s.split(/\s+/)[0] || '').replace(/[^\p{L}'-]/gu, '');
    if (first.length < 2 || first.length > 24) return '';
    const nonNames = new Set(['no', 'nope', 'nothing', 'dont', 'don', 'rather', 'maybe', 'actually', 'skip', 'fine', 'okay', 'anonymous']);
    if (nonNames.has(first.toLowerCase())) return '';
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }

  // Speak a hardcoded string directly through the TTS endpoint and the
  // same interruptible player as other speech. Used for the greeting
  // and name-question flow that bypasses /api/chat.
  async function speakRaw(text) {
    if (!activeRef.current) return { interrupted: false };
    // Resume AudioContext before every TTS play — critical on mobile Chrome.
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== 'running') { try { await ctx.resume(); } catch (e) {} }
    try {
      setPhase('speaking');
      const res = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return { interrupted: false };
      const blob = await res.blob();
      if (!activeRef.current) return { interrupted: false };
      return await playInterruptible(blob);
    } catch (e) {
      return { interrupted: false };
    }
  }

  function setPhase(p) {
    phaseRef.current = p;
    setStatus(p);
  }

  function flash(msg) {
    setNotice(msg);
    setTimeout(() => setNotice(''), 4500);
  }

  // ── Session ─────────────────────────────────────────────────
  async function startSession() {
    if (activeRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      // AudioContext was already created synchronously in handleOrbClick
      // to preserve the mobile gesture unlock — reuse it here.
      const ctx = audioCtxRef.current || new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      await ctx.resume().catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;

      activeRef.current = true;
      historyRef.current = [];
      modeRef.current = 'grounding';
      wpmSamplesRef.current = [];
      latencySamplesRef.current = [];
      setTechnique(null);
      track('session_start', { name: nameRef.current || 'unknown' });
      runLoop();

      // First-ever session (no name saved): ask for a name before
      // anything else. The response is handled in handleGroundingStop,
      // which checks awaitingNameRef and routes accordingly.
      if (!nameRef.current) {
        awaitingNameRef.current = true;
        nameAttemptsRef.current = 0;
        await speakRaw('Welcome to Antarmann. Before we begin — what may I call you?');
        if (!activeRef.current) return;
      }
      beginListening();
    } catch (e) {
      flash('Antarmann needs your microphone to listen. Please allow access and try again.');
    }
  }

  function endSession() {
    activeRef.current = false;
    cancelAnimationFrame(rafRef.current);
    clearTimeout(practiceTimerRef.current);
    clearTimeout(practiceEndTimerRef.current);
    clearInterval(timeTickerRef.current);
    clearInterval(prepTimerRef.current);
    prepResolveRef.current = null;
    setPracticeTimeText('0:00');
    setPracticeProgress(0);
    stopAmbient(0);
    const rec = recorderRef.current;
    if (rec) {
      rec.onstop = null;
      if (rec.state === 'recording') rec.stop();
    }
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    audioResolveRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close();
    streamRef.current = null;
    audioCtxRef.current = null;
    // Reset iOS unlock elements so next session re-unlocks cleanly.
    try {
      if (iosUnlockedRef.current && iosUnlockedRef.current.parentNode) {
        iosUnlockedRef.current.parentNode.removeChild(iosUnlockedRef.current);
      }
    } catch {}
    iosUnlockedRef.current = null;
    try {
      if (iosAmbientUnlockedRef.current && iosAmbientUnlockedRef.current.parentNode) {
        iosAmbientUnlockedRef.current.parentNode.removeChild(iosAmbientUnlockedRef.current);
      }
    } catch {}
    iosAmbientUnlockedRef.current = null;
    analyserRef.current = null;
    historyRef.current = [];
    levelRef.current = 0;
    recordingActiveRef.current = false;
    isProcessingRef.current = false;
    isCheckingRef.current = false;
    modeRef.current = 'grounding';
    techniqueRef.current = null;
    rootRef.current?.style.setProperty('--level', '0');
    setTechnique(null);
    setPhase('idle');
  }

  // ── Plays a TTS reply while the mic stays live for a real barge-in.
  // Resolves { interrupted: true } the moment real speech is detected
  // over Antarmann's own voice; { interrupted: false } on natural end.
  async function playInterruptible(blob) {
    // Always resume AudioContext before playing.
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== 'running') { try { await ctx.resume(); } catch (e) {} }
    return new Promise(resolve => {
      const url = URL.createObjectURL(blob);
      // Reuse the pre-unlocked iOS audio element if available (swap src),
      // otherwise create a new one. Reusing avoids needing a new gesture.
      const audio = iosUnlockedRef.current || new Audio();
      audio.setAttribute('playsinline', '');
      audio.setAttribute('webkit-playsinline', '');
      if (!audio.parentNode) {
        audio.style.display = 'none';
        document.body.appendChild(audio);
      }
      audio.src = url;
      audio.load();
      audioRef.current = audio;
      audioResolveRef.current = resolve;
      speakingAudioStartRef.current = performance.now();
      interruptVoiceStartRef.current = null;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
        audioResolveRef.current = null;
        resolve({ interrupted: false });
      };
      audio.play().catch(() => {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
        audioResolveRef.current = null;
        resolve({ interrupted: false });
      });
    });
  }

  function bargeIn() {
    if (phaseRef.current === 'preparing') return interruptPrep();
    const resolve = audioResolveRef.current;
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.pause();
      audioRef.current = null;
    }
    audioResolveRef.current = null;
    interruptVoiceStartRef.current = null;
    if (resolve) resolve({ interrupted: true });
  }

  // ── Ambient audio playback (real audio file via Web Audio graph).
  // The file loops. postGain is the volume handle for fades and ducking.
  async function startAmbient(_family) {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    stopAmbient(0);

    try {
      if (ctx.state !== 'running') await ctx.resume();
    } catch (e) {}

    const src = sessionAmbientRef.current || AMBIENT_POOL[0];

    try {
      // Reuse the pre-unlocked ambient element (src-swap) — same pattern
      // as TTS. A freshly created Audio element won't play on iOS after
      // async gaps since the tap gesture is gone by then.
      const audio = iosAmbientUnlockedRef.current || new Audio();
      audio.loop = true;
      audio.volume = 0;
      audio.preload = 'auto';
      audio.setAttribute('playsinline', '');
      audio.setAttribute('webkit-playsinline', '');
      if (!audio.parentNode) {
        audio.style.display = 'none';
        document.body.appendChild(audio);
      }
      audio.src = src;
      audio.load();

      await audio.play();

      // Fade volume in using audio.volume directly — avoids
      // createMediaElementSource which breaks on iOS WebKit.
      const fadeSteps = 24;
      const fadeMs = 2400;
      const target = AMBIENT_PREP_GAIN;
      let step = 0;
      const fadeTimer = setInterval(() => {
        step++;
        audio.volume = Math.min(target, (step / fadeSteps) * target);
        if (step >= fadeSteps) clearInterval(fadeTimer);
      }, fadeMs / fadeSteps);

      // Stub postGain so duckAmbient/stopAmbient callers don't crash.
      const postGain = {
        _audio: audio,
        _fadeTimer: fadeTimer,
        gain: { value: audio.volume },
        cancelScheduledValues: () => {},
        setValueAtTime: () => {},
        linearRampToValueAtTime: (val) => { audio.volume = Math.max(0.0001, val); },
      };

      ambientRef.current = { audio, source: null, postGain };
    } catch (e) {}
  }

  function duckAmbient(targetGain = AMBIENT_PRACTICE_GAIN, fadeMs = 1800) {
    const a = ambientRef.current;
    if (!a) return;
    // Fade audio.volume directly (works on iOS where Web Audio graph may not be used).
    const steps = 20;
    const interval = fadeMs / steps;
    const start = a.audio.volume;
    let step = 0;
    const t = setInterval(() => {
      step++;
      a.audio.volume = Math.max(0, Math.min(1, start + (targetGain - start) * (step / steps)));
      if (step >= steps) clearInterval(t);
    }, interval);
  }

  function stopAmbient(fadeMs = 1500) {
    const a = ambientRef.current;
    if (!a) return;
    ambientRef.current = null;
    // Fade volume to 0 then stop — works whether or not Web Audio graph is used.
    if (fadeMs <= 0) {
      try { a.audio.pause(); a.audio.src = ''; a.audio.load(); } catch {}
      try { if (a.source) a.source.disconnect(); } catch {}
      try { if (a.postGain && a.postGain.disconnect) a.postGain.disconnect(); } catch {}
      try { if (a.audio.parentNode) a.audio.parentNode.removeChild(a.audio); } catch {}
      return;
    }
    const steps = 20;
    const interval = fadeMs / steps;
    const startVol = a.audio.volume;
    let step = 0;
    const t = setInterval(() => {
      step++;
      a.audio.volume = Math.max(0, startVol * (1 - step / steps));
      if (step >= steps) {
        clearInterval(t);
        try { a.audio.pause(); a.audio.src = ''; a.audio.load(); } catch {}
        try { if (a.source) a.source.disconnect(); } catch {}
        try { if (a.postGain && a.postGain.disconnect) a.postGain.disconnect(); } catch {}
        try { if (a.audio.parentNode) a.audio.parentNode.removeChild(a.audio); } catch {}
      }
    }, interval);
  }

  // ── Synthesized return-chime. The "awareness" variant is a soft,
  // warm chime that Claude rings when it judges the mind has drifted
  // and a gentle return cue is called for — not a scheduled bell. The
  // "closing" variant is longer and lower, rung once at the natural
  // end of a timed practice before falling back into conversation.
  function ringBell(variant = 'awareness') {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const isClosing = variant === 'closing';

    // Warm, pure tones (little inharmonic content) so it doesn't jar.
    // Awareness: a soft chime around A5, octave partial, quick-ish decay.
    // Closing: lower C5, with a warm octave for body, longer decay.
    const fundamental = isClosing ? 523 : 880;
    const duration = isClosing ? 5.5 : 2.6;
    const peak = isClosing ? 0.11 : 0.07;
    const attack = isClosing ? 0.12 : 0.09;

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const now = ctx.currentTime;
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(peak, now + attack);
    master.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    // Pure sines with just an octave partial — no bright metallic harmonics.
    const harmonics = isClosing
      ? [[1, 1.0], [2, 0.3]]
      : [[1, 1.0], [2, 0.22]];
    harmonics.forEach(([mult, amp]) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = fundamental * mult;
      const g = ctx.createGain();
      g.gain.value = amp;
      o.connect(g);
      g.connect(master);
      o.start(now);
      o.stop(now + duration + 0.1);
    });
  }

  // ── Pre-practice settling countdown. Resolves naturally when time is
  // up, early via skipPrep() (orb tap — "I'm ready, go ahead"), or via
  // interruptPrep() (voice detected — "wait, let me say something").
  function playPrepCountdown(ms) {
    return new Promise(resolve => {
      prepResolveRef.current = resolve;
      const start = performance.now();
      prepStartRef.current = start;
      setPrepSecondsLeft(Math.ceil(ms / 1000));
      rootRef.current?.style.setProperty('--prep', '0');
      prepTimerRef.current = setInterval(() => {
        const elapsed = performance.now() - start;
        const left = Math.max(0, ms - elapsed);
        setPrepSecondsLeft(Math.ceil(left / 1000));
        rootRef.current?.style.setProperty('--prep', Math.min(1, elapsed / ms).toFixed(3));
        if (left <= 0) {
          clearInterval(prepTimerRef.current);
          prepResolveRef.current = null;
          resolve({ interrupted: false });
        }
      }, 200);
    });
  }

  function skipPrep() {
    const resolve = prepResolveRef.current;
    if (!resolve) return;
    clearInterval(prepTimerRef.current);
    prepResolveRef.current = null;
    resolve({ interrupted: false });
  }

  function interruptPrep() {
    const resolve = prepResolveRef.current;
    if (!resolve) return;
    clearInterval(prepTimerRef.current);
    prepResolveRef.current = null;
    resolve({ interrupted: true });
  }

  // ── Shared audio-level + speech/silence/barge-in detection ──
  function runLoop() {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);

    const tick = () => {
      if (!analyserRef.current) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();

      if (recordingActiveRef.current) {
        const target = Math.min(1, rms * 7);
        levelRef.current += (target - levelRef.current) * 0.18;

        if (rms > SPEECH_RMS) {
          if (!hasSpokenRef.current) {
            firstSpeechAtRef.current = now;
            const latency = now - listenStartAtRef.current;
            if (latency > 50 && latency < 45000) {
              latencySamplesRef.current.push(latency);
              if (latencySamplesRef.current.length > 8) latencySamplesRef.current.shift();
            }
            if (modeRef.current === 'practice') setPhase('listening');
          }
          hasSpokenRef.current = true;
          silenceStartRef.current = null;
        } else if (hasSpokenRef.current) {
          if (silenceStartRef.current === null) {
            silenceStartRef.current = now;
            lastUtteranceDurationMsRef.current = Math.max(300, now - firstSpeechAtRef.current);
            // Show thinking immediately when silence begins — user sees
            // instant feedback rather than waiting for the full SILENCE_MS.
            if (modeRef.current === 'grounding') setPhase('thinking');
          } else if (now - silenceStartRef.current > SILENCE_MS) {
            finishSpeaking();
          }
        }
      } else if ((phaseRef.current === 'speaking' && audioRef.current) || phaseRef.current === 'preparing') {
        // Antarmann is talking, or settling into a practice — the mic
        // stays live either way so a real interruption can cut it off,
        // the way a person would.
        const refStart = phaseRef.current === 'preparing' ? prepStartRef.current : speakingAudioStartRef.current;
        const sinceStart = now - refStart;
        if (sinceStart > BARGE_IN_GRACE_MS) {
          if (rms > BARGE_IN_RMS) {
            if (interruptVoiceStartRef.current === null) interruptVoiceStartRef.current = now;
            else if (now - interruptVoiceStartRef.current > BARGE_IN_SUSTAIN_MS) {
              bargeIn();
            }
          } else {
            interruptVoiceStartRef.current = null;
          }
        }
        levelRef.current *= 0.9;
      } else {
        levelRef.current *= 0.9;
      }

      rootRef.current?.style.setProperty('--level', levelRef.current.toFixed(3));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }

  function finishSpeaking() {
    if (!recordingActiveRef.current) return;
    if (modeRef.current === 'grounding') setPhase('thinking');
    recorderRef.current?.stop();
  }

  // ── Grounding mode (Phase 1: ordinary conversation) ─────────
  function beginListening() {
    if (!activeRef.current || !streamRef.current || modeRef.current !== 'grounding') return;
    chunksRef.current = [];
    hasSpokenRef.current = false;
    silenceStartRef.current = null;
    listenStartAtRef.current = performance.now();
    recordingActiveRef.current = true;
    const rec = new MediaRecorder(streamRef.current);
    rec.ondataavailable = e => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = handleGroundingStop;
    recorderRef.current = rec;
    rec.start();
    setPhase('listening');
  }

  async function handleGroundingStop() {
    recordingActiveRef.current = false;
    if (!activeRef.current || isProcessingRef.current) return;
    isProcessingRef.current = true;
    setPhase('thinking');
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    if (blob.size < 2000) { isProcessingRef.current = false; return beginListening(); }

    try {
      const form = new FormData();
      form.append('audio', blob, 'speech.webm');
      const t = await fetch('/api/transcribe', { method: 'POST', body: form }).then(r => r.json());
      const text = (t.text || '').trim();
      isProcessingRef.current = false;
      if (!text) return beginListening();
      if (!activeRef.current) return;

      // First-turn name capture: bypass /api/chat entirely, grab their
      // name, store it, and open the real conversation using it.
      if (awaitingNameRef.current) {
        const name = extractName(text);
        nameAttemptsRef.current += 1;
        if (!name) {
          if (nameAttemptsRef.current < 2) {
            await speakRaw("Sorry, I didn't catch that. What may I call you?");
            if (!activeRef.current) return;
            beginListening();
            return;
          }
          // Second miss — stop pushing, continue without a name.
          awaitingNameRef.current = false;
          await speakRaw("That's alright. What's on your mind?");
          if (!activeRef.current) return;
          beginListening();
          return;
        }
        nameRef.current = name;
        setUserName(name);
        try { localStorage.setItem('antarmann_name', name); } catch {}
        track('name_captured', { name });
        awaitingNameRef.current = false;
        await speakRaw(`It's good to meet you, ${name}. What's on your mind today?`);
        if (!activeRef.current) return;
        beginListening();
        return;
      }

      recordUtterancePace(text);
      const pace = getPaceProfile();

      const c = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: historyRef.current, pace, userName: nameRef.current }),
      }).then(r => r.json());
      if (!c.reply) throw new Error(c.error || 'No reply');

      // Start TTS fetch immediately in parallel — don't wait for history
      // updates or other logic. This hides most of the TTS latency.
      const ttsPromise = fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: c.reply }),
      }).then(r => (r.ok ? r.blob() : null)).catch(() => null);

      historyRef.current = [
        ...historyRef.current,
        { role: 'user', content: text },
        { role: 'assistant', content: c.reply },
      ];
      if (c.technique !== undefined) {
        techniqueRef.current = c.technique;
        setTechnique(c.technique);
        if (c.technique) track('technique_offered', { technique: c.technique });
      }
      if (!activeRef.current) return;

      if (c.phase === 'practice' && c.technique) {
        // This reply is the first instruction of a practice the person
        // just agreed to. ttsPromise is already in flight — don't play
        // it yet. A brief settling countdown goes first so beginning
        // feels like crossing a threshold rather than the app just
        // continuing to talk.
        const instructionPromise = ttsPromise;

        const family = TECHNIQUES[c.technique]?.family;
        const prepMs = PREP_SHORT_KEYS.has(c.technique) ? PREP_MS_SHORT : PREP_MS_DEFAULT;

        setPhase('preparing');
        startAmbient(family);
        const prepResult = await playPrepCountdown(prepMs);
        if (!activeRef.current) { stopAmbient(0); return; }

        if (prepResult.interrupted) {
          // They spoke during the settling pause — that's them wanting
          // to say something now, so hear it before beginning anything.
          stopAmbient(1200);
          beginListening();
          return;
        }
        // Ambient keeps playing — it's the continuous background of the
        // practice from here on, ducked quieter once enterPractice runs.

        const audioBlob = await instructionPromise;
        if (!activeRef.current) return;
        if (!audioBlob) {
          flash('Voice was unavailable just then — continuing without it.');
          enterPractice(c.technique, c.durationSec || 0);
          return;
        }

        setPhase('speaking');
        const result = await playInterruptible(audioBlob);
        if (!activeRef.current) return;
        if (result.interrupted) beginListening();
        else enterPractice(c.technique, c.durationSec || 0);
        return;
      }

      const audioBlob = await ttsPromise;
      if (!audioBlob) throw new Error('Voice unavailable');
      if (!activeRef.current) return;

      setPhase('speaking');
      const result = await playInterruptible(audioBlob);
      if (!activeRef.current) return;
      beginListening();
    } catch (err) {
      console.error(err);
      isProcessingRef.current = false;
      flash("Something interrupted us for a moment. I'm listening again.");
      beginListening();
    }
  }

  // ── Practice mode (Phase 2: sustained, mostly-silent guidance) ──
  function enterPractice(key, durationSec = 0) {
    if (!activeRef.current) return;
    track('practice_started', { technique: key, durationSec });
    modeRef.current = 'practice';
    techniqueRef.current = key;
    practiceStartRef.current = performance.now();
    lastSpokenAtRef.current = performance.now();
    cycleCountRef.current = 0;
    practiceDurationMsRef.current = durationSec > 0 ? durationSec * 1000 : 0;
    practiceUtterancesRef.current = [];

    // Duck the ambient to a lower level now that the voice/practice
    // begins — it keeps playing but moves to the background.
    duckAmbient(AMBIENT_PRACTICE_GAIN);

    // Elapsed-time ticker drives the orb's MM:SS display. Updates
    // every second regardless of whether a duration was set.
    setPracticeTimeText('0:00');
    setPracticeProgress(0);
    timeTickerRef.current = setInterval(() => {
      const elapsedMs = performance.now() - practiceStartRef.current;
      const elapsedSec = Math.floor(elapsedMs / 1000);
      const mins = Math.floor(elapsedSec / 60);
      const secs = elapsedSec % 60;
      setPracticeTimeText(`${mins}:${secs.toString().padStart(2, '0')}`);
      if (practiceDurationMsRef.current > 0) {
        setPracticeProgress(Math.min(1, elapsedMs / practiceDurationMsRef.current));
      }
    }, 1000);

    // Only the closing bell is scheduled — one soft chime at the end
    // of a timed practice, then a graceful exit. No fixed-interval
    // bells; drift-based return chimes come from the practice check
    // itself (action: "bell") on Claude's judgment.
    if (durationSec > 0) {
      practiceEndTimerRef.current = setTimeout(() => {
        if (!activeRef.current || modeRef.current !== 'practice') return;
        const elapsedSec = Math.round((performance.now() - practiceStartRef.current) / 1000);
        track('practice_completed', { technique: techniqueRef.current, elapsedSec });
        ringBell('closing');
        setTimeout(() => {
          if (activeRef.current && modeRef.current === 'practice') exitPractice();
        }, 4500);
      }, durationSec * 1000);
    }

    setPhase('practicing');
    startPracticeRecording();
    scheduleNextTick();
  }

  function pausePractice() {
    if (!activeRef.current || modeRef.current !== 'practice' || isPausedRef.current) return;
    isPausedRef.current = true;
    setIsPaused(true);

    // Freeze timers
    clearTimeout(practiceTimerRef.current);
    clearTimeout(practiceEndTimerRef.current);
    clearInterval(timeTickerRef.current);

    // Record how much time had elapsed so we can resume correctly
    pausedElapsedRef.current = performance.now() - practiceStartRef.current;
    pausedAtRef.current = performance.now();

    // Stop listening
    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') { rec.onstop = null; rec.stop(); }
    recordingActiveRef.current = false;

    // Fade ambient to a very quiet level — present but clearly paused
    duckAmbient(0.12);
    setPhase('preparing'); // reuses the "settling" visual state
  }

  function resumePractice() {
    if (!activeRef.current || modeRef.current !== 'practice' || !isPausedRef.current) return;
    isPausedRef.current = false;
    setIsPaused(false);

    // Shift practiceStartRef forward by however long we were paused,
    // so elapsed time and the end timer stay accurate.
    const pausedDurationMs = performance.now() - pausedAtRef.current;
    practiceStartRef.current += pausedDurationMs;
    lastSpokenAtRef.current += pausedDurationMs;

    // Restore ambient level
    duckAmbient(AMBIENT_PRACTICE_GAIN);

    // Restart the elapsed-time ticker
    timeTickerRef.current = setInterval(() => {
      const elapsedMs = performance.now() - practiceStartRef.current;
      const elapsedSec = Math.floor(elapsedMs / 1000);
      const mins = Math.floor(elapsedSec / 60);
      const secs = elapsedSec % 60;
      setPracticeTimeText(`${mins}:${secs.toString().padStart(2, '0')}`);
      if (practiceDurationMsRef.current > 0) {
        setPracticeProgress(Math.min(1, elapsedMs / practiceDurationMsRef.current));
      }
    }, 1000);

    // Reschedule the end bell if there was a duration
    const remainingMs = practiceDurationMsRef.current > 0
      ? practiceDurationMsRef.current - (performance.now() - practiceStartRef.current)
      : 0;
    if (remainingMs > 0) {
      practiceEndTimerRef.current = setTimeout(() => {
        if (!activeRef.current || modeRef.current !== 'practice') return;
        const elapsedSec = Math.round((performance.now() - practiceStartRef.current) / 1000);
        track('practice_completed', { technique: techniqueRef.current, elapsedSec });
        ringBell('closing');
        setTimeout(() => {
          if (activeRef.current && modeRef.current === 'practice') exitPractice();
        }, 4500);
      }, remainingMs);
    }

    setPhase('practicing');
    startPracticeRecording();
    scheduleNextTick();
  }

  async function exitPractice() {
    clearTimeout(practiceTimerRef.current);
    clearTimeout(practiceEndTimerRef.current);
    clearInterval(timeTickerRef.current);
    practiceEndTimerRef.current = null;
    timeTickerRef.current = null;
    setPracticeTimeText('0:00');
    setPracticeProgress(0);
    practiceDurationMsRef.current = 0;
    isPausedRef.current = false;
    setIsPaused(false);
    const rec = recorderRef.current;
    if (rec && rec.state === 'recording') { rec.onstop = null; rec.stop(); }
    recordingActiveRef.current = false;
    hasSpokenRef.current = false;
    silenceStartRef.current = null;
    modeRef.current = 'grounding';
    techniqueRef.current = null;
    setTechnique(null);
    if (!activeRef.current) return;

    // Soft closing — let the music still play gently underneath,
    // then fade it out after the closing words finish.
    const name = nameRef.current;
    const closing = name
      ? `Well done, ${name}. Take a breath, let your awareness expand gently, and when you're ready, slowly open your eyes.`
      : `Well done. Take a breath, let your awareness expand gently, and when you're ready, slowly open your eyes.`;
    try {
      const res = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: closing }),
      });
      if (res.ok) {
        const blob = await res.blob();
        await playInterruptible(blob);
      }
    } catch {}
    stopAmbient(2500);
    if (!activeRef.current) return;
    beginListening();
  }

  function startPracticeRecording() {
    if (!activeRef.current || !streamRef.current || modeRef.current !== 'practice') return;
    chunksRef.current = [];
    hasSpokenRef.current = false;
    silenceStartRef.current = null;
    listenStartAtRef.current = performance.now();
    recordingActiveRef.current = true;
    const rec = new MediaRecorder(streamRef.current);
    rec.ondataavailable = e => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = practiceHandleStop;
    recorderRef.current = rec;
    rec.start();
  }

  async function practiceHandleStop() {
    recordingActiveRef.current = false;
    if (!activeRef.current || modeRef.current !== 'practice' || isProcessingRef.current) return;
    isProcessingRef.current = true;
    setPhase('thinking');
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });

    if (blob.size < 2000) {
      isProcessingRef.current = false;
      setPhase('practicing');
      startPracticeRecording();
      return;
    }
    try {
      const form = new FormData();
      form.append('audio', blob, 'speech.webm');
      const t = await fetch('/api/transcribe', { method: 'POST', body: form }).then(r => r.json());
      const text = (t.text || '').trim();
      isProcessingRef.current = false;
      if (!text || !activeRef.current || modeRef.current !== 'practice') {
        setPhase('practicing');
        if (modeRef.current === 'practice') startPracticeRecording();
        return;
      }
      recordUtterancePace(text);
      await runPracticeCheck(text, true);
    } catch (err) {
      console.error(err);
      isProcessingRef.current = false;
      setPhase('practicing');
      if (modeRef.current === 'practice') startPracticeRecording();
    }
  }

  function scheduleNextTick() {
    clearTimeout(practiceTimerRef.current);
    const pace = getPaceProfile();
    // Check-in intervals: short enough that Claude has a chance to intervene,
    // but Claude still chooses silence most of the time — these are just
    // the opportunities, not the interventions themselves.
    const baseMin = pace.label === 'slow' ? 20000 : pace.label === 'quick' ? 12000 : 15000;
    const baseMax = baseMin + 10000;
    const delay = baseMin + Math.random() * (baseMax - baseMin);

    practiceTimerRef.current = setTimeout(() => {
      if (!activeRef.current || modeRef.current !== 'practice') return;
      if (phaseRef.current === 'listening' || phaseRef.current === 'thinking') {
        scheduleNextTick();
        return;
      }
      runPracticeCheck(null, false);
    }, delay);
  }

  async function runPracticeCheck(userUtterance, foreground) {
    if (!activeRef.current || modeRef.current !== 'practice' || isCheckingRef.current) return;
    isCheckingRef.current = true;

    const now = performance.now();
    const elapsedSec = Math.round((now - practiceStartRef.current) / 1000);
    const sinceLastSpeechSec = Math.round((now - lastSpokenAtRef.current) / 1000);
    const pace = getPaceProfile();

    try {
      const res = await fetch('/api/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          technique: techniqueRef.current,
          elapsedSec,
          sinceLastSpeechSec,
          cycleCount: cycleCountRef.current,
          userUtterance: userUtterance || null,
          pace,
          history: historyRef.current.slice(-6),
          userName: nameRef.current,
          recentUtterances: practiceUtterancesRef.current,
        }),
      }).then(r => r.json());

      const action = res.action || 'silence';

      if (action === 'bell') {
        // A soft return chime — lighter touch than words. Claude judges
        // that the mind has drifted but no language is called for.
        ringBell('awareness');
        lastSpokenAtRef.current = performance.now();
        cycleCountRef.current = 0;
        if (foreground) setPhase('practicing');
      } else if (action === 'speak' || action === 'end_practice') {
        let interrupted = false;
        if (res.text) {
          setPhase('speaking');
          const audioRes = await fetch('/api/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: res.text }),
          });
          if (audioRes.ok) {
            const blob = await audioRes.blob();
            const result = await playInterruptible(blob);
            interrupted = result.interrupted;
          }
          // Log what was spoken so the next check-in sees it and
          // doesn't say the same thing (or near-the-same thing).
          if (action === 'speak') {
            const atSec = Math.round((performance.now() - practiceStartRef.current) / 1000);
            practiceUtterancesRef.current.push({ atSec, text: res.text });
            if (practiceUtterancesRef.current.length > 4) practiceUtterancesRef.current.shift();
          }
        }
        lastSpokenAtRef.current = performance.now();
        cycleCountRef.current = 0;

        if (!activeRef.current || modeRef.current !== 'practice') {
          isCheckingRef.current = false;
          return;
        }

        if (action === 'end_practice') {
          isCheckingRef.current = false;
          exitPractice();
          return;
        }

        if (interrupted) {
          // They spoke over the check-in — that's them wanting to say
          // something now, so listen immediately rather than waiting
          // for the next scheduled tick.
          isCheckingRef.current = false;
          setPhase('practicing');
          startPracticeRecording();
          return;
        }
        setPhase('practicing');
      } else {
        cycleCountRef.current += 1;
        if (foreground) setPhase('practicing');
      }
    } catch (e) {
      console.error(e);
      if (foreground) setPhase('practicing');
    } finally {
      isCheckingRef.current = false;
      if (activeRef.current && modeRef.current === 'practice') {
        if (foreground) startPracticeRecording();
        scheduleNextTick();
      }
    }
  }

  // ── The orb is the only control ─────────────────────────────
  function handleOrbClick() {
    const p = phaseRef.current;

    if (p === 'idle') {
      // ── iOS / mobile audio unlock ───────────────────────────────
      // On iOS WebKit, Audio.play() is only allowed synchronously
      // inside a user gesture. Once any await (getUserMedia, fetch)
      // happens the gesture is gone. The fix: create a real Audio
      // element NOW (synchronously), play a silent inline MP3 through
      // it, then reuse that SAME element for all TTS playback by
      // swapping its src. iOS allows src-swapping on an already-
      // unlocked element without needing a new gesture.
      // Shortest valid MP3: 1 frame of silence, base64-encoded.
      const SILENT_MP3 = 'data:audio/mpeg;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsgU291bmQgRWZmZWN0cwBUWFhYAAAADwAAAFNvdW5kIEVmZmVjdABUQUxCAAAACQAAAFNvdW5kAP/+kgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
      if (!iosUnlockedRef.current) {
        const a = new Audio(SILENT_MP3);
        a.setAttribute('playsinline', '');
        a.setAttribute('webkit-playsinline', '');
        a.style.display = 'none';
        document.body.appendChild(a);
        a.play().catch(() => {});
        iosUnlockedRef.current = a;
      }
      // Also unlock a SECOND element for ambient — iOS only allows one
      // src-swap per element at a time; if TTS and ambient shared one
      // element, swapping src for TTS would stop the ambient track.
      if (!iosAmbientUnlockedRef.current) {
        const b = new Audio(SILENT_MP3);
        b.setAttribute('playsinline', '');
        b.setAttribute('webkit-playsinline', '');
        b.style.display = 'none';
        document.body.appendChild(b);
        b.play().catch(() => {});
        iosAmbientUnlockedRef.current = b;
      }
      // Unlock AudioContext too
      if (!audioCtxRef.current) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          audioCtxRef.current = ctx;
          const buf = ctx.createBuffer(1, 1, 22050);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          src.start(0);
          ctx.resume().catch(() => {});
        } catch (e) {}
      } else {
        audioCtxRef.current.resume().catch(() => {});
      }
      return startSession();
    }

    // For all other states, resume AudioContext on every tap too.
    if (audioCtxRef.current) audioCtxRef.current.resume().catch(() => {});
    if (p === 'listening' && hasSpokenRef.current) return finishSpeaking();
    // Check paused first — pausePractice sets phase to 'preparing',
    // so we must handle resume before the 'preparing' branch runs.
    if (isPausedRef.current) return resumePractice();
    if (p === 'practicing') return pausePractice();
    if (p === 'preparing') return skipPrep();
    if (p === 'speaking') return bargeIn();
  }

  useEffect(() => {
    // Pick ambient track + idle prompt client-side only — avoids SSR/hydration mismatch
    sessionAmbientRef.current = AMBIENT_POOL[Math.floor(Math.random() * AMBIENT_POOL.length)];
    setIdlePrompt(IDLE_PROMPTS[Math.floor(Math.random() * IDLE_PROMPTS.length)]);

    try {
      const saved = localStorage.getItem('antarmann_name');
      if (saved && saved.length >= 2) {
        nameRef.current = saved;
        setUserName(saved);
      }
    } catch {}
    const onKey = e => {
      if (e.code === 'Space' && phaseRef.current === 'idle') { e.preventDefault(); startSession(); }
      if (e.code === 'Escape' && activeRef.current) endSession();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); endSession(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lightweight analytics — fires custom events to Vercel Analytics.
  // Safe to call even before the script loads (noop if window.va is absent).
  function track(event, props) {
    try {
      if (typeof window !== 'undefined' && window.va) window.va('event', { name: event, ...props });
    } catch {}
  }

  const tech = technique ? TECHNIQUES[technique] : null;
  const family = tech ? tech.family : '';

  const caption = isPaused
    ? 'paused — tap to resume'
    : status === 'preparing'
    ? `settling in • ${prepSecondsLeft}s — tap to begin now`
    : {
        idle: 'tap to begin',
        listening: "I'm listening — pause when you're ready",
        thinking: '',
        speaking: 'just talk to interrupt',
        practicing: 'tap to pause',
      }[status];

  return (
    <main ref={rootRef} className="root" data-status={status} data-family={family} data-paused={isPaused || undefined}>
      <style>{CSS}</style>
      {/* Vercel Analytics — tracks page views and custom events via window.va */}
      <script defer src="/_vercel/insights/script.js" />

      <div className="bg" aria-hidden="true">
        <div className="blob b1" />
        <div className="blob b2" />
        <div className="blob b3" />
        <div className="grain" />
      </div>

      <header className="top">
        <div className="wordmark">antarmann</div>
        <div className="tagline">the inner mind</div>
      </header>

      <section className="center">
        <div className="stage">
          <svg className="mandala" viewBox="0 0 400 400" aria-hidden="true">
            <circle cx="200" cy="200" r="190" fill="none" stroke="currentColor" strokeWidth="0.6" />
            <circle cx="200" cy="200" r="160" fill="none" stroke="currentColor" strokeWidth="0.6" strokeDasharray="2 7" />
            {Array.from({ length: 24 }).map((_, i) => {
              const a = (i / 24) * Math.PI * 2;
              return <circle key={i} cx={200 + 175 * Math.cos(a)} cy={200 + 175 * Math.sin(a)} r="1.6" fill="currentColor" />;
            })}
          </svg>

          <div className="halo" />
          <div className="ring" style={{ animationDelay: '0s' }} />
          <div className="ring" style={{ animationDelay: '1.2s' }} />
          <div className="ring" style={{ animationDelay: '2.4s' }} />
          <div className="prepRing" aria-hidden="true" />
          <div className="progRing" aria-hidden="true" style={{ '--prog': practiceProgress }} />

          <div className="wrap">
            <button className="orb" onClick={handleOrbClick} aria-label={status === 'idle' ? 'Begin session' : isPaused ? 'Resume practice' : caption || 'Tap to pause'}>
              <span className="sig band" />
              <span className="sig tree" />
              <span className="sig glow" />
              <span className="sig flame" />
              <span className="sig cloud c1" />
              <span className="sig cloud c2" />
              <span className="sig cloud c3" />
              <span className="shimmer" />
              {isPaused ? (
                <svg className="mic" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5,3 19,12 5,21" fill="white" stroke="none" />
                </svg>
              ) : (
                <svg className="mic" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2.5" width="6" height="11" rx="3" />
                  <path d="M5.5 10.5a6.5 6.5 0 0 0 13 0" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              )}
              <span className="timeText" aria-hidden={status !== 'practicing'}>{practiceTimeText}</span>
            </button>
          </div>
        </div>

        <div className="below">
          {tech && (
            <div className="technique" key={technique}>
              <div className="tname">{tech.name}</div>
              <div className="tsub">{tech.sub}</div>
            </div>
          )}
          <div className="caption" key={status}>{caption}</div>
          {status === 'idle' && idlePrompt && (
            <div className="idlePrompt" key={idlePrompt}>{idlePrompt}</div>
          )}
          {notice && <div className="notice">{notice}</div>}
          {status !== 'idle' && (
            <button className="end" onClick={endSession}>end session</button>
          )}
        </div>
      </section>

      <footer className="bottom">
        <span>In distress, please call Tele-MANAS <strong>14416</strong> &middot; available 24/7</span>
        <span className="keys">{status === 'idle' ? 'space to begin' : 'esc to end'}</span>
      </footer>
    </main>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400&family=Inter:wght@300;400&display=swap');

@property --c1 { syntax: '<color>'; inherits: true; initial-value: #7d8db5; }
@property --c2 { syntax: '<color>'; inherits: true; initial-value: #3f4a6e; }

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }

.root {
  --c1: #7d8db5; --c2: #3f4a6e; --level: 0; --prep: 0;
  min-height: 100vh; position: relative; overflow: hidden;
  display: flex; flex-direction: column; align-items: center; justify-content: space-between;
  color: #4a4550; font-family: 'Inter', system-ui, sans-serif;
  transition: --c1 1.8s ease, --c2 1.8s ease;
}

.root[data-status="idle"]      { --c1: #7d8db5; --c2: #3f4a6e; }
.root[data-status="listening"] { --c1: #f1b46e; --c2: #c8703f; }
.root[data-status="thinking"]  { --c1: #b9a8d8; --c2: #6f5e9e; }
.root[data-status="speaking"]  { --c1: #93c4b6; --c2: #4b847c; }
.root[data-status="preparing"] { --c1: #93c4b6; --c2: #4b847c; }
.root[data-status="practicing"]{ --c1: #93c4b6; --c2: #4b847c; }

.root[data-family="breath"],
.root[data-family="breath478"] { --c1: #9fcbdc; --c2: #4a87a8; }
.root[data-family="body"]      { --c1: #e8c7a0; --c2: #b07c4f; }
.root[data-family="heart"]     { --c1: #f0b1a6; --c2: #c2665f; }
.root[data-family="focus"]     { --c1: #f4cf7c; --c2: #b97a26; }
.root[data-family="ground"]    { --c1: #cba07a; --c2: #7f5236; }
.root[data-family="space"]     { --c1: #d3dcea; --c2: #8193b4; }
.root[data-family="rest"]      { --c1: #8187bd; --c2: #353a69; }

.bg { position: fixed; inset: 0; background: #f6f0e7; z-index: 0; overflow: hidden; }
.blob { position: absolute; border-radius: 50%; filter: blur(90px); }
.b1 { width: 62vmax; height: 62vmax; top: -22vmax; left: -18vmax; background: var(--c1); opacity: .38; animation: drift1 38s ease-in-out infinite alternate; }
.b2 { width: 58vmax; height: 58vmax; bottom: -26vmax; right: -16vmax; background: var(--c2); opacity: .22; animation: drift2 46s ease-in-out infinite alternate; }
.b3 { width: 42vmax; height: 42vmax; top: 30%; left: 42%; background: #f2d6b3; opacity: .35; animation: drift3 54s ease-in-out infinite alternate; }
.grain { position: absolute; inset: 0; opacity: .05; background-image: radial-gradient(#000 0.5px, transparent 0.6px); background-size: 3px 3px; }
@keyframes drift1 { to { transform: translate(14vmax, 10vmax) scale(1.12); } }
@keyframes drift2 { to { transform: translate(-12vmax, -8vmax) scale(1.08); } }
@keyframes drift3 { to { transform: translate(-18vmax, 6vmax) scale(.9); } }

.top, .center, .bottom { position: relative; z-index: 1; }
.top { padding-top: 5vh; text-align: center; }
.wordmark { font-family: 'Cormorant Garamond', serif; font-weight: 300; font-size: 30px; letter-spacing: .38em; color: #3d3844; padding-left: .38em; }
.tagline { margin-top: 6px; font-size: 10.5px; letter-spacing: .32em; text-transform: uppercase; color: #9a929f; }
.center { display: flex; flex-direction: column; align-items: center; }
.bottom { width: 100%; padding: 0 32px 22px; display: flex; justify-content: space-between; font-size: 11.5px; color: #9d95a0; letter-spacing: .02em; }
.bottom strong { color: #6d6573; font-weight: 400; }
.keys { letter-spacing: .14em; text-transform: uppercase; font-size: 10px; }

.stage { position: relative; width: 420px; height: 420px; display: grid; place-items: center; }
.stage > * { grid-area: 1 / 1; }
.mandala { width: 420px; height: 420px; color: var(--c2); opacity: .16; animation: spin 160s linear infinite; }
.halo {
  width: 280px; height: 280px; border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--c1) 70%, transparent) 0%, transparent 68%);
  filter: blur(14px);
  transform: scale(calc(1 + var(--level) * .55));
  opacity: calc(.55 + var(--level) * .45);
  transition: transform .09s linear;
}
.ring { width: 196px; height: 196px; border-radius: 50%; border: 1.5px solid var(--c2); opacity: 0; pointer-events: none; }
.root[data-status="speaking"] .ring { animation: ripple 3.6s ease-out infinite; }
.root[data-family="heart"] .ring   { animation: ripple 6s ease-out infinite; border-color: var(--c1); }

.prepRing {
  display: none; width: 214px; height: 214px; border-radius: 50%; pointer-events: none;
  background: conic-gradient(var(--c2) calc(var(--prep) * 360deg), transparent 0deg);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px));
          mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px));
  transition: background .2s linear;
}
.root[data-status="preparing"] .prepRing { display: block; }
.root[data-status="preparing"] .orb { animation: breathe 6s ease-in-out infinite; }

/* Practice progress ring — thin arc around the orb showing how far
   through the proposed duration we are. Only visible if a duration
   was actually proposed (otherwise --prog stays 0 and the ring is empty). */
.progRing {
  display: none; width: 220px; height: 220px; border-radius: 50%; pointer-events: none;
  background: conic-gradient(from -90deg, var(--c2) calc(var(--prog, 0) * 360deg), rgba(80,70,90,.08) 0deg);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px));
          mask: radial-gradient(farthest-side, transparent calc(100% - 2px), #000 calc(100% - 2px));
  transition: background 1s linear;
  opacity: .55;
}
.root[data-status="practicing"] .progRing { display: block; }

/* Elapsed-time display inside the orb — darker, heavier, planted.
   The glow halo gives the dark glyphs a lighter stage to sit on so
   they stay legible against the orb's deep gradient. */
.timeText {
  position: relative; z-index: 4;
  font-family: 'Cormorant Garamond', serif;
  font-weight: 500;
  font-size: 62px;
  letter-spacing: -.01em;
  color: #1b1620;
  text-shadow:
    0 0 26px rgba(255, 244, 226, 0.55),
    0 0 56px rgba(255, 244, 226, 0.3),
    0 1px 2px rgba(0, 0, 0, 0.12);
  opacity: 0;
  transition: opacity .9s ease;
  font-variant-numeric: tabular-nums;
}
.root[data-status="practicing"] .timeText { opacity: 1; }

.wrap { transform: scale(calc(1 + var(--level) * .14)); transition: transform .09s linear; }

.orb {
  width: 196px; height: 196px; border-radius: 50%; border: none; padding: 0; outline: none;
  position: relative; overflow: hidden; cursor: pointer;
  display: grid; place-items: center;
  background: radial-gradient(circle at 34% 28%, rgba(255,255,255,.78) 0%, var(--c1) 34%, var(--c2) 100%);
  box-shadow:
    0 26px 70px -14px color-mix(in srgb, var(--c2) 65%, transparent),
    inset 0 -14px 34px rgba(0,0,0,.14),
    inset 0 12px 30px rgba(255,255,255,.35);
  animation: breathe 10s ease-in-out infinite;
}
.orb:focus-visible { box-shadow: 0 0 0 6px color-mix(in srgb, var(--c1) 45%, transparent); }
.orb > * { grid-area: 1 / 1; }
.mic { position: relative; z-index: 4; opacity: .92; transition: opacity .7s ease; }
.root:not([data-status="idle"]) .mic { opacity: 0; }

.root[data-status="idle"] .orb      { animation: breathe 10s ease-in-out infinite; }
.root[data-status="listening"] .orb { animation: breathe 7s ease-in-out infinite; }
.root[data-status="speaking"] .orb  { animation: breathe 5s ease-in-out infinite; }
.root[data-status="practicing"] .orb{ animation: breathe 9s ease-in-out infinite; }
.root[data-paused] .orb { animation: breathe 18s ease-in-out infinite; opacity: 0.72; }
.root[data-paused] .ring { animation-play-state: paused; opacity: 0.3; }
.root[data-paused] .caption { color: #b0a8ba; }

.shimmer {
  position: absolute; inset: -25%; z-index: 3; opacity: 0;
  background: conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,.5) 50deg, transparent 120deg);
  transition: opacity .6s ease;
}
.root[data-status="thinking"] .shimmer { opacity: 1; animation: spin 3.2s linear infinite; }

.sig { display: none; position: absolute; z-index: 1; pointer-events: none; }

.root[data-family="breath"] .orb    { animation: breathe 10s ease-in-out infinite; }
.root[data-family="breath478"] .orb { animation: breathe478 19s ease-in-out infinite; }

.root[data-family="body"] .band {
  display: block; left: 0; right: 0; height: 34%;
  background: linear-gradient(to bottom, transparent, rgba(255,255,255,.55), transparent);
  animation: scan 9s ease-in-out infinite;
}

.root[data-family="heart"] .orb  { animation: breathe 8s ease-in-out infinite; }
.root[data-family="heart"] .glow {
  display: block; width: 70%; height: 70%; border-radius: 50%;
  background: radial-gradient(circle, rgba(255,240,232,.9) 0%, transparent 70%);
  animation: warm 4s ease-in-out infinite;
}

.root[data-family="focus"] .orb {
  background: radial-gradient(circle at 50% 50%, var(--c1) 0%, var(--c2) 55%, #3a2a24 100%);
  animation: breathe 12s ease-in-out infinite;
}
.root[data-family="focus"] .flame {
  display: block; width: 16px; height: 22px; border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
  background: radial-gradient(circle at 50% 65%, #fffdf2 0%, #ffe6a3 45%, rgba(255,190,90,0) 75%);
  box-shadow: 0 0 22px 8px rgba(255,214,140,.55);
  animation: flicker 2.6s ease-in-out infinite;
}

.root[data-family="ground"] .orb  { animation: settle 8s ease-in-out infinite; }
.root[data-family="ground"] .tree {
  display: block; inset: 0; border-radius: 50%;
  background: repeating-radial-gradient(circle at 50% 50%, transparent 0 13px, rgba(255,255,255,.16) 13px 14px);
}

.root[data-family="space"] .orb {
  background: radial-gradient(circle at 34% 28%, rgba(255,255,255,.9) 0%, color-mix(in srgb, var(--c1) 70%, transparent) 45%, color-mix(in srgb, var(--c2) 75%, transparent) 100%);
  animation: breathe 12s ease-in-out infinite;
}
.root[data-family="space"] .cloud {
  display: block; width: 46px; height: 46px; border-radius: 50%;
  background: rgba(255,255,255,.75); filter: blur(9px); left: -60px;
  animation: pass 14s linear infinite;
}
.root[data-family="space"] .c1 { top: 22%; }
.root[data-family="space"] .c2 { top: 50%; width: 34px; height: 34px; animation-duration: 19s; animation-delay: 5s; }
.root[data-family="space"] .c3 { top: 68%; width: 28px; height: 28px; animation-duration: 23s; animation-delay: 10s; }

.root[data-family="rest"] .orb { animation: breathe 16s ease-in-out infinite; }

.root[data-status="thinking"] .orb { animation: none; transform: scale(.93); transition: transform 1.2s ease; }

.below { min-height: 150px; display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 6px; }
.technique { text-align: center; animation: fadeUp .9s ease both; }
.tname { font-family: 'Cormorant Garamond', serif; font-size: 26px; font-weight: 400; color: #3d3844; letter-spacing: .02em; }
.tsub  { margin-top: 2px; font-size: 10.5px; letter-spacing: .26em; text-transform: uppercase; color: #8f8794; }
.tleft { margin-top: 10px; font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 15px; color: #8a8290; }
.caption { font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 19px; color: #6b6370; min-height: 26px; animation: fadeUp .7s ease both; }
.idlePrompt { font-family: 'Cormorant Garamond', serif; font-style: italic; font-size: 16px; color: #9990a0; letter-spacing: .01em; animation: fadeUp .9s ease both; animation-delay: .3s; opacity: 0; animation-fill-mode: forwards; }
.notice { font-size: 12.5px; color: #8a5a4a; background: rgba(255,255,255,.55); padding: 8px 14px; border-radius: 14px; backdrop-filter: blur(6px); }
.end {
  margin-top: 6px; background: rgba(255,255,255,.35); border: 1px solid rgba(80,70,90,.18);
  border-radius: 999px; padding: 7px 20px; font-family: 'Inter', sans-serif; font-size: 11px;
  letter-spacing: .18em; text-transform: uppercase; color: #8a8290; cursor: pointer;
  backdrop-filter: blur(6px); transition: all .3s ease;
}
.end:hover { color: #4a4550; border-color: rgba(80,70,90,.35); }

@keyframes breathe    { 0% { transform: scale(.95); } 40% { transform: scale(1.05); } 100% { transform: scale(.95); } }
@keyframes breathe478 { 0% { transform: scale(.9); } 21% { transform: scale(1.1); } 58% { transform: scale(1.1); } 100% { transform: scale(.9); } }
@keyframes settle     { 0%,100% { transform: scale(1) translateY(0); } 50% { transform: scale(.97) translateY(4px); } }
@keyframes ripple     { 0% { transform: scale(1); opacity: .5; } 100% { transform: scale(2); opacity: 0; } }
@keyframes spin       { to { transform: rotate(360deg); } }
@keyframes scan       { 0% { top: -34%; } 100% { top: 100%; } }
@keyframes warm       { 0%,100% { transform: scale(.85); opacity: .55; } 50% { transform: scale(1.15); opacity: 1; } }
@keyframes flicker    { 0%,100% { transform: scale(1); opacity: .95; } 30% { transform: scale(1.06, .96); opacity: 1; } 60% { transform: scale(.96, 1.04); opacity: .88; } }
@keyframes pass       { 0% { left: -60px; } 100% { left: 110%; } }
@keyframes fadeUp     { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  .blob, .mandala, .ring, .sig, .shimmer { animation: none !important; }
}
`;
