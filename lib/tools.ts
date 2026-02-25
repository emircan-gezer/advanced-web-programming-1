async function sendPush(title: string, message: string) {
  try {
    const res = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: process.env.PUSHOVER_TOKEN!,
        user: process.env.PUSHOVER_USER!,
        title,
        message,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    console.log("[notify] push sent:", title);
  } catch (err) {
    console.error("[notify] push failed:", err);
  }
}

export async function recordUserDetails(email: string, name?: string) {
  console.log("[lead] captured:", { email, name });
  await sendPush("New Employer Contact", `Name: ${name ?? "N/A"}\nEmail: ${email}`);
  return { success: true };
}

export async function recordUnknownQuestion(question: string) {
  console.log("[unknown] question logged:", question);
  await sendPush("Human Intervention Needed", `The agent couldn't answer:\n"${question}"`);
  return { success: true };
}

export const tools = [
  {
    type: "function",
    function: {
      name: "record_user_details",
      description: "Record employer contact details and push a notification when they share an email.",
      parameters: {
        type: "object",
        properties: {
          email: { type: "string", description: "Employer email address" },
          name: { type: "string", description: "Employer name (optional)" },
        },
        required: ["email"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "record_unknown_question",
      description: "Log a question the agent can't answer and alert the owner via push notification.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The question that needs human review" },
        },
        required: ["question"],
      },
    },
  },
] as const;