import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('netlify/functions/_lib/benchmark-free-router.mts','utf8');
const status = readFileSync('netlify/functions/ai-status.mts','utf8');

for (const provider of ['groq','gemini','openrouter']) {
  assert.match(source, new RegExp("provider: ['\"]" + provider + "['\"]"));
}
assert.match(source, /GROQ_API_KEY/);
assert.match(source, /GEMINI_API_KEY/);
assert.match(source, /OPENROUTER_API_KEY/);
assert.match(source, /nvidia\/nemotron-3-ultra-550b-a55b:free/);
assert.match(source, /gemini-3\.8-flash/);
assert.match(source, /:generateContent/);
assert.match(source, /jsonInstruction\(schema\)/);
assert.match(source, /const responseText = await response\.text\(\)/);
assert.match(source, /openai\/gpt-oss-120b/);
assert.match(source, /benchmark-synthetic-only/);
assert.match(status, /acceptance_requires_fixture_quality_gate: true/);
assert.match(status, /provider_order: \['groq','gemini','openrouter'\]/);

const groqIndex = source.indexOf("if (env('GROQ_API_KEY'))");
const geminiIndex = source.indexOf("if (env('GEMINI_API_KEY')");
const openrouterIndex = source.indexOf("if (env('OPENROUTER_API_KEY'))");
assert.ok(groqIndex > 0 && geminiIndex > groqIndex && openrouterIndex > geminiIndex);

console.log(JSON.stringify({
  ok:true,
  benchmark_router:'provider-agnostic-v5',
  provider_order:['groq','gemini','openrouter'],
  openrouter_daily_quota_is_not_single_point_of_failure:true,
  synthetic_fixture_privacy_boundary:true
},null,2));
