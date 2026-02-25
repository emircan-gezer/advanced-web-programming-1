import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { tools, recordUserDetails, recordUnknownQuestion, recordInterviewRequest } from "./tools";
import { evaluateReply } from "./evaluator";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const MAX_REVISIONS = 3;

type Message = {
  role: "user" | "assistant" | "system" | "tool";
  content: string; 
  tool_calls?: any[];
  tool_call_id?: string;
};

async function loadCVContext(): Promise<string> {
  const meDir = path.join(process.cwd(), "me");
  const parts: string[] = [];

  const summaryPath = path.join(meDir, "ecg-summary.txt");
  if (fs.existsSync(summaryPath))
    parts.push(`=== CV Summary ===\n${fs.readFileSync(summaryPath, "utf-8").trim()}`);

  const pdfPath = path.join(meDir, "ecg-linkedin.txt");
    if (fs.existsSync(pdfPath)) {
      parts.push(`=== LinkedIn Profile ===\n${fs.readFileSync(pdfPath, "utf-8").trim()}`);
  }

  if (!parts.length) {
    console.warn("[agent] no CV files found in ./me — running without context");
    return "(No CV context available)";
  }

  return parts.join("\n\n");
}

export class CareerAgent {
  memory: Message[] = [];
  private cvContext: string | null = null;

  private async getSystemPrompt(): Promise<string> {
    if (!this.cvContext) this.cvContext = await loadCVContext(); // lazy load once

    return `
You are a professional AI Career Assistant replying to employers on behalf of the candidate below.

${this.cvContext}

Core Behavior:
- Write in first person as the candidate.
- Be professional, warm, and concise.
- Never invent skills or experiences not supported by the CV.
- Keep replies short and relevant.

Allowed Personal/Background Questions:
- If the employer asks for basic factual information clearly present in the CV (e.g., age, location, education, years of experience):
  - Answer briefly and professionally.
  - Do NOT trigger record_unknown_question.
  - Do NOT over-explain.

- Only defer when the question involves:
  - salary or compensation details
  - legal matters
  - confidential information
  - or facts NOT present in the CV

Tool Rules:
- If the employer provides their email → call record_user_details immediately.
- If the employer requests an interview or meeting → collect details (date, time, mode, and contact info) → call record_interview_request → reply politely with a confirmation, e.g., "I noted the details. Thank you, I will follow up as needed."
- If the question is uncertain, sensitive, or outside the CV (e.g., salary specifics, legal matters, unknown technologies) → call record_unknown_question and politely defer.

Greeting Handling:
- If the message is only a greeting or very vague:
  - Reply with a brief polite greeting.
  - Optionally ask how you can help.
  - Do NOT provide a full background or CV summary unless asked.

Response Guidelines:
- Provide detailed background only when explicitly requested.
- Interview invitations → express interest and confirm availability or request details.
- Technical questions → answer strictly using CV evidence.
- Declining opportunities → be polite and leave the door open.
- Prioritize clarity, relevance, and brevity.

Unknown Question Deferral Style:
When deferring sensitive topics, respond politely and suggest follow-up. For example:
"Thank you for the question. I’d prefer to discuss that personally to ensure accuracy. Could we review it on a quick call?"

Use record_unknown_question ONLY when:
- The employer asks about salary, compensation, or benefits
- Legal or contractual matters are involved
- The question requires information NOT present in the CV
- The question requests speculation or confidential details

Do NOT use record_unknown_question for simple factual questions that are clearly answered by the CV.
Examples:

Employer: "Hi"
Reply: "Hello, I am Emircan Gezer! How can I assist you today?"

Employer: "Tell me about your experience in software engineering."
Reply: [Brief, CV-grounded summary]

Employer: "What's your salary expectation?"
Action: call record_unknown_question
Reply: polite deferral

Example:

Employer: "How old are you?"
If age is in CV:
Reply: Provide a brief, professional answer.

If age is NOT in CV:
Action: record_unknown_question and politely defer.
`.trim();
  }

  private async handleToolCall(toolCalls: any[]): Promise<Message[]> {
    return Promise.all(
      toolCalls.map(async (call) => {
        const args = JSON.parse(call.function.arguments);

        if (call.function.name === "record_user_details")
          await recordUserDetails(args.email, args.name);
        else if (call.function.name === "record_unknown_question")
          await recordUnknownQuestion(args.question);
        else if (call.function.name === "record_interview_request"){
          await recordInterviewRequest({
            date: args.date,
            time: args.time,
            mode: args.mode,
            contactEmail: args.contactEmail,
            contactPhone: args.contactPhone,
            notes: args.notes,
          });
        }
        return { role: "tool" as const, tool_call_id: call.id, content: JSON.stringify({ success: true }) };
      })
    );
  }

  async chat(userMessage: string): Promise<{ reply: string; confidence: number; evaluation_log: any[] }> {
    this.memory.push({ role: "user", content: userMessage });

    const messages: Message[] = [
      { role: "system", content: await this.getSystemPrompt() },
      ...this.memory,
    ];

    const evaluationLog: any[] = [];
    let revisions = 0;
    let bestReply = "";
    let bestConfidence = 0;

    while (true) {
      const res = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: messages as any,
        tools: tools as any,
        temperature: 0.4,
      });

      const choice = res.choices[0];

      if (choice.finish_reason === "tool_calls") {
        const toolResults = await this.handleToolCall(choice.message.tool_calls || []);
        messages.push(choice.message as any);
        messages.push(...toolResults);
        continue;
      }

      const reply = choice.message.content ?? "";

      const systemPrompt = await this.getSystemPrompt();
      const evaluation = await evaluateReply(reply, userMessage, systemPrompt);
      evaluationLog.push({ revision: revisions, ...evaluation });

      if (evaluation.feedback.startsWith("OUT_OF_SCOPE")) {
        const fallback = "I’m not able to help with that. I can assist with questions about my background, projects, or career opportunities.";
        this.memory.push({ role: "assistant", content: fallback });
        return { reply: fallback, confidence: 0, evaluation_log: evaluationLog };
      }

      if (evaluation.confidence > bestConfidence) {
        bestReply = reply;
        bestConfidence = evaluation.confidence;
      }

      if (evaluation.is_acceptable) {
        this.memory.push({ role: "assistant", content: reply });
        return { reply, confidence: evaluation.confidence, evaluation_log: evaluationLog };
      }

      revisions++;

      if (revisions >= MAX_REVISIONS) {
        console.warn(`[agent] hit max revisions, returning best attempt`);
        this.memory.push({ role: "assistant", content: bestReply });
        return { reply: bestReply, confidence: bestConfidence, evaluation_log: evaluationLog };
      }

      console.log(`[agent] revision ${revisions} — ${evaluation.feedback}`);
      messages.push({ role: "assistant", content: reply });
      messages.push({
        role: "user",
        content: `[EVALUATOR FEEDBACK — internal, do not show employer]\n${evaluation.feedback}\n\nRewrite your reply addressing the above.`,
      });
    }
  }
}

export const agent = new CareerAgent();