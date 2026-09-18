-- PARABLE Transactional Hot State V1
-- PostgreSQL/Supabase production-safety layer.
--
-- Design:
--   PostgreSQL = authoritative mutable project revision / spending state.
--   Netlify Blobs = immutable artifacts, snapshots and operational mirrors.
--   Runtime access = narrow HMAC-signed RPC; no service-role key in the browser.
--
-- IMPORTANT:
--   Do NOT store PARABLE_STATE_RPC_SECRET in source control.
--   Provision it out of band into parable_private.runtime_secrets and into the
--   Netlify secret environment variable PARABLE_STATE_RPC_SECRET.

create extension if not exists pgcrypto with schema extensions;

create table if not exists project_revisions (
  project_id text primary key,
  revision bigint not null default 0 check (revision >= 0),
  state_refs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists project_mutation_events (
  id text primary key,
  project_id text not null,
  parent_revision bigint not null,
  revision bigint not null,
  mutation_type text not null,
  actor_user_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(project_id, revision)
);
create index if not exists project_mutation_events_project_idx
  on project_mutation_events(project_id, revision desc);

create table if not exists provider_transactions (
  id text primary key,
  project_id text not null,
  operation_type text not null,
  operation_id text not null,
  provider text not null,
  model text not null,
  request_hash text not null,
  state text not null check(state in (
    'planned','submitting','acknowledged','processing',
    'settled','failed','ambiguous','cancelled'
  )),
  provider_request_id text,
  provider_status_url text,
  provider_response_url text,
  submission_started_at timestamptz,
  acknowledged_at timestamptz,
  settled_at timestamptz,
  ambiguous_at timestamptz,
  failed_at timestamptz,
  failure_class text,
  failure_detail text,
  estimated_cost_usd numeric(18,6),
  actual_cost_usd numeric(18,6),
  submission_attempts integer not null default 0 check(submission_attempts >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, operation_type, operation_id),
  unique(provider, provider_request_id)
);
create index if not exists provider_transactions_project_state_idx
  on provider_transactions(project_id, state, updated_at desc);

create table if not exists spend_ledger (
  id bigserial primary key,
  project_id text not null,
  provider_transaction_id text references provider_transactions(id) on delete set null,
  operation_type text not null,
  estimated_cost_usd numeric(18,6),
  actual_cost_usd numeric(18,6),
  currency text not null default 'USD',
  state text not null check(state in ('reserved','settled','released','ambiguous')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists spend_ledger_project_idx
  on spend_ledger(project_id, created_at desc);
create unique index if not exists spend_ledger_provider_transaction_unique
  on spend_ledger(provider_transaction_id)
  where provider_transaction_id is not null;

create table if not exists rights_provenance (
  project_id text not null,
  asset_sha256 text not null check(asset_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null check(status in ('approved','unverified','restricted','revoked')),
  basis text not null check(basis in ('owned','licensed','consent','generated','public-domain','unknown')),
  rights_holder text,
  likeness_permission boolean not null default false,
  voice_permission boolean not null default false,
  ai_generation_permission boolean not null default false,
  commercial_use boolean not null default false,
  territories jsonb not null default '[]'::jsonb,
  expires_at timestamptz,
  evidence_sha256 text,
  evidence_note text,
  declared_by_actor_id text not null,
  declared_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text,
  updated_at timestamptz not null default now(),
  primary key(project_id, asset_sha256)
);

create or replace function parable_commit_project_mutation(
  p_project_id text,
  p_expected_revision bigint,
  p_event_id text,
  p_mutation_type text,
  p_actor_user_id text,
  p_metadata jsonb default '{}'::jsonb,
  p_state_patch jsonb default '{}'::jsonb
) returns table(revision bigint, state_refs jsonb)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_revision bigint;
  v_state_refs jsonb;
  v_key text;
  v_value jsonb;
begin
  insert into project_revisions(project_id,revision,state_refs)
  values(p_project_id,0,'{}'::jsonb)
  on conflict(project_id) do nothing;

  select pr.revision,pr.state_refs
    into v_revision,v_state_refs
  from project_revisions pr
  where pr.project_id=p_project_id
  for update;

  if v_revision <> p_expected_revision then
    raise exception using
      errcode='40001',
      message='PROJECT_REVISION_CONFLICT',
      detail=json_build_object(
        'project_id',p_project_id,
        'expected_revision',p_expected_revision,
        'current_revision',v_revision
      )::text;
  end if;

  insert into project_mutation_events(
    id,project_id,parent_revision,revision,mutation_type,actor_user_id,metadata
  ) values(
    p_event_id,p_project_id,v_revision,v_revision+1,p_mutation_type,p_actor_user_id,
    coalesce(p_metadata,'{}'::jsonb)
  );

  v_state_refs := coalesce(v_state_refs,'{}'::jsonb);
  for v_key,v_value in select key,value from jsonb_each(coalesce(p_state_patch,'{}'::jsonb))
  loop
    if v_value = 'null'::jsonb then
      v_state_refs := v_state_refs - v_key;
    else
      v_state_refs := jsonb_set(v_state_refs,array[v_key],v_value,true);
    end if;
  end loop;

  update project_revisions
  set revision=v_revision+1,
      state_refs=v_state_refs,
      updated_at=now()
  where project_id=p_project_id
  returning project_revisions.revision,project_revisions.state_refs
  into revision,state_refs;

  return next;
end;
$$;

create or replace function parable_transition_provider_transaction(
  p_id text,
  p_from_states text[],
  p_to_state text,
  p_provider_request_id text default null,
  p_failure_class text default null,
  p_failure_detail text default null,
  p_actual_cost_usd numeric default null
) returns provider_transactions
language plpgsql
security invoker
set search_path=public
as $$
declare
  v provider_transactions;
begin
  select * into v from provider_transactions where id=p_id for update;
  if not found then
    raise exception using errcode='P0002',message='PROVIDER_TRANSACTION_NOT_FOUND';
  end if;

  if not (v.state = any(p_from_states)) then
    raise exception using
      errcode='40001',
      message='PROVIDER_TRANSACTION_STATE_CONFLICT',
      detail=json_build_object(
        'id',p_id,'current_state',v.state,'allowed_from',p_from_states
      )::text;
  end if;

  update provider_transactions
  set state=p_to_state,
      provider_request_id=coalesce(p_provider_request_id,provider_request_id),
      failure_class=coalesce(p_failure_class,failure_class),
      failure_detail=coalesce(p_failure_detail,failure_detail),
      actual_cost_usd=coalesce(p_actual_cost_usd,actual_cost_usd),
      submission_started_at=case when p_to_state='submitting' then coalesce(submission_started_at,now()) else submission_started_at end,
      acknowledged_at=case when p_to_state='acknowledged' then coalesce(acknowledged_at,now()) else acknowledged_at end,
      settled_at=case when p_to_state='settled' then coalesce(settled_at,now()) else settled_at end,
      ambiguous_at=case when p_to_state='ambiguous' then coalesce(ambiguous_at,now()) else ambiguous_at end,
      failed_at=case when p_to_state='failed' then coalesce(failed_at,now()) else failed_at end,
      submission_attempts=submission_attempts+case when p_to_state='submitting' then 1 else 0 end,
      updated_at=now()
  where id=p_id
  returning * into v;

  return v;
end;
$$;

create schema if not exists parable_private;
revoke all on schema parable_private from public;

create table if not exists parable_private.runtime_secrets (
  key_id text primary key,
  secret text not null check(length(secret)>=48),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

create table if not exists parable_private.runtime_nonces (
  nonce text primary key,
  used_at timestamptz not null default now()
);
create index if not exists runtime_nonces_used_idx
  on parable_private.runtime_nonces(used_at);

create or replace function parable_private.runtime_dispatch(
  p_action text,
  p_timestamp_ms bigint,
  p_nonce text,
  p_payload_text text,
  p_signature text
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,parable_private,extensions
as $$
declare
  v_secret text;
  v_message text;
  v_expected text;
  v_now_ms bigint;
  v_payload jsonb;
  v_project_id text;
  v_revision bigint;
  v_state_refs jsonb;
  v_event_id text;
  v_tx public.provider_transactions;
  v_from_states text[];
  v_estimated numeric;
  v_actual numeric;
begin
  if p_action is null or p_action !~ '^[a-z_]{2,80}$' then
    raise exception using errcode='22023',message='RUNTIME_ACTION_INVALID';
  end if;
  if p_nonce is null or p_nonce !~ '^[A-Za-z0-9_-]{24,160}$' then
    raise exception using errcode='22023',message='RUNTIME_NONCE_INVALID';
  end if;
  if p_signature is null or p_signature !~ '^[a-f0-9]{64}$' then
    raise exception using errcode='22023',message='RUNTIME_SIGNATURE_INVALID';
  end if;
  if p_payload_text is null or octet_length(p_payload_text)>2097152 then
    raise exception using errcode='22023',message='RUNTIME_PAYLOAD_INVALID';
  end if;

  v_now_ms:=floor(extract(epoch from clock_timestamp())*1000);
  if abs(v_now_ms-p_timestamp_ms)>60000 then
    raise exception using errcode='28000',message='RUNTIME_REQUEST_EXPIRED';
  end if;

  select secret into v_secret
  from parable_private.runtime_secrets
  where active=true
  order by created_at desc
  limit 1;

  if v_secret is null then
    raise exception using errcode='55000',message='RUNTIME_SECRET_NOT_CONFIGURED';
  end if;

  v_message:=p_action||E'\n'||p_timestamp_ms::text||E'\n'||p_nonce||E'\n'||p_payload_text;
  v_expected:=encode(extensions.hmac(v_message,v_secret,'sha256'),'hex');

  if v_expected<>lower(p_signature) then
    raise exception using errcode='28000',message='RUNTIME_SIGNATURE_MISMATCH';
  end if;

  begin
    insert into parable_private.runtime_nonces(nonce) values(p_nonce);
  exception when unique_violation then
    raise exception using errcode='28000',message='RUNTIME_REPLAY_REJECTED';
  end;

  if random()<0.02 then
    delete from parable_private.runtime_nonces
    where used_at<now()-interval '15 minutes';
  end if;

  begin
    v_payload:=p_payload_text::jsonb;
  exception when others then
    raise exception using errcode='22023',message='RUNTIME_PAYLOAD_JSON_INVALID';
  end;

  if jsonb_typeof(v_payload)<>'object' then
    raise exception using errcode='22023',message='RUNTIME_PAYLOAD_OBJECT_REQUIRED';
  end if;

  if p_action='health' then
    return jsonb_build_object(
      'ok',true,
      'engine','parable-postgres-hot-state-v1',
      'database_time',clock_timestamp(),
      'transactional',true,
      'replay_protection',true
    );
  end if;

  v_project_id:=v_payload->>'project_id';
  if v_project_id is null or v_project_id !~ '^[A-Za-z0-9_.:-]{1,220}$' then
    raise exception using errcode='22023',message='RUNTIME_PROJECT_ID_INVALID';
  end if;

  if p_action='read_project_state' then
    select revision,state_refs
      into v_revision,v_state_refs
    from public.project_revisions
    where project_id=v_project_id;

    if not found then
      return jsonb_build_object(
        'exists',false,'project_id',v_project_id,'revision',0,
        'state_refs','{}'::jsonb,'updated_at',null
      );
    end if;

    return jsonb_build_object(
      'exists',true,
      'project_id',v_project_id,
      'revision',v_revision,
      'state_refs',coalesce(v_state_refs,'{}'::jsonb),
      'updated_at',(select updated_at from public.project_revisions where project_id=v_project_id)
    );
  end if;

  if p_action='bootstrap_project_state' then
    v_revision:=greatest(0,coalesce((v_payload->>'revision')::bigint,0));
    v_state_refs:=coalesce(v_payload->'state_refs','{}'::jsonb);

    if jsonb_typeof(v_state_refs)<>'object' then
      raise exception using errcode='22023',message='RUNTIME_STATE_REFS_OBJECT_REQUIRED';
    end if;

    insert into public.project_revisions(project_id,revision,state_refs)
    values(v_project_id,v_revision,v_state_refs)
    on conflict(project_id) do nothing;

    select revision,state_refs
      into v_revision,v_state_refs
    from public.project_revisions
    where project_id=v_project_id;

    return jsonb_build_object(
      'exists',true,'project_id',v_project_id,'revision',v_revision,
      'state_refs',coalesce(v_state_refs,'{}'::jsonb)
    );
  end if;

  if p_action='commit_project_mutation' then
    v_event_id:=v_payload->>'event_id';

    select r.revision,r.state_refs
      into v_revision,v_state_refs
    from public.parable_commit_project_mutation(
      v_project_id,
      (v_payload->>'expected_revision')::bigint,
      v_event_id,
      coalesce(v_payload->>'mutation_type','mutation'),
      nullif(v_payload->>'actor_user_id',''),
      coalesce(v_payload->'metadata','{}'::jsonb),
      coalesce(v_payload->'state_patch','{}'::jsonb)
    ) as r;

    return jsonb_build_object(
      'project_id',v_project_id,'revision',v_revision,
      'state_refs',coalesce(v_state_refs,'{}'::jsonb),
      'event_id',v_event_id
    );
  end if;

  if p_action='ensure_provider_transaction' then
    v_estimated:=nullif(v_payload->>'estimated_cost_usd','')::numeric;

    insert into public.provider_transactions(
      id,project_id,operation_type,operation_id,provider,model,
      request_hash,state,estimated_cost_usd
    ) values(
      v_payload->>'id',v_project_id,v_payload->>'operation_type',
      v_payload->>'operation_id',v_payload->>'provider',v_payload->>'model',
      v_payload->>'request_hash','planned',v_estimated
    )
    on conflict(project_id,operation_type,operation_id) do nothing;

    select * into v_tx
    from public.provider_transactions
    where project_id=v_project_id
      and operation_type=v_payload->>'operation_type'
      and operation_id=v_payload->>'operation_id';

    if v_tx.request_hash<>v_payload->>'request_hash'
       or v_tx.provider<>v_payload->>'provider'
       or v_tx.model<>v_payload->>'model'
       or v_tx.id<>v_payload->>'id' then
      raise exception using errcode='40001',message='PROVIDER_TRANSACTION_REQUEST_CONFLICT';
    end if;

    insert into public.spend_ledger(
      project_id,provider_transaction_id,operation_type,estimated_cost_usd,state
    ) values(
      v_project_id,v_tx.id,v_tx.operation_type,v_tx.estimated_cost_usd,'reserved'
    )
    on conflict(provider_transaction_id)
    where provider_transaction_id is not null
    do nothing;

    return to_jsonb(v_tx);
  end if;

  if p_action='read_provider_transaction' then
    select * into v_tx
    from public.provider_transactions
    where id=v_payload->>'id' and project_id=v_project_id;

    if not found then return null; end if;
    return to_jsonb(v_tx);
  end if;

  if p_action='transition_provider_transaction' then
    select array_agg(value)
      into v_from_states
    from jsonb_array_elements_text(
      coalesce(v_payload->'from_states','[]'::jsonb)
    ) as t(value);

    if coalesce(array_length(v_from_states,1),0)=0 then
      raise exception using errcode='22023',message='PROVIDER_TRANSACTION_FROM_STATES_REQUIRED';
    end if;

    v_actual:=nullif(v_payload->>'actual_cost_usd','')::numeric;

    select * into v_tx
    from public.parable_transition_provider_transaction(
      v_payload->>'id',
      v_from_states,
      v_payload->>'to_state',
      nullif(v_payload->>'provider_request_id',''),
      nullif(v_payload->>'failure_class',''),
      nullif(v_payload->>'failure_detail',''),
      v_actual
    );

    if v_tx.project_id<>v_project_id then
      raise exception using errcode='42501',message='PROVIDER_TRANSACTION_PROJECT_MISMATCH';
    end if;

    if v_tx.state='settled' then
      update public.spend_ledger
      set state='settled',
          actual_cost_usd=coalesce(v_tx.actual_cost_usd,actual_cost_usd),
          settled_at=coalesce(settled_at,now())
      where provider_transaction_id=v_tx.id;
    elsif v_tx.state='ambiguous' then
      update public.spend_ledger
      set state='ambiguous'
      where provider_transaction_id=v_tx.id;
    elsif v_tx.state in ('failed','cancelled') then
      update public.spend_ledger
      set state='released'
      where provider_transaction_id=v_tx.id;
    end if;

    return to_jsonb(v_tx);
  end if;

  raise exception using errcode='22023',message='RUNTIME_ACTION_UNSUPPORTED';
end;
$$;

create or replace function public.parable_runtime_rpc(
  p_action text,
  p_timestamp_ms bigint,
  p_nonce text,
  p_payload_text text,
  p_signature text
) returns jsonb
language sql
security invoker
set search_path=pg_catalog,public,parable_private
as $$
  select parable_private.runtime_dispatch(
    p_action,p_timestamp_ms,p_nonce,p_payload_text,p_signature
  );
$$;

revoke all on function public.parable_runtime_rpc(text,bigint,text,text,text)
from public,authenticated;
grant execute on function public.parable_runtime_rpc(text,bigint,text,text,text)
to anon;

grant usage on schema parable_private to anon;
revoke all on all tables in schema parable_private from anon,authenticated;
revoke all on all sequences in schema parable_private from anon,authenticated;
revoke execute on all functions in schema parable_private from public,authenticated;
grant execute on function parable_private.runtime_dispatch(text,bigint,text,text,text)
to anon;

-- Hot-state tables remain server-owned and inaccessible directly from browsers.
do $$
declare t text;
begin
  foreach t in array array[
    'project_revisions','project_mutation_events','provider_transactions',
    'spend_ledger','rights_provenance'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from anon,authenticated',t);
    execute format('grant select,insert,update,delete on table public.%I to service_role',t);
  end loop;
end $$;
