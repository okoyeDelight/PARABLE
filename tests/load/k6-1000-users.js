import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errors = new Rate('parable_errors');
const latency = new Trend('parable_latency', true);
const base = (__ENV.PARABLE_BASE || 'https://deploy-preview-1--parable-studio.netlify.app').replace(/\/$/, '');

export const options = {
  scenarios: {
    thousand_users: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 50 },
        { duration: '30s', target: 200 },
        { duration: '40s', target: 500 },
        { duration: '60s', target: 1000 },
        { duration: '60s', target: 1000 },
        { duration: '30s', target: 0 }
      ],
      gracefulRampDown: '20s'
    }
  },
  thresholds: {
    parable_errors: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000']
  }
};

const endpoints = [
  '/api/ai-status',
  '/api/ai-health',
  '/api/projects?id=proj_the_altar',
  '/api/projects?id=proj_before_i_said_yes',
  '/api/projects?id=proj_the_watchman'
];

export default function () {
  const path = endpoints[Math.floor(Math.random() * endpoints.length)];
  const response = http.get(base + path, {
    tags: { endpoint: path },
    headers: { 'x-parable-load-test': 'read-tier-v1' },
    timeout: '10s'
  });

  latency.add(response.timings.duration);
  const ok = check(response, {
    'status is successful': (r) => r.status >= 200 && r.status < 400,
    'body is non-empty': (r) => Boolean(r.body && r.body.length)
  });
  errors.add(!ok);
  sleep(Math.random() * 1.5 + 0.25);
}
