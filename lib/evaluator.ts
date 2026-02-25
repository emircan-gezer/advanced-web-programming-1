import OpenAI from "openai";

export type Evaluation = {
  is_acceptable: boolean;
  feedback: string;
  confidence: number;
  scores: {
    professionalism: number;
    clarity: number;
    completeness: number;
    safety: number;
    relevance: number;
    career_relevance: number;
  };
};
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export const SCORE_THRESHOLD = 5;

export async function evaluateReply(
  reply: string,
  userMessage: string,
  systemPrompt: string
): Promise<Evaluation> {
  const prompt = `You are a fair and balanced evaluator for a Career Assistant AI that replies to potential employers.

Your goal is to reward professional, relevant responses while flagging clear problems. Be reasonably generous and do not penalize minor issues such as brevity when the response is appropriate.

Here is the system prompt for the agent:
${systemPrompt}

Evaluate the ASSISTANT REPLY against the EMPLOYER MESSAGE using the six criteria below.

Scoring Rules:
- Score each criterion from 0–10.
- 10 = excellent alignment
- 5 = acceptable
- <5 = needs improvement
- Be lenient when brevity is appropriate.
- Focus on real problems, not stylistic preferences.

Criteria:

1. Professionalism  
Is the tone respectful, polite, and appropriate for employer communication?  
Score high if warm and professional, even if brief.

2. Clarity  
Is the message easy to understand and well-structured?  
Score high for straightforward language.

3. Completeness  
Does the reply appropriately address the employer’s message?

IMPORTANT:
- For greetings or vague messages, a short polite reply is fully complete.
- Only expect depth when the employer clearly requests it.
- Do NOT penalize intentional deferrals (e.g., salary, legal topics).

4. Safety  
Does the reply avoid hallucinations, false claims, or unsupported details?  
Score high if it stays grounded in the CV and safely defers when needed.

5. Relevance  
Is the reply focused on the employer’s message without off-topic padding?  
Minor polite phrases (e.g., thanks) are fine.

6. Career Relevance  
How career-related is the employer’s message?

Scoring guide:
- 0–3: completely off-topic (weather, trivia, unrelated chat)
- 4–7: somewhat related or ambiguous
- 8–10: clearly hiring/career related

If career relevance is low, check whether the assistant appropriately redirected or declined.

Additional Guidance:

- Greetings/non-specific messages should receive high scores if handled briefly and politely.
- Do not punish concise technical answers that correctly reflect the CV.
- Tool-triggered deferrals for sensitive topics are GOOD behavior.
- Only mark OUT_OF_SCOPE when the employer message is truly unrelated to careers or requires inventing facts.
- Use judgment to avoid false negatives on otherwise good replies.

Acceptance Rule:

Set is_acceptable = true ONLY if:
- ALL six scores ≥ 5  
AND
- average score ≥ ${SCORE_THRESHOLD}

However, err on the side of true for borderline good responses.

Hard Rule:
If career_relevance < 2:
- is_acceptable MUST be false
- feedback MUST start with: "OUT_OF_SCOPE: "

Feedback Rules:

If NOT acceptable:
- Provide specific, actionable rewrite guidance.
- Focus on the biggest fix needed.
- Examples:
  - "Add a brief confirmation of interest."
  - "Remove unsupported claim about React experience."
  - "Make the response more concise."
  - "Politely defer the salary question."

If acceptable:
- Use brief positive feedback (e.g., "Good response").

---

EMPLOYER MESSAGE:
${userMessage}

ASSISTANT REPLY:
${reply}

---

Respond ONLY with valid JSON in this exact shape:

{
  "is_acceptable": boolean,
  "feedback": "string",
  "confidence": number,
  "scores": {
    "professionalism": number,
    "clarity": number,
    "completeness": number,
    "safety": number,
    "relevance": number,
    "career_relevance": number
  }
}`;

  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0,
  });

  const raw = JSON.parse(res.choices[0].message.content!);

  if (raw.confidence === undefined && raw.scores) {
    const vals = Object.values(raw.scores) as number[];
    raw.confidence = vals.reduce((a, b) => a + b, 0) / vals.length / 10;
  }

  console.log(
    "[evaluator] scores:",
    raw.scores,
    "| acceptable:",
    raw.is_acceptable,
    "| confidence:",
    raw.confidence.toFixed(2)
  );

  return raw as Evaluation;
}