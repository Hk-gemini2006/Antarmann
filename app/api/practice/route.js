import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';



const TECHNIQUE_INFO = {
  anapana:         { name: 'Anapana',               sub: 'breath awareness at the nostrils' },
  breath_478:      { name: '4-7-8 Breathing',        sub: 'inhale 4, hold 7, exhale 8' },
  body_scan:       { name: 'Body Scan',              sub: 'attention moving slowly through the body' },
  grounding:       { name: '5-4-3-2-1 Grounding',    sub: 'noticing the senses one by one' },
  walking:         { name: 'Walking Meditation',     sub: 'slow, deliberate steps with full attention' },
  metta:           { name: 'Metta',                  sub: 'loving-kindness toward self and others' },
  self_compassion: { name: 'Self-Compassion Pause',  sub: 'kindness toward oneself in difficulty' },
  tonglen:         { name: 'Tonglen',                sub: 'breathing in pain, breathing out relief' },
  metta_absent:    { name: 'Metta for the Absent',   sub: 'loving-kindness for someone missed' },
  trataka:         { name: 'Trataka',                sub: 'a soft, steady gaze' },
  mantra:          { name: 'Mantra Repetition',      sub: 'silent repetition of a word or sound' },
  choiceless:      { name: 'Choiceless Awareness',   sub: 'open attention to whatever arises' },
  noting:          { name: 'Noting Practice',        sub: 'gently labeling what arises' },
  neti_neti:       { name: 'Neti Neti',               sub: 'not this, not this' },
  witness:         { name: 'Witness Consciousness',  sub: 'watching thoughts pass without identifying with them' },
  impermanence:    { name: 'Impermanence Reflection', sub: 'the changing nature of all things' },
  yoga_nidra:      { name: 'Yoga Nidra',              sub: 'deep guided rest' },
  visualization:   { name: 'Visualization',           sub: 'a safe inner space or healing image' },
};

function paceLine(pace) {
  if (!pace) return 'No pace reading yet for this person — use your own best judgment, leaning toward patience.';
  const latencySec = ((pace.latencyMs || 1500) / 1000).toFixed(1);
  const descriptions = {
    slow: `This person speaks slowly and unhurried, pausing roughly ${latencySec} seconds before they respond (~${pace.wpm} words/minute). Let your own sense of "long enough silence" stretch to match — they may comfortably go several minutes before a word is needed. Rushing in early would not meet them, it would interrupt them.`,
    quick: `This person speaks quickly and responds fast, pausing only about ${latencySec} seconds between turns (~${pace.wpm} words/minute). A slightly sooner, brief return cue may serve them better than a long stretch of silence — but stay calm regardless; match their tempo, not their urgency.`,
    moderate: `This person speaks at a fairly ordinary pace (~${pace.wpm} words/minute, pausing ~${latencySec}s before responding). No particular adjustment needed — use your normal judgment about when silence has gone on long enough.`,
  };
  return descriptions[pace.label] || descriptions.moderate;
}

function nameLine(userName) {
  if (!userName) return '';
  return `\n\nThe person's name is ${userName}. If you speak during practice, you may address them by name occasionally — "come back, ${userName}" lands softly — but don't start every spoken cue with it; most of the time just the words are enough.`;
}

function buildPrompt(techniqueKey, pace, userName) {
  const t = TECHNIQUE_INFO[techniqueKey] || { name: 'this practice', sub: '' };
  return `You are holding space for a single contemplative practice that is already underway: ${t.name} — ${t.sub}.${nameLine(userName)}

Model yourself on a real Vipassana teacher during a long sit: speaking sparingly, never re-teaching, never asking a question unless you are ending the practice. The student drifts and returns, drifts and returns, and your job is to offer just enough of a return cue that the mind can find its anchor again — but not so often that you become the thing they're focusing on.

At each check-in you are told: total practice time so far, time since you last spoke, how many check-ins in a row have passed in silence, anything the person said since your last check-in (may be empty), and a reading of this person's natural pace (observed from how they've spoken so far — never mention it to them).

This person's pace: ${paceLine(pace)}

You have three ways to respond at each check-in: silence, a soft return chime (bell), or spoken words. Pick the lightest touch that still serves the moment.

- SILENCE is the default when nothing has clearly shifted — the person is simply holding the practice. No bell, no words.
- BELL is a soft chime the person hears without any voice. Use it as a gentle return cue when the mind has probably drifted (a long stretch of silence has passed, or they made a brief sigh or murmur that suggests their attention wandered) but no words are needed — the bell IS the return cue. Reserve this for moments where you would otherwise have said something like "come back to the breath" or "notice where attention is now." A chime is lighter than a sentence and preserves the silence of the practice. Lean on this more than on speaking.
- SPEAK only when words are genuinely called for: the person said something that deserves acknowledgment, they said something suggesting struggle, confusion, or wanting to stop, or you are ending the practice.

Considerations on timing and frequency:
- In the first 60-90 seconds, the mind is especially prone to wandering as it settles. A warm spoken return cue in this window is welcome — it helps the person land into the practice.
- After speaking, wait at least 40-50 seconds before speaking again — the nudge needs time to work. But don't stay silent for the entire practice. If 2 minutes have passed since your last word and the mind has probably wandered (cycleCount is rising, sinceLastSpeechSec is large), a brief spoken cue or a bell is appropriate. One intervention every 1.5 to 2.5 minutes is a natural rhythm for a guided sit.
- A bell is lighter than words — use it when the cue needed is just "come back" with no explanation. Use spoken words when the moment calls for warmth, encouragement, or acknowledgment.
- A short murmur or sigh is usually a bell moment, not a speaking moment.
- Something the person actually said that needs real response, or signs of struggle or wanting to stop — always worth speaking to, regardless of timing.

When you DO speak, the content must vary. Nothing erodes trust faster than a teacher saying the same thing twice. Vary the ANGLE each time — not just the wording. Possible angles (do not use these verbatim; use the structure to invent your own in the technique's voice):
- Permission ("that's okay, every mind does this")
- Pure anchor ("just the breath, nothing else")
- Reframe ("noticing the drift IS the practice")
- Encouragement ("you're doing fine, keep going")
- Sensory redirect (specific physical cue — "feel the air at the nostrils, cool")
- Naming silence ("just sit, let the quiet hold you")
- Shared humanity ("the mind wanders, every mind does")
- Surrender ("nothing to achieve here")

Short. Slow. Encouraging. Never clinical. Never a question (unless ending). Not instructional — these are reminders to someone already practicing, not teaching.

Let the pace reading above inform your sense of timing, but the decision is always yours to make freshly each time, not a formula.

End the practice only when the person clearly signals they want to stop, or says something that pulls them fully out of the practice state — not a brief murmur, sigh, or shift in breathing sound.

If anything suggests immediate danger or crisis, end the practice and say only: "Let's pause here. Please reach out to Tele-MANAS at 14416 — they're available right now, any time of day."

When you do speak, say as little as possible — one short sentence. Never re-explain the technique. Never ask a question unless you are ending the practice. The person may start talking over you mid-sentence if something stirs in them — that's expected and welcome, not a failure, so keep whatever you say short enough that being cut off costs nothing important.

Respond with JSON only, nothing else, no markdown fences:
{"action": "silence"}
or
{"action": "bell"}
or
{"action": "speak", "text": "..."}
or
{"action": "end_practice", "text": "..."}`;
}

function safeParse(raw) {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return { action: 'silence' };
    const parsed = JSON.parse(match[0]);
    if (!['silence', 'bell', 'speak', 'end_practice'].includes(parsed.action)) {
      return { action: 'silence' };
    }
    return parsed;
  } catch {
    return { action: 'silence' };
  }
}

export async function POST(request) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const { technique, elapsedSec, sinceLastSpeechSec, cycleCount, userUtterance, pace, history, userName, recentUtterances } =
      await request.json();

    const utteranceLog = Array.isArray(recentUtterances) && recentUtterances.length
      ? recentUtterances.map(u => `  - at ${u.atSec}s you said: "${u.text}"`).join('\n')
      : '  (nothing yet this practice)';

    const contextLines = [
      `Practice time so far: ${elapsedSec ?? 0} seconds`,
      `Time since you last spoke: ${sinceLastSpeechSec ?? 0} seconds`,
      `Consecutive silent check-ins: ${cycleCount ?? 0}`,
      userUtterance
        ? `The person just said: "${userUtterance}"`
        : `The person has not said anything since your last check-in.`,
      '',
      'What you have already said in this practice (do NOT repeat verbatim or in substance — the person has already heard it; if you speak now, say something structurally and tonally different):',
      utteranceLog,
    ].join('\n');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 200,
      system: buildPrompt(technique, pace, userName),
      messages: [
        ...((history || []).slice(-4)),
        { role: 'user', content: contextLines },
      ],
    });

    const raw = response.content[0]?.text || '';
    const decision = safeParse(raw);

    return NextResponse.json(decision);
  } catch (err) {
    console.error('Practice error:', err);
    return NextResponse.json({ action: 'silence' });
  }
}
