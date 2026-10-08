import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio');

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'en',
    });

    return NextResponse.json({ text: transcription.text });
  } catch (err) {
    console.error('Transcribe error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}