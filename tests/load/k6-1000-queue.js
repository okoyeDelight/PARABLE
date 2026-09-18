import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errors=new Rate('queue_errors');
const base=(__ENV.PARABLE_BASE||'https://deploy-preview-1--parable-studio.netlify.app').replace(/\/$/,'');

export const options={
  scenarios:{
    durable_queue:{
      executor:'ramping-vus',
      startVUs:0,
      stages:[
        {duration:'20s',target:100},
        {duration:'30s',target:500},
        {duration:'45s',target:1000},
        {duration:'45s',target:1000},
        {duration:'20s',target:0}
      ],
      gracefulRampDown:'15s'
    }
  },
  thresholds:{
    queue_errors:['rate<0.01'],
    http_req_failed:['rate<0.01'],
    http_req_duration:['p(95)<2000','p(99)<4000']
  }
};

export default function(){
  const unique=__VU+'-'+__ITER+'-'+Date.now();
  const payload={
    kind:'scale-noop',
    payload:{projectId:'scale_probe',request:unique}
  };
  const response=http.post(base+'/api/jobs',JSON.stringify(payload),{
    headers:{
      'content-type':'application/json',
      'idempotency-key':'scale-'+unique,
      'x-parable-load-test':'queue-v1'
    },
    timeout:'10s'
  });
  const ok=check(response,{
    'queue accepted':r=>r.status===202||r.status===200,
    'job returned':r=>{try{return Boolean(JSON.parse(r.body)?.job?.id)}catch{return false}}
  });
  errors.add(!ok);
  sleep(Math.random()*1.2+0.2);
}
