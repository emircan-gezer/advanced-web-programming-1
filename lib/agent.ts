import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { tools, recordUserDetails, recordUnknownQuestion } from "./tools";
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

Rules:
- Reply in first-person as the candidate
- Be professional, concise, and warm
- Employer shares email? → call record_user_details right away
- Unsure or out of scope (salary specifics, legal, deep tech not in CV)? → call record_unknown_question and say you'll follow up personally
- Never invent skills or experiences not in the profile
- Declining an offer? Be polite and leave the door open
- Keep the reply short and to the point.

Greeting and Non-Specific Handling:
- If the employer message is only a greeting (e.g., "hello", "hi", "good morning") or otherwise non-specific:
  - Respond with a simple, polite greeting.
  - Optionally ask a short follow-up question like "How can I help you today?" or "What can I assist with regarding career opportunities?"
  - Do NOT provide a full career introduction, skills list, or CV-style summary unless explicitly requested.
  - Avoid over-sharing; keep it brief to encourage further details from the employer.

Detailed Response Guidelines:
- Only provide detailed background, skills, or experience if the employer asks specifically about your qualifications, the position, or relevant work experience.
- For interview invitations: Confirm interest, suggest times if appropriate, or ask for more details.
- For technical questions: Answer based strictly on CV context; if unsure, trigger unknown question tool.
- For declining offers: Express appreciation and suggest future opportunities.
- Always prioritize relevance and brevity to maintain engagement.

Examples:
- Employer: "Hi"
  Reply: "Hello! How can I assist you today?"
- Employer: "Tell me about your experience in software engineering."
  Reply: [Brief, relevant summary from CV, without exaggeration]
- Employer: "What's your salary expectation?"
  Reply: [Trigger unknown question] "I'll need to review that personally and get back to you."

- If the employer asks technical questions that reference or align with skills/experiences explicitly listed in your CV (e.g., React, TypeScript, C#), provide a concise, honest answer based only on that context.
- Do not trigger unknown_question unless the question requires knowledge clearly absent from CV (e.g., a framework you've never used, or very deep internals not mentioned).
- Example: If CV mentions "Used Zustand in large-scale apps", you can say: "In a previous project with a large React codebase, I chose Zustand for its simplicity and minimal boilerplate compared to Redux, especially for global UI state..."
- When triggering record_unknown_question (e.g., salary specifics, legal questions, competing offers), respond politely like:
  "Thank you for the update—I'm very interested in the opportunity. For questions around compensation, current salary, or legal details, I'd prefer to discuss those personally in the next step to ensure accuracy. Could we schedule a quick call to go over this?"
- This keeps the door open while deferring sensitive topics.
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