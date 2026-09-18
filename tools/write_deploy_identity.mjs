import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const clean = (value, max = 1200) =>
  String(value ?? '').replace(/[\r\n\t]/g, '').trim().slice(0, max);

const commitRef = clean(process.env.COMMIT_REF, 160).toLowerCase();
const deployId = clean(process.env.DEPLOY_ID || process.env.BUILD_ID, 160);
const deployUrl = clean(process.env.DEPLOY_URL, 1200).replace(/\/$/, '');
const deployPrimeUrl = clean(process.env.DEPLOY_PRIME_URL, 1200).replace(/\/$/, '');
const context = clean(process.env.CONTEXT || 'unknown', 80);
const siteName = clean(process.env.SITE_NAME || 'parable-studio', 160);

if (!commitRef || !deployId || !deployUrl) {
  throw new Error(
    'Netlify build identity is incomplete: COMMIT_REF, DEPLOY_ID/BUILD_ID and DEPLOY_URL are required.'
  );
}

if (!/^[a-f0-9]{40}$/i.test(commitRef)) {
  throw new Error('COMMIT_REF is not a full Git commit SHA.');
}

if (!/^[a-zA-Z0-9_-]{6,128}$/.test(deployId)) {
  throw new Error('DEPLOY_ID is not in the expected format.');
}

const immutableUrl = deployUrl || `https://${deployId}--${siteName}.netlify.app`;

const payload = {
  identity_version: 'parable-static-deploy-identity-v1',
  ok: true,
  commit_ref: commitRef,
  deploy_id: deployId,
  deploy_context: context,
  site_name: siteName,
  immutable_url: immutableUrl,
  moving_alias: deployPrimeUrl || null,
  generated_at_build: true,
  verification_contract: {
    commit_must_match_requesting_ci_sha: true,
    immutable_deploy_id_required: true,
    immutable_endpoint_recheck_required: true
  }
};

const outDir = resolve('web/public');
mkdirSync(outDir, { recursive: true });
writeFileSync(
  resolve(outDir, 'parable-deploy-identity.json'),
  JSON.stringify(payload, null, 2) + '\n',
  'utf8'
);

console.log(
  `PARABLE deploy identity written for commit ${commitRef.slice(0, 12)} deploy ${deployId}`
);
