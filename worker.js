// Open Path Labs: AI proxy (Cloudflare Worker)
// Your API key stays here on the server, never in index.html.
// Settings > Variables: ANTHROPIC_API_KEY (secret), ALLOWED_ORIGIN (your site, e.g. https://yoursite.org)

const MODEL = "claude-haiku-4-5-20251001"; // fast and low cost. For smarter answers use "claude-sonnet-5-5".

const SYSTEM = `You are Path, the assistant for Open Path Labs, a student-led nonprofit focused on financial education.
You can answer questions about personal finance, investing, banking, credit, taxes, college costs, retirement, real estate, economics, and business topics such as startups, accounting, marketing, and valuation. You can also help with math, logic, everyday reasoning, and school subjects.
Teach concepts clearly with simple examples and show the math when it helps. You are not a licensed advisor, so for decisions about specific investments, taxes, or legal matters, give general information and suggest a qualified professional.
Keep answers under about 150 words unless the visitor asks for more. Use plain text only, with no markdown or bullet symbols.
If you are not sure, say so instead of guessing. Decline requests that could cause harm.
When relevant, mention the Open Path Labs tools: College Cost Calculator, Budget Planner, Savings Goal Planner, Compound Interest Simulator, Investment Simulator, Student Loan Calculator, Stock Tracker, Rent vs Buy, Credit Score Simulator, Retirement Planner, Startup Valuation Calculator, Study Tools, and the AP Study Hub (APUSH, AP Gov, AP Calculus, AP Chemistry, AP Java, AP Econ, AP Biology, AP Psychology, AP Statistics).`;

export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return json({ reply: "Method not allowed." }, 405);

    let body;
    try { body = await req.json(); } catch { return json({ reply: "Bad request." }, 400); }

    // Keep only the last 12 messages, cap their length, and make sure the first one is from the user.
    let messages = (body.messages || []).slice(-12).map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || "").slice(0, 2000),
    }));
    while (messages.length && messages[0].role !== "user") messages.shift();
    if (!messages.length) return json({ reply: "Ask me a question to get started." }, 400);

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model: MODEL, max_tokens: 700, system: SYSTEM, messages }),
      });
      const d = await r.json();
      const reply = d.content?.[0]?.text;
      if (!reply) return json({ reply: "Sorry, I couldn't answer that. Please try again." }, 502);
      return json({ reply });
    } catch {
      return json({ reply: "Sorry, something went wrong. Please try again." }, 502);
    }
  },
};
