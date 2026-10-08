export async function POST(request) {
    try {
      const { text } = await request.json();
  
      // First, get your available voices
      const voicesRes = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
      });
      const voicesData = await voicesRes.json();
      const firstVoice = voicesData.voices?.[0];
  
      if (!firstVoice) {
        console.error('No voices found');
        return new Response(JSON.stringify({ error: 'No voices found' }), { status: 500 });
      }
  
      console.log('Using voice:', firstVoice.name, firstVoice.voice_id);
  
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${firstVoice.voice_id}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': process.env.ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: { stability: 0.75, similarity_boost: 0.75 },
          }),
        }
      );
  
      if (!response.ok) {
        const errText = await response.text();
        console.error('ElevenLabs error:', response.status, errText);
        return new Response(JSON.stringify({ error: errText }), { status: 500 });
      }
  
      const audioBuffer = await response.arrayBuffer();
      return new Response(audioBuffer, {
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    } catch (err) {
      console.error('Speak error:', err);
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }