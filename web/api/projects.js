import { db } from "hatchable";

export const access = "public";
export const methods = ["GET", "POST"];

export default async function (req, res) {
  if (req.method === "GET") {
    const { rows } = await db.query(
      `SELECT id, title, logline, setting, primary_audience, audience_scope, story_period, status, progress, created_at, updated_at
       FROM projects
       ORDER BY updated_at DESC`
    );
    return res.json(rows);
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const title = String(body.title || "").trim();
    if (!title) return res.status(400).json({ error: "Story title is required." });

    const sourceText = String(body.sourceText || "");
    const setting = String(body.setting || "").trim();
    const primaryAudience = String(body.primaryAudience || "").trim();
    const audienceScope = ["global", "regional", "local"].includes(body.audienceScope) ? body.audienceScope : "global";
    const storyPeriod = ["present", "historical", "future"].includes(body.storyPeriod) ? body.storyPeriod : "present";
    const id = `proj_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const logline = sourceText.trim().slice(0, 150) || "New story waiting for its first creative analysis.";

    const { rows } = await db.query(
      `INSERT INTO projects (id, title, logline, source_text, setting, primary_audience, audience_scope, story_period, status, progress)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',5)
       RETURNING id, title, logline, setting, primary_audience, audience_scope, story_period, status, progress, created_at, updated_at`,
      [id, title, logline, sourceText || null, setting || null, primaryAudience || null, audienceScope, storyPeriod]
    );

    const project = rows[0];
    const contexts = [
      ["audience", "Primary audience", primaryAudience || audienceScope],
      ["time", "Story period", storyPeriod],
    ];
    if (setting) contexts.push(["location", "Story setting", setting]);

    for (const [contextType, label, scopeValue] of contexts) {
      await db.query(
        `INSERT INTO project_contexts (project_id, context_type, label, scope_value, status)
         VALUES ($1,$2,$3,$4,'planned')`,
        [id, contextType, label, scopeValue]
      );
    }

    return res.status(201).json(project);
  }

  return res.status(405).json({ error: "Method not allowed" });
}
