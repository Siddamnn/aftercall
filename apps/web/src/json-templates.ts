// Templates and AI prompts for the two JSON files users make: conversations to analyse, and
// trackers to import. The rules mirror the backend (ingest.py CallIn, signals.py SignalSpec).

export const CALLS_TEMPLATE = {
  calls: [
    {
      external_id: 'call-0001',
      agent_id: 'booking-bot',
      agent_version: 'v3',
      started_at: '2026-09-25T10:02:00+05:30',
      channel: 'call',
      metadata: { team: 'inbound', city: 'Pune' },
      transcript: [
        { speaker: 'agent', text: 'Hello, this is Priya from Sunrise Clinic. How can I help?' },
        { speaker: 'caller', text: 'I want to book a dental check-up for Saturday.' },
        { speaker: 'agent', text: 'Saturday at 11 is free. Shall I book it?' },
        { speaker: 'caller', text: 'Yes, please.' },
      ],
    },
    {
      external_id: 'chat-0002',
      channel: 'chat',
      transcript: 'customer: How much is a consultation?\nagent: The first one is 500 rupees.\ncustomer: Too much, thanks.',
    },
  ],
}

export const TRACKERS_TEMPLATE = [
  {
    name: 'outcome',
    description: 'How the conversation ended',
    signals: [
      {
        name: 'call_outcome',
        type: 'choice',
        instructions: 'How did the conversation end?',
        criteria: {
          booked: 'An appointment was booked',
          declined: 'The customer said no',
          callback: 'They agreed to talk again later',
          other: 'None of the above',
        },
      },
    ],
  },
  {
    name: 'experience',
    description: 'How the customer felt',
    signals: [
      {
        name: 'asked_for_human',
        type: 'yes_no',
        instructions: 'Did the customer ask to speak to a person instead of the bot?',
      },
      {
        name: 'frustration',
        type: 'score',
        instructions: 'How frustrated was the customer by the end?',
        criteria: [
          'Calm: polite or neutral throughout',
          'Irritated: some impatience, but still cooperative',
          'Frustrated: repeated complaints or a raised tone',
          'Angry: hostile, threatens to complain or leave',
        ],
        review_threshold: 0.7,
      },
    ],
  },
]

export const pretty = (v: unknown) => JSON.stringify(v, null, 2)

/** The smallest files that work, for the guide's first example. */
export const CALLS_MINIMAL = { calls: [{ transcript: 'agent: Hello!\ncaller: Hi, I want to book an appointment.' }] }
export const TRACKERS_MINIMAL = [{ name: 'outcome', signals: [{ name: 'booked', type: 'yes_no', instructions: 'Was an appointment booked?' }] }]

export const CALLS_PROMPT = `You convert conversation transcripts into a JSON file for aftercall, a tool that analyses calls and chats.

Output only valid JSON, no explanation and no code fences, in exactly this shape:

{
  "calls": [
    {
      "external_id": "your ID for the conversation (optional)",
      "agent_id": "which agent or bot handled it (optional)",
      "agent_version": "that agent's version, like v3 (optional)",
      "started_at": "when it started, ISO 8601 like 2026-09-25T10:02:00+05:30 (optional)",
      "channel": "call, chat, email or voice_agent (optional)",
      "metadata": { "any_key": "any text, like team or rep (optional)" },
      "transcript": [
        { "speaker": "agent", "text": "what they said" },
        { "speaker": "caller", "text": "what they said" }
      ]
    }
  ]
}

Rules:
- One object per conversation, in the order given.
- Copy every line word for word. Don't translate, summarise, fix grammar or drop filler words. Mixed languages (like Hindi in Latin script) stay as they are.
- Use "agent" for the business side (a person or a bot) and "caller" (or "customer" in chats) for the other side.
- Leave out any optional field you don't know. Never make up IDs, dates or names.
- Use straight double quotes, and escape any double quote inside a line as \\".

Here are my conversations:

[PASTE YOUR TRANSCRIPTS HERE]`

export const TRACKERS_PROMPT = `You design trackers for aftercall, a tool that asks every call or chat the same questions and charts the answers.

What I want to learn from my conversations:
[DESCRIBE YOUR USE CASE AND WHAT YOU WANT TO KNOW, e.g. "Inbound calls to a dental clinic. I want to know if they booked, why they declined, and whether the bot upset anyone."]

Output only valid JSON, no explanation and no code fences: a list of trackers. A tracker groups related signals; a signal is one question asked of every conversation.

[
  {
    "name": "outcome",
    "description": "How the conversation ended",
    "signals": [
      { "name": "call_outcome", "type": "choice", "instructions": "How did the conversation end?",
        "criteria": { "booked": "An appointment was booked", "declined": "The customer said no", "other": "None of the above" } },
      { "name": "asked_for_human", "type": "yes_no", "instructions": "Did the customer ask for a person?" },
      { "name": "frustration", "type": "score", "instructions": "How frustrated was the customer?",
        "criteria": ["Calm: polite throughout", "Irritated: some impatience", "Angry: hostile or threatening"] }
    ]
  }
]

Rules (the file is rejected if any is broken):
- Every "name" is lowercase letters, digits and underscores, starts with a letter, and is at most 64 characters. Tracker names can't contain "__". Names are unique within their tracker.
- A tracker has only "name", "description" and "signals". A signal has only "name", "type", "instructions", "criteria" and, optionally, "review_threshold".
- "type" is "choice" (pick one option), "yes_no", or "score" (an ordered scale).
- choice: "criteria" is an object of 2 or more options, key → a one-line description. Keys follow the name rule. It must include "other".
- yes_no: no "criteria", or only {"true": "…", "false": "…"} to explain what counts.
- score: "criteria" is a list of 2 to 10 levels, lowest first, each "Label: what it looks like".
- "instructions" asks one clear question in plain words, at most 2000 characters. Say what to do when the conversation doesn't show it.
- "review_threshold" (optional) is between 0 and 1: answers less sure than this are flagged for a person to check.
- Keep it small: 2 to 4 trackers, 1 to 4 signals each. Fewer, sharper questions give better answers and cost less.`
