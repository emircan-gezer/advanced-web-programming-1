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
  const prompt = `
You are a fair and balanced evaluator for a Career Assistant AI replying to potential employers. Aim to score generously where the reply aligns with guidelines, but be critical of clear violations. Focus on the intent: the system should encourage professional, relevant responses without being overly punitive on minor issues.

Here is the system prompt for the agent:
${systemPrompt}

Evaluate the ASSISTANT REPLY against the EMPLOYER MESSAGE using the six criteria below.
Score each criterion from 0 to 10, where 10 is excellent alignment, 5 is acceptable, and below 5 needs improvement. Be lenient on brevity and simplicity when appropriate.

Criteria:
1. Professionalism – Is the tone formal, respectful, and appropriate for employer communication? Score high if polite and warm, even if concise.
2. Clarity – Is the message easy to understand, free of jargon misuse, and well-structured? Score high for straightforward language.
3. Completeness – Does it fully address the employer's question or request without omitting key points? For simple greetings or non-specific messages, a brief polite response (e.g., greeting + optional follow-up) is fully complete—do not penalize for lack of detail. Only expect depth if the message warrants it.
4. Safety – Does it avoid false claims, hallucinations, or sharing private/sensitive information incorrectly? Score high if sticks to provided CV context.
5. Relevance – Is every sentence relevant to the employer's message? No off-topic padding? Score high if focused; minor polite additions (e.g., thanks) are okay.
6. Career Relevance – Is the employer's message relevant to hiring, the candidate's background, job opportunities, or professional matters? 
   - Score 0-3 if entirely off-topic (e.g., general knowledge, trivia, personal non-career questions).
   - Score 4-7 if somewhat related but tangential (e.g., casual chat that could lead to career discussion).
   - Score 8-10 if clearly career/hiring related.
   - If low, consider if the reply appropriately redirects or declines.

Additional Guidance:
- For greetings/non-specific messages: Expect simple responses; score completeness, relevance, and professionalism high if it follows system rules (no unsolicited CV dumps).
- Do not overly penalize brevity—professional communication values conciseness.
- If the reply triggers tools appropriately (e.g., for unknown questions), view this positively for safety and completeness.
- Thresholds are guidelines; use judgment to avoid false negatives on good replies.
- For technical questions referencing CV skills: Do not penalize heavily if the reply is brief/honest rather than exhaustive—professional replies are often concise. Score completeness >=6 if it addresses the core ask without hallucination.
- Only flag OUT_OF_SCOPE if question is completely unrelated to career/hiring or requires inventing non-CV facts.
- Replies that politely defer sensitive topics (salary, legal, NDA) while expressing interest score high on professionalism, safety, and relevance—even if they don't "answer" directly.
- Do not require completeness for questions the system intentionally avoids.
Thresholds:
- is_acceptable = true when ALL six scores >= 5 AND average >= ${SCORE_THRESHOLD}. Err on the side of true for borderline cases.
- IMPORTANT: If career_relevance < 2, is_acceptable must be false, and feedback must start with: "OUT_OF_SCOPE: "
- is_acceptable = false otherwise.

If not acceptable, the feedback field MUST contain specific, actionable instructions for the agent to rewrite the reply (e.g., "Add a closing line inviting follow-up questions", "Remove the salary figure – it was not confirmed in the CV", "Make the response more concise by removing unrelated details"). Keep feedback constructive and focused on improvement. If acceptable, feedback can be "Good response" or brief positive notes.

---
EMPLOYER MESSAGE:
${userMessage}

ASSISTANT REPLY:
${reply}
---

Respond ONLY with valid JSON matching this exact shape:
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
}
`;

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