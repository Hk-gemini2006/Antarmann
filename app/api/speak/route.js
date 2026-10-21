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
      response_format: 'opus', // smaller file = faster download than mp3
      speed: 1.0,              // normal speed — 0.9 made audio longer to download
    });
    const audioBuffer = await response.arrayBuffer();
    return new Response(audioBuffer, {
      headers: { 'Content-Type': 'audio/ogg; codecs=opus' },
    });
  } catch (err) {
    console.error('Speak error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
