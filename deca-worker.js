// Open Path Labs: DECA grading server (Cloudflare Worker)
// POST /grade       -> AI judge feedback as JSON   (needs ANTHROPIC_API_KEY, or a Workers AI binding named AI as a free fallback)
// POST /transcribe  -> turns an audio chunk into text (needs a Workers AI binding named AI)
// Setup: Workers & Pages > Create > Worker > paste this file > Deploy.
// Settings > Bindings > Add > Workers AI, name it exactly:  AI
// Settings > Variables and Secrets: ANTHROPIC_API_KEY (secret, optional but gives the best grading) and ALLOWED_ORIGIN (your site address).
// Then paste this Worker's URL into DECA_ENDPOINT in index.html.

const CLAUDE_MODEL = "claude-sonnet-5-5";            // change if you prefer another Claude model
const FREE_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const WHISPER = "@cf/openai/whisper-large-v3-turbo"; // model names can change; check Cloudflare's Workers AI list if a call fails

const SYSTEM = `You are an experienced DECA judge scoring a high school student's practice performance (a role play or a written event presentation).
Judge fairly but demandingly. Most strong high school performances land between 70 and 88 out of 100, and 90+ should be rare.
Use ONLY the rubric categories you are given, with their exact names, and never give more points than a category's max. The text in brackets after a category says what kind of category it is and which ideas the judges expect to see.
For role plays, also score each performance indicator from 0 to 14 and say what was missing.
Base every comment on specifics from the transcript or slides. Do not invent facts about the student. You cannot see body language or visuals, so do not score them.
Return ONLY valid JSON with this shape and nothing else:
{"total":number,"scores":[{"cat":string,"points":number,"max":number,"comment":string}],"pi":[{"pi":string,"points":number,"max":14,"comment":string}],"strengths":[string],"improvements":[string],"next":[string]}
Keep each comment under 40 words. Give 3 to 5 strengths, 4 to 6 improvements, and 3 next steps. Use plain text with no markdown.`;

export default {
  async fetch(req, env) {
    const cors = { "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return json({ error: "POST only" }, 405);
    const path = new URL(req.url).pathname;
    let body;
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

    if (path === "/transcribe") {
      if (!env.AI) return json({ error: "Add a Workers AI binding named AI" }, 500);
      if (!body.audio || body.audio.length > 4_000_000) return json({ error: "Audio chunk missing or too large" }, 400);
      try {
        const out = await env.AI.run(WHISPER, { audio: body.audio });
        return json({ text: (out.text || out.result?.text || "").trim() });
      } catch (e1) {
        try {
          const bytes = Uint8Array.from(atob(body.audio), c => c.charCodeAt(0));
          const out = await env.AI.run("@cf/openai/whisper", { audio: [...bytes] });
          return json({ text: (out.text || "").trim() });
        } catch (e2) { return json({ error: "Transcription failed" }, 502); }
      }
    }

    if (path === "/grade") {
      const rubric = (body.rubric || []).map(r => `${r[0]} (max ${r[1]})${r[2] ? " [" + String(r[2]).slice(0, 200) + "]" : ""}`).join("; ");
      const user = `Mode: ${body.mode}
Event or prompt title: ${String(body.event || "").slice(0, 200)}
${body.prompt ? "Situation or expected sections: " + String(body.prompt).slice(0, 2500) : ""}
${body.pis && body.pis.length ? "Performance indicators:\n- " + body.pis.map(x => String(x).slice(0, 300)).join("\n- ") : ""}
Rubric categories: ${rubric}
Speaking time (minutes): ${Number(body.minutes || 0).toFixed(1)}
${body.bodyLanguage ? "Body language measured on the student's device (0-100 each): overall " + body.bodyLanguage.score + "; " + body.bodyLanguage.parts.map(p => p[0] + " " + p[1] + " (" + String(p[2]).slice(0, 90) + ")").join("; ") + ". Mention it in the delivery or communication comments." : ""}
An automated first-pass estimate gave ${body.local?.total ?? "n/a"} out of 100; treat it as a rough hint only.

STUDENT PRESENTATION TRANSCRIPT:
"""${String(body.transcript || "").slice(0, 60000)}"""
${body.slides ? `\nSLIDE OR DOCUMENT TEXT:\n"""${String(body.slides).slice(0, 30000)}"""` : ""}`;
      try {
        let text;
        if (env.ANTHROPIC_API_KEY) {
          const r = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 2000, system: SYSTEM, messages: [{ role: "user", content: user }] }),
          });
          const d = await r.json();
          text = d.content?.[0]?.text;
        } else if (env.AI) {
          const out = await env.AI.run(FREE_MODEL, { messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }], max_tokens: 1800 });
          text = out.response || out.result?.response;
        } else return json({ error: "Add ANTHROPIC_API_KEY or a Workers AI binding named AI" }, 500);
        const m = String(text || "").match(/\{[\s\S]*\}/);
        if (!m) return json({ error: "The AI did not return usable feedback" }, 502);
        return json(JSON.parse(m[0]));
      } catch (e) { return json({ error: "Grading failed. Please try again." }, 502); }
    }
    return json({ error: "Not found" }, 404);
  },
};
