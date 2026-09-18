import assert from 'node:assert/strict';
import { composeHiggsfieldCredentials } from '../netlify/functions/_lib/higgsfield-credentials.mts';

assert.equal(
  composeHiggsfieldCredentials({ combined: 'id1:secret1' }),
  'id1:secret1'
);

assert.equal(
  composeHiggsfieldCredentials({ keyId: 'id2', keySecret: 'secret2' }),
  'id2:secret2'
);

assert.equal(
  composeHiggsfieldCredentials({ keyId: 'id-only', keySecret: '' }),
  ''
);

assert.equal(
  composeHiggsfieldCredentials({ combined: 'badcombined', keyId: 'id3', keySecret: 'secret3' }),
  'id3:secret3'
);

console.log('PARABLE_HIGGSFIELD_CREDENTIALS_SMOKE_PASS');
