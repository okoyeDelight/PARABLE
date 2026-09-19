import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

const errors = new Rate('parable_read_errors');
const base = (__ENV.PARABLE_BASE || 'https://deploy-preview-1--parable-studio.netlify.app').replace(/\/$/, '');

export const options = {
  scenarios: {
    read_canary: {
      executor: 'shared-iterations',
      vus: Number(__ENV.PARABLE_READ_VUS || 120),
      iterations: Number(__ENV.PARABLE_READ_ITERATIONS || 1200),
      maxDuration: '90s'
    }
  },
  thresholds: {
    parable_read_errors: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000']
  }
};

export default function () {
  const response = http.get(base + '/api/scale-probe', {
    headers: { 'x-parable-load-test': 'read-canary-v1' },
    timeout: '10s'
  });

  const ok = check(response, {
    'read probe accepted': (r) => r.status === 200,
    'read probe healthy': (r) => {
      try { return JSON.parse(r.body)?.ok === true; } catch { return false; }
    }
  });

  errors.add(!ok);
}
