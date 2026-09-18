import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errors = new Rate('parable_queue_errors');
const base = (__ENV.PARABLE_BASE || 'https://deploy-preview-1--parable-studio.netlify.app').replace(/\/$/, '');

export const options = {
  scenarios: {
    queue_canary: {
      executor: 'shared-iterations',
      vus: Number(__ENV.PARABLE_QUEUE_VUS || 20),
      iterations: Number(__ENV.PARABLE_QUEUE_ITERATIONS || 80),
      maxDuration: '120s'
    }
  },
  thresholds: {
    parable_queue_errors: ['rate<0.02'],
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<2500', 'p(99)<5000']
  }
};

export default function () {
  const unique = __VU + '-' + __ITER + '-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
  const payload = {
    kind: 'scale-noop',
    payload: {
      projectId: 'scale_canary_' + (__VU % 10),
      request: unique
    }
  };

  const response = http.post(base + '/api/jobs', JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'scale-canary-' + unique,
      'x-parable-load-test': 'queue-canary-v1'
    },
    timeout: '10s'
  });

  const ok = check(response, {
    'queue request accepted': (r) => r.status === 202 || r.status === 200,
    'durable job returned': (r) => {
      try { return Boolean(JSON.parse(r.body)?.job?.id); } catch { return false; }
    }
  });

  errors.add(!ok);
  sleep(0.05);
}
