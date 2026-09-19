import assert from 'node:assert/strict';
import {
  evaluateRightsEnforcement,
  parseRightsEnforcementMode,
  referenceAllowedForRender
} from '../netlify/functions/_lib/rights-policy.mts';

assert.equal(parseRightsEnforcementMode('observe'), 'observe');
assert.equal(parseRightsEnforcementMode('STRICT'), 'strict');
assert.equal(parseRightsEnforcementMode('anything-else'), 'strict');

assert.equal(referenceAllowedForRender({
  rightsStatus: 'approved',
  approvedByHuman: true,
  mode: 'strict'
}), true);

assert.equal(referenceAllowedForRender({
  rightsStatus: 'unverified',
  approvedByHuman: true,
  mode: 'strict'
}), false);

assert.equal(referenceAllowedForRender({
  rightsStatus: 'unverified',
  approvedByHuman: true,
  mode: 'observe'
}), true);

assert.equal(referenceAllowedForRender({
  rightsStatus: 'restricted',
  approvedByHuman: true,
  mode: 'observe'
}), true);

assert.equal(referenceAllowedForRender({
  rightsStatus: 'revoked',
  approvedByHuman: true,
  mode: 'observe'
}), false);

assert.equal(referenceAllowedForRender({
  rightsStatus: 'approved',
  approvedByHuman: false,
  mode: 'observe'
}), false);

const observed = evaluateRightsEnforcement({
  rightsStatus: 'unverified',
  blockers: ['Likeness permission is required.'],
  mode: 'observe'
});
assert.equal(observed.allowed, true);
assert.equal(observed.muted, true);

const revoked = evaluateRightsEnforcement({
  rightsStatus: 'revoked',
  blockers: ['Rights status is not approved.'],
  mode: 'observe'
});
assert.equal(revoked.allowed, false);
assert.equal(revoked.explicitly_revoked, true);

console.log('PARABLE_RIGHTS_OBSERVE_MODE_SMOKE_PASS');
