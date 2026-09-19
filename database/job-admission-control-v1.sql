-- PARABLE Job Admission Control V1
-- Applied after transactional-hot-state-v2.sql.
-- Durable queues accept bursts while PostgreSQL limits concurrently executing
-- workers globally per deploy/production namespace and fairly per project.
--
-- Admission locks use pg_try_advisory_xact_lock so contention fails fast into
-- durable retry/backpressure instead of consuming serverless time waiting.

create index if not exists durable_jobs_active_lease_idx
  on public.durable_jobs(status, lease_expires_at)
  where status='processing';

create index if not exists durable_jobs_project_active_lease_idx
  on public.durable_jobs(project_id, status, lease_expires_at)
  where status='processing';

CREATE OR REPLACE FUNCTION parable_private.runtime_dispatch(p_action text, p_timestamp_ms bigint, p_nonce text, p_payload_text text, p_signature text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'parable_private', 'extensions', 'vault'
AS $function$
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
  v_assertion jsonb;
  v_rights public.rights_provenance;

  v_job public.durable_jobs;
  v_job_created boolean:=false;
  v_lease_ms integer;
  v_target_status text;
  v_error text;
  v_global_active integer;
  v_project_active integer;
  v_max_global integer;
  v_max_project integer;
  v_capacity_scope text;

  v_existing_rights public.rights_provenance;
  v_action text;
  v_reason text;
  v_actor text;
begin
  perform set_config('lock_timeout','2000',true);
  perform set_config('statement_timeout','7000',true);

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

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name='parable_runtime_rpc_hmac_v1'
  order by updated_at desc
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
    insert into public.runtime_request_nonces(nonce) values(p_nonce);
  exception when unique_violation then
    raise exception using errcode='28000',message='RUNTIME_REPLAY_REJECTED';
  end;

  if random()<0.02 then
    delete from public.runtime_request_nonces
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
      'engine','parable-postgres-hot-state-v3',
      'database_time',clock_timestamp(),
      'transactional',true,
      'replay_protection',true,
      'vault_backed_signing',true,
      'job_leases','postgres',
      'rights_authority','postgres',
      'admission_control','postgres'
    );
  end if;

  if p_action='job_capacity' then
    v_project_id:=v_payload->>'scope_project_id';
    if v_project_id is null or v_project_id !~ '^[A-Za-z0-9_.:-]{1,220}$' then
      raise exception using errcode='22023',message='RUNTIME_CAPACITY_SCOPE_INVALID';
    end if;

    v_capacity_scope:=case
      when v_project_id like 'preview:%:%'
        then 'preview:'||split_part(v_project_id,':',2)
      else split_part(v_project_id,':',1)
    end;

    update public.durable_jobs
    set status='retrying',
        lease_token=null,
        lease_expires_at=null,
        last_error=coalesce(last_error,'Recovered from expired worker lease.'),
        updated_at=clock_timestamp()
    where status='processing'
      and lease_expires_at is not null
      and lease_expires_at<=clock_timestamp()
      and (
        (v_capacity_scope like 'preview:%' and project_id like v_capacity_scope||':%')
        or
        (v_capacity_scope='prod' and project_id like 'prod:%')
      );

    select count(*) into v_global_active
    from public.durable_jobs
    where status='processing'
      and lease_expires_at>clock_timestamp()
      and (
        (v_capacity_scope like 'preview:%' and project_id like v_capacity_scope||':%')
        or
        (v_capacity_scope='prod' and project_id like 'prod:%')
      );

    return jsonb_build_object(
      'scope',v_capacity_scope,
      'active_processing',v_global_active,
      'queued',(select count(*) from public.durable_jobs where status='queued' and (
        (v_capacity_scope like 'preview:%' and project_id like v_capacity_scope||':%')
        or (v_capacity_scope='prod' and project_id like 'prod:%')
      )),
      'retrying',(select count(*) from public.durable_jobs where status='retrying' and (
        (v_capacity_scope like 'preview:%' and project_id like v_capacity_scope||':%')
        or (v_capacity_scope='prod' and project_id like 'prod:%')
      )),
      'failed',(select count(*) from public.durable_jobs where status='failed' and (
        (v_capacity_scope like 'preview:%' and project_id like v_capacity_scope||':%')
        or (v_capacity_scope='prod' and project_id like 'prod:%')
      )),
      'succeeded',(select count(*) from public.durable_jobs where status='succeeded' and (
        (v_capacity_scope like 'preview:%' and project_id like v_capacity_scope||':%')
        or (v_capacity_scope='prod' and project_id like 'prod:%')
      )),
      'at',clock_timestamp()
    );
  end if;

  if p_action='read_job' then
    select * into v_job from public.durable_jobs where id=v_payload->>'id';
    if not found then return null; end if;
    return to_jsonb(v_job);
  end if;

  if p_action='claim_job' then
    select * into v_job
    from public.durable_jobs
    where id=v_payload->>'id'
    for update;

    if not found then return null; end if;

    if v_job.status in ('succeeded','failed','cancelled') then
      return jsonb_build_object('claimed',false,'job',to_jsonb(v_job),'reason','terminal');
    end if;

    if v_job.status='processing'
       and v_job.lease_expires_at is not null
       and v_job.lease_expires_at>clock_timestamp() then
      return jsonb_build_object('claimed',false,'job',to_jsonb(v_job),'reason','active-lease');
    end if;

    v_capacity_scope:=case
      when v_job.project_id like 'preview:%:%'
        then 'preview:'||split_part(v_job.project_id,':',2)
      else split_part(v_job.project_id,':',1)
    end;

    if not pg_try_advisory_xact_lock(hashtextextended('parable:jobs:global:'||v_capacity_scope,0)) then
      return jsonb_build_object(
        'claimed',false,
        'job',to_jsonb(v_job),
        'reason','admission-busy',
        'retry_after_ms',250
      );
    end if;

    if not pg_try_advisory_xact_lock(hashtextextended('parable:jobs:project:'||v_job.project_id,0)) then
      return jsonb_build_object(
        'claimed',false,
        'job',to_jsonb(v_job),
        'reason','admission-busy',
        'retry_after_ms',250
      );
    end if;

    update public.durable_jobs
    set status='retrying',
        lease_token=null,
        lease_expires_at=null,
        last_error=coalesce(last_error,'Recovered from expired worker lease.'),
        updated_at=clock_timestamp()
    where status='processing'
      and lease_expires_at is not null
      and lease_expires_at<=clock_timestamp()
      and (
        (v_capacity_scope like 'preview:%' and project_id like v_capacity_scope||':%')
        or
        (v_capacity_scope='prod' and project_id like 'prod:%')
      );

    v_max_global:=greatest(1,least(2000,coalesce((v_payload->>'max_global_active')::integer,250)));
    v_max_project:=greatest(1,least(100,coalesce((v_payload->>'max_project_active')::integer,8)));

    select count(*) into v_global_active
    from public.durable_jobs
    where status='processing'
      and lease_expires_at>clock_timestamp()
      and (
        (v_capacity_scope like 'preview:%' and project_id like v_capacity_scope||':%')
        or
        (v_capacity_scope='prod' and project_id like 'prod:%')
      );

    if v_global_active>=v_max_global then
      return jsonb_build_object(
        'claimed',false,
        'job',to_jsonb(v_job),
        'reason','capacity-global',
        'retry_after_ms',1500,
        'active',v_global_active,
        'limit',v_max_global
      );
    end if;

    select count(*) into v_project_active
    from public.durable_jobs
    where project_id=v_job.project_id
      and status='processing'
      and lease_expires_at>clock_timestamp();

    if v_project_active>=v_max_project then
      return jsonb_build_object(
        'claimed',false,
        'job',to_jsonb(v_job),
        'reason','capacity-project',
        'retry_after_ms',1200,
        'active',v_project_active,
        'limit',v_max_project
      );
    end if;

    v_lease_ms:=greatest(5000,least(300000,coalesce((v_payload->>'lease_ms')::integer,120000)));

    update public.durable_jobs
    set status='processing',
        attempts=greatest(attempts+1,coalesce((v_payload->>'attempt')::integer,1)),
        lease_token=v_payload->>'lease_token',
        lease_expires_at=clock_timestamp()+(v_lease_ms*interval '1 millisecond'),
        completed_at=null,
        updated_at=clock_timestamp()
    where id=v_job.id
    returning * into v_job;

    insert into public.durable_job_events(
      job_id,project_id,kind,status,attempts,lease_token,metadata
    ) values(
      v_job.id,v_job.project_id,v_job.kind,v_job.status,v_job.attempts,
      v_job.lease_token,
      jsonb_build_object(
        'event','lease-claimed',
        'global_active_before',v_global_active,
        'global_limit',v_max_global,
        'project_active_before',v_project_active,
        'project_limit',v_max_project
      )
    );

    return jsonb_build_object(
      'claimed',true,
      'job',to_jsonb(v_job),
      'reason','claimed',
      'active',v_global_active+1,
      'limit',v_max_global
    );
  end if;

  if p_action='transition_job' then
    select * into v_job
    from public.durable_jobs
    where id=v_payload->>'id'
    for update;

    if not found then return null; end if;

    v_target_status:=v_payload->>'to_status';
    if v_target_status not in ('queued','retrying','succeeded','failed','cancelled') then
      raise exception using errcode='22023',message='JOB_TARGET_STATUS_INVALID';
    end if;

    if v_job.status in ('succeeded','failed','cancelled') then
      return to_jsonb(v_job);
    end if;

    if v_job.status='processing' then
      if coalesce(v_payload->>'lease_token','')='' or v_job.lease_token<>v_payload->>'lease_token' then
        raise exception using errcode='P0001',message='JOB_LEASE_MISMATCH';
      end if;
    elsif v_target_status in ('retrying','succeeded') then
      raise exception using errcode='P0001',message='JOB_NOT_PROCESSING';
    end if;

    update public.durable_jobs
    set status=v_target_status,
        attempts=greatest(attempts,coalesce((v_payload->>'attempt')::integer,attempts)),
        last_error=case
          when v_target_status='succeeded' then null
          else coalesce(nullif(v_payload->>'last_error',''),last_error)
        end,
        result_ref=coalesce(nullif(v_payload->>'result_ref',''),result_ref),
        queue_event_id=coalesce(nullif(v_payload->>'queue_event_id',''),queue_event_id),
        completed_at=case
          when v_target_status in ('succeeded','failed','cancelled') then clock_timestamp()
          else null
        end,
        lease_token=null,
        lease_expires_at=null,
        updated_at=clock_timestamp()
    where id=v_job.id
    returning * into v_job;

    v_error:=lower(coalesce(v_job.last_error,''));
    insert into public.durable_job_events(
      job_id,project_id,kind,status,attempts,lease_token,error_class,metadata
    ) values(
      v_job.id,v_job.project_id,v_job.kind,v_job.status,v_job.attempts,null,
      case
        when v_error like '%rate limit%' or v_error like '%429%' then 'rate-limit'
        when v_error like '%timeout%' or v_error like '%abort%' then 'timeout'
        when v_error ~ '\m5[0-9][0-9]\M' then 'upstream-5xx'
        else case when v_error='' then null else 'other' end
      end,
      jsonb_build_object('event','transition')
    );

    return to_jsonb(v_job);
  end if;

  v_project_id:=v_payload->>'project_id';
  if v_project_id is null or v_project_id !~ '^[A-Za-z0-9_.:-]{1,220}$' then
    raise exception using errcode='22023',message='RUNTIME_PROJECT_ID_INVALID';
  end if;

  if p_action='read_project_state' then
    select revision,state_refs into v_revision,v_state_refs
    from public.project_revisions where project_id=v_project_id;
    if not found then
      return jsonb_build_object(
        'exists',false,'project_id',v_project_id,'revision',0,
        'state_refs','{}'::jsonb,'updated_at',null
      );
    end if;
    return jsonb_build_object(
      'exists',true,'project_id',v_project_id,'revision',v_revision,
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

    select revision,state_refs into v_revision,v_state_refs
    from public.project_revisions where project_id=v_project_id;

    return jsonb_build_object(
      'exists',true,'project_id',v_project_id,'revision',v_revision,
      'state_refs',coalesce(v_state_refs,'{}'::jsonb)
    );
  end if;

  if p_action='commit_project_mutation' then
    v_event_id:=v_payload->>'event_id';
    select r.revision,r.state_refs into v_revision,v_state_refs
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
      raise exception using errcode='P0001',message='PROVIDER_TRANSACTION_REQUEST_CONFLICT';
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
    select * into v_tx
    from public.provider_transactions
    where id=v_payload->>'id'
    for update;

    if not found then
      raise exception using errcode='P0002',message='PROVIDER_TRANSACTION_NOT_FOUND';
    end if;
    if v_tx.project_id<>v_project_id then
      raise exception using errcode='42501',message='PROVIDER_TRANSACTION_PROJECT_MISMATCH';
    end if;

    if v_payload->>'to_state'='submitting' then
      for v_assertion in
        select value
        from jsonb_array_elements(coalesce(v_payload->'rights_assertions','[]'::jsonb))
      loop
        select * into v_rights
        from public.rights_provenance
        where project_id=v_project_id
          and asset_sha256=v_assertion->>'asset_sha256'
        for share;

        if not found
           or v_rights.status<>'approved'
           or not v_rights.ai_generation_permission
           or (v_rights.expires_at is not null and v_rights.expires_at<=clock_timestamp())
           or (
             coalesce((v_assertion->>'rights_revision')::bigint,0)>0
             and v_rights.rights_revision<>(v_assertion->>'rights_revision')::bigint
           )
           or (
             coalesce((v_assertion->>'require_likeness')::boolean,false)
             and not v_rights.likeness_permission
             and v_rights.basis<>'generated'
           )
           or (
             coalesce((v_assertion->>'require_voice')::boolean,false)
             and not v_rights.voice_permission
             and v_rights.basis<>'generated'
           )
           or (
             coalesce((v_assertion->>'require_commercial')::boolean,false)
             and not v_rights.commercial_use
           )
        then
          raise exception using
            errcode='42501',
            message='RIGHTS_ASSERTION_FAILED',
            detail=jsonb_build_object(
              'asset_sha256',v_assertion->>'asset_sha256',
              'expected_revision',v_assertion->>'rights_revision'
            )::text;
        end if;
      end loop;
    end if;

    select array_agg(value) into v_from_states
    from jsonb_array_elements_text(coalesce(v_payload->'from_states','[]'::jsonb)) as t(value);

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

    update public.provider_transactions
    set provider_status_url=coalesce(nullif(v_payload->>'provider_status_url',''),provider_status_url),
        provider_response_url=coalesce(nullif(v_payload->>'provider_response_url',''),provider_response_url)
    where id=v_tx.id
    returning * into v_tx;

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

  if p_action='read_rights' then
    select * into v_rights
    from public.rights_provenance
    where project_id=v_project_id
      and asset_sha256=v_payload->>'asset_sha256';
    if not found then return null; end if;
    return to_jsonb(v_rights);
  end if;

  if p_action='upsert_rights' then
    if coalesce(v_payload->>'asset_sha256','') !~ '^[a-f0-9]{64}$' then
      raise exception using errcode='22023',message='RIGHTS_ASSET_HASH_INVALID';
    end if;

    select * into v_existing_rights
    from public.rights_provenance
    where project_id=v_project_id
      and asset_sha256=v_payload->>'asset_sha256'
    for update;

    if found and v_existing_rights.status='revoked'
       and coalesce(v_payload->>'status','unverified')<>'revoked' then
      raise exception using errcode='42501',message='RIGHTS_RESTORE_REQUIRES_EXPLICIT_WORKFLOW';
    end if;

    v_actor:=coalesce(nullif(v_payload->>'declared_by_actor_id',''),'system');
    v_action:=case when found then 'updated' else 'declared' end;

    insert into public.rights_provenance(
      project_id,asset_sha256,status,basis,rights_holder,
      likeness_permission,voice_permission,ai_generation_permission,commercial_use,
      territories,expires_at,evidence_sha256,evidence_note,
      declared_by_actor_id,declared_at,revoked_at,revoke_reason,updated_at,rights_revision
    ) values(
      v_project_id,
      v_payload->>'asset_sha256',
      coalesce(v_payload->>'status','unverified'),
      coalesce(v_payload->>'basis','unknown'),
      nullif(v_payload->>'rights_holder',''),
      coalesce((v_payload->>'likeness_permission')::boolean,false),
      coalesce((v_payload->>'voice_permission')::boolean,false),
      coalesce((v_payload->>'ai_generation_permission')::boolean,false),
      coalesce((v_payload->>'commercial_use')::boolean,false),
      coalesce(v_payload->'territories','[]'::jsonb),
      nullif(v_payload->>'expires_at','')::timestamptz,
      nullif(v_payload->>'evidence_sha256',''),
      nullif(v_payload->>'evidence_note',''),
      v_actor,
      coalesce(nullif(v_payload->>'declared_at','')::timestamptz,clock_timestamp()),
      case
        when coalesce(v_payload->>'status','unverified')='revoked'
        then coalesce(nullif(v_payload->>'revoked_at','')::timestamptz,clock_timestamp())
        else null
      end,
      nullif(v_payload->>'revoke_reason',''),
      clock_timestamp(),
      case when found then v_existing_rights.rights_revision+1 else 1 end
    )
    on conflict(project_id,asset_sha256)
    do update set
      status=excluded.status,
      basis=excluded.basis,
      rights_holder=excluded.rights_holder,
      likeness_permission=excluded.likeness_permission,
      voice_permission=excluded.voice_permission,
      ai_generation_permission=excluded.ai_generation_permission,
      commercial_use=excluded.commercial_use,
      territories=excluded.territories,
      expires_at=excluded.expires_at,
      evidence_sha256=excluded.evidence_sha256,
      evidence_note=excluded.evidence_note,
      declared_by_actor_id=excluded.declared_by_actor_id,
      declared_at=excluded.declared_at,
      revoked_at=excluded.revoked_at,
      revoke_reason=excluded.revoke_reason,
      updated_at=excluded.updated_at,
      rights_revision=excluded.rights_revision
    returning * into v_rights;

    insert into public.rights_events(
      project_id,asset_sha256,rights_revision,action,actor_id,reason,snapshot
    ) values(
      v_project_id,v_rights.asset_sha256,v_rights.rights_revision,
      v_action,v_actor,null,to_jsonb(v_rights)
    );

    return to_jsonb(v_rights);
  end if;

  if p_action='revoke_rights' then
    select * into v_rights
    from public.rights_provenance
    where project_id=v_project_id
      and asset_sha256=v_payload->>'asset_sha256'
    for update;

    if not found then return null; end if;
    if v_rights.status='revoked' then return to_jsonb(v_rights); end if;

    v_actor:=coalesce(nullif(v_payload->>'actor_id',''),'system');
    v_reason:=coalesce(nullif(v_payload->>'reason',''),'Rights revoked by PARABLE project administrator.');

    update public.rights_provenance
    set status='revoked',
        revoked_at=clock_timestamp(),
        revoke_reason=v_reason,
        updated_at=clock_timestamp(),
        rights_revision=rights_revision+1
    where project_id=v_project_id
      and asset_sha256=v_payload->>'asset_sha256'
    returning * into v_rights;

    insert into public.rights_events(
      project_id,asset_sha256,rights_revision,action,actor_id,reason,snapshot
    ) values(
      v_project_id,v_rights.asset_sha256,v_rights.rights_revision,
      'revoked',v_actor,v_reason,to_jsonb(v_rights)
    );

    return to_jsonb(v_rights);
  end if;

  if p_action='ensure_job' then
    select * into v_job
    from public.durable_jobs
    where id=v_payload->>'id';

    if found then
      if v_job.project_id<>v_project_id
         or v_job.kind<>v_payload->>'kind'
         or v_job.payload_hash<>v_payload->>'payload_hash' then
        raise exception using errcode='P0001',message='JOB_IDEMPOTENCY_CONFLICT';
      end if;
      return jsonb_build_object('job',to_jsonb(v_job),'created',false,'conflict',false);
    end if;

    begin
      insert into public.durable_jobs(
        id,kind,project_id,workspace_id,actor_user_id,auth_context,status,
        payload_hash,idempotency_key,attempts,last_error,result_ref,
        completed_at,lease_token,lease_expires_at,queue_event_id
      ) values(
        v_payload->>'id',
        v_payload->>'kind',
        v_project_id,
        nullif(v_payload->>'workspace_id',''),
        nullif(v_payload->>'actor_user_id',''),
        v_payload->'auth_context',
        'queued',
        v_payload->>'payload_hash',
        nullif(v_payload->>'idempotency_key',''),
        0,null,null,null,null,null,null
      )
      returning * into v_job;
      v_job_created:=true;
    exception when unique_violation then
      select * into v_job
      from public.durable_jobs
      where project_id=v_project_id
        and kind=v_payload->>'kind'
        and idempotency_key=nullif(v_payload->>'idempotency_key','');

      if not found or v_job.payload_hash<>v_payload->>'payload_hash' then
        raise exception using errcode='P0001',message='JOB_IDEMPOTENCY_CONFLICT';
      end if;
    end;

    if v_job_created then
      insert into public.durable_job_events(
        job_id,project_id,kind,status,attempts,metadata
      ) values(
        v_job.id,v_job.project_id,v_job.kind,v_job.status,v_job.attempts,
        jsonb_build_object('event','created')
      );
    end if;

    return jsonb_build_object(
      'job',to_jsonb(v_job),
      'created',v_job_created,
      'conflict',false
    );
  end if;

  raise exception using errcode='22023',message='RUNTIME_ACTION_UNSUPPORTED';
end;
$function$

