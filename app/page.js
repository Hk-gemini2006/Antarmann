'use client';
import { useState, useRef } from 'react';

export default function Home() {
  const [status, setStatus] = useState('idle');
  const [history, setHistory] = useState([]);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = e => chunksRef.current.push(e.data);
    recorder.onstop = handleRecordingStop;
    mediaRecorderRef.current = recorder;
    recorder.start();
    setStatus('recording');
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  async function handleRecordingStop() {
    setStatus('thinking');
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });

    // 1. Transcribe
    const form = new FormData();
    form.append('audio', blob, 'recording.webm');
    const { text } = await fetch('/api/transcribe', { method: 'POST', body: form })
      .then(r => r.json());

    // Guard: empty transcription
    if (!text || text.trim() === '') {
      setStatus('idle');
      return;
    }

    // 2. Claude response
    const { reply } = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history }),
    }).then(r => r.json());

    setHistory(h => [...h, { role: 'user', content: text }, { role: 'assistant', content: reply }]);

    // 3. Speak
    setStatus('speaking');
    const audioBlob = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: reply }),
    }).then(r => r.blob());

    const url = URL.createObjectURL(audioBlob);
    const audio = new Audio(url);
    audio.onended = () => setStatus('idle');
    audio.play();
  }

  const label = {
    idle: 'Hold to speak',
    recording: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
  }[status];

  return (
    <main style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#faf8f4', fontFamily: 'sans-serif', gap: '2rem'
    }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 400, color: '#444', letterSpacing: '0.05em' }}>
        antarmann
      </h1>

      <button
        onMouseDown={startRecording}
        onMouseUp={stopRecording}
        onTouchStart={startRecording}
        onTouchEnd={stopRecording}
        disabled={status === 'thinking' || status === 'speaking'}
        style={{
          width: 120, height: 120, borderRadius: '50%',
          background: status === 'recording' ? '#c0392b' : '#2c3e50',
          border: 'none', cursor: 'pointer', color: 'white',
          fontSize: '0.85rem', letterSpacing: '0.03em',
          transition: 'background 0.2s',
        }}
      >
        {label}
      </button>

      <p style={{ color: '#888', fontSize: '0.8rem', maxWidth: 280, textAlign: 'center' }}>
        This is a prototype. In distress, please call Tele-MANAS: 14416
      </p>
    </main>
  );
}