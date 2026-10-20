import OpenAI from 'openai';

export async function POST(request) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const { text } = await request.json();
    if (!text || !text.trim()) {
      return new Response(JSON.stringify({ error: 'Empty text' }), { status: 400 });
    }
    const response = await client.audio.speech.create({
      model: 'tts-1',
      voice: 'onyx',
      input: text,
      instructions: 'Speak slowly and warmly, like a calm meditation guide. Soft tone, unhurried pace, gentle presence. Never rushed, never clinical.',
      response_format: 'mp3',
      speed: 0.9,
    });
    const audioBuffer = await response.arrayBuffer();
    return new Response(audioBuffer, {
      headers: { 'Content-Type': 'audio/mpeg' },
    });
  } catch (err) {
    console.error('Speak error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
