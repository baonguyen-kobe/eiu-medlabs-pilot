import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";

export const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
export const jsonSql = (value) => `${sqlLiteral(JSON.stringify(value))}::jsonb`;

export function createS5Harness() {
  const project = process.env.SUPABASE_LOCAL_PROJECT_ID ?? "eiu-medlabs-pilot";
  assert.equal(
    project,
    "eiu-medlabs-pilot",
    "S5 fixtures are isolated pilot only",
  );
  const listed = spawnSync(
    "docker",
    [
      "ps",
      "--filter",
      `label=com.supabase.cli.project=${project}`,
      "--format",
      "{{.Names}}",
    ],
    { encoding: "utf8" },
  );
  const databases = (listed.stdout ?? "")
    .split(/\r?\n/)
    .filter((name) => name.startsWith("supabase_db_"));
  assert.equal(listed.status, 0, "Local Docker discovery must succeed");
  assert.equal(
    databases.length,
    1,
    "REFUSING_AMBIGUOUS_LOCAL_SUPABASE_DATABASE",
  );
  const nonce = crypto.randomBytes(6).toString("hex");
  const prefix = `e520${nonce.slice(0, 4)}-${nonce.slice(4, 8)}-${nonce.slice(8)}-0000-`;
  const id = (n) => `${prefix}${String(n).padStart(12, "0")}`;
  const actors = [id(1), id(2), id(3)];

  function start(sql, name = `s5_${nonce}_probe`, keepOpen = false) {
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        "-e",
        `PGAPPNAME=${name}`,
        databases[0],
        "psql",
        "-X",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-qAt",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    const completed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) resolve(output);
        else reject(new Error(`S5 psql exited ${code}: ${output}`));
      });
    });
    // A barrier failure must not cause an unhandled rejection before cleanup.
    completed.catch(() => {});
    child.stdin.write(
      "set statement_timeout='30s'; set lock_timeout='25s';\n" + sql + "\n",
    );
    if (!keepOpen) child.stdin.end();
    return { child, completed, output: () => output, name };
  }
  const run = (sql) => start(sql).completed;
  const actorSql = (actor) => `set local role authenticated;
    select set_config('request.jwt.claims',${jsonSql({ sub: actor, role: "authenticated" })}::text,true);`;
  const parse = (output) =>
    JSON.parse(output.split(/\r?\n/).findLast((line) => line.startsWith("{")));
  const read = async (actor, expression) =>
    parse(await run(`begin; ${actorSql(actor)} select ${expression}; commit;`));

  async function waitUntil(probe, description) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (await probe()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`S5 barrier timeout: ${description}`);
  }

  function commandSql(command) {
    return `begin;
      create function pg_temp.attempt() returns jsonb language plpgsql as $$
      declare result jsonb;
      begin
        result:=public.equipment_fulfillment_command(${sqlLiteral(command.operation)},
          ${sqlLiteral(command.requestId)}::uuid,${jsonSql(command.payload)},${sqlLiteral(command.retryKey)}::uuid);
        return jsonb_build_object('ok',true,'result',result);
      exception when others then
        return jsonb_build_object('ok',false,'code',sqlstate,'message',sqlerrm);
      end; $$;
      ${actorSql(command.actor ?? actors[2])}
      select pg_temp.attempt(); commit;`;
  }
  const command = async (args) => parse(await run(commandSql(args)));

  async function race(commands) {
    const tag = crypto.randomBytes(4).toString("hex");
    const blocker = start(
      `begin;
      select pg_advisory_xact_lock(hashtextextended('inventory:s1:writer',0));
      \\echo S5_BARRIER_READY`,
      `s5_${nonce}_${tag}_barrier`,
      true,
    );
    const contenders = [];
    try {
      await waitUntil(
        () => blocker.output().includes("S5_BARRIER_READY"),
        "writer acquired",
      );
      for (const [index, args] of commands.entries()) {
        contenders.push(start(commandSql(args), `s5_${nonce}_${tag}_${index}`));
      }
      // Both commands are actually executing, not merely scheduled JS promises.
      await waitUntil(async () => {
        const names = contenders.map(({ name }) => sqlLiteral(name)).join(",");
        const waiting = await run(`select count(*) from pg_stat_activity
          where application_name in (${names}) and wait_event_type='Lock' and wait_event='advisory';`);
        return Number(waiting.trim()) === commands.length;
      }, "all contenders waiting on the shared writer");
      blocker.child.stdin.end("commit;\n");
      await blocker.completed;
      return (
        await Promise.all(contenders.map(({ completed }) => completed))
      ).map(parse);
    } finally {
      if (!blocker.child.stdin.writableEnded)
        blocker.child.stdin.end("rollback;\n");
      await Promise.allSettled([
        blocker.completed,
        ...contenders.map(({ completed }) => completed),
      ]);
    }
  }

  async function setup() {
    const output = await run(`begin;
      insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
      select x, 's5-${nonce}-'||n||'@campus.local','{"preapproved":true}'::jsonb,
        jsonb_build_object('full_name','S5 synthetic actor '||n)
      from unnest(array[${actors.map(sqlLiteral).join(",")}]::uuid[]) with ordinality as a(x,n);
      insert into public.profiles(id,email,full_name,phone,is_active)
      select id,email,'S5 synthetic actor','0901234567',true from auth.users where id in (${actors.map(sqlLiteral).join(",")})
      on conflict(id) do update set phone=excluded.phone,is_active=true;
      insert into public.user_roles(user_id,role) values
        ('${actors[0]}','admin'),('${actors[1]}','lecturer'),('${actors[2]}','staff');
      insert into public.profile_room_types(profile_id,room_type_id)
      values('${actors[2]}','40000000-0000-0000-0000-000000000001') on conflict do nothing;
      select set_config('request.jwt.claims',${jsonSql({ sub: actors[0], role: "authenticated" })}::text,true);
      insert into public.rooms(id,room_code,building_code,room_type_id)
      values('${id(10)}','S5-${nonce}','S5-${nonce}','40000000-0000-0000-0000-000000000001');
      insert into public.courses(id,course_code,course_name) values('${id(11)}','S5-${nonce}','S5 race course');
      insert into public.class_schedules(id,course_id,course_code_snapshot,course_name_snapshot,room_id,lecturer_id,
        schedule_date,start_time,end_time,semester,created_by,source,schedule_status,student_count,published_by,published_at)
      select ('${prefix}'||lpad(n::text,12,'0'))::uuid,'${id(11)}','S5-${nonce}','S5 race course','${id(10)}','${actors[1]}',
        current_date+60+n,'09:00','11:00','HK1','${actors[0]}','manual','published',20,'${actors[0]}',now()
      from generate_series(101,105) n;
      insert into public.equipment_catalog(id,item_name,commercial_name,unit) values
        ('${id(20)}','S5-${nonce} liquid','S5-${nonce} liquid demand','liều'),
        ('${id(21)}','S5-${nonce} asset','S5-${nonce} asset demand','cái');
      insert into public.inventory_categories(id,code,name) values('${id(30)}','S5-${nonce}','Synthetic S5');
      insert into public.inventory_uoms(code,name,dimension,allowed_scale) values
        ('s5_${nonce}_ml','S5 volume','volume',6),('s5_${nonce}_count','S5 count','count',0);
      insert into public.inventory_catalog_items(id,code,name,category_id,material_kind,base_uom_code,tracking_strategy,return_semantics,expiry_required) values
        ('${id(31)}','S5-${nonce}-Q','Synthetic S5 liquid','${id(30)}','other','s5_${nonce}_ml','quantity','nonreturnable',false),
        ('${id(32)}','S5-${nonce}-A','Synthetic S5 asset','${id(30)}','other','s5_${nonce}_count','serialized','returnable',false);
      insert into public.inventory_storage_locations(id,code,name) values
        ('${id(41)}','S5-${nonce}-BOOT','000 S5-${nonce} bootstrap'),
        ('${id(42)}','S5-${nonce}-TARGET','000 S5-${nonce} target');
      create temporary table context(k text primary key,v jsonb);
      grant all on context to authenticated;
      ${actorSql(actors[0])}
      insert into context values('opening',public.inventory_command('confirm_opening_balance',jsonb_build_object(
        'synthetic',true,'cutover_key','S5-${nonce}','scope_description','Synthetic S5 race',
        'count_cutoff',now(),'provenance_note','Synthetic race acceptance',
        'lines',jsonb_build_array(
          jsonb_build_object('line_key','bootstrap','provenance_group','bootstrap','catalog_item_id','${id(31)}','location_id','${id(41)}','good_quantity','1','damaged_quantity','0','expiry_precision','not_required'),
          jsonb_build_object('line_key','target','provenance_group','target','catalog_item_id','${id(31)}','location_id','${id(42)}','good_quantity','0.3','damaged_quantity','0','expiry_precision','not_required'))),gen_random_uuid()));
      do $$ declare a jsonb; n integer; begin
        for n in 1..3 loop
          a:=public.equipment_asset_command('open_asset',jsonb_build_object('catalog_item_id','${id(32)}',
            'location_id',case when n=3 then '${id(42)}' else '${id(41)}' end,'intake_reference','S5-${nonce}',
            'row_key',n::text,'expiry_precision','not_required','reason','Synthetic race opening','evidence_note','Synthetic fixture'),gen_random_uuid());
          perform public.equipment_asset_command('set_asset_lifecycle',jsonb_build_object('id',a->>'id','expected_revision',1,
            'lifecycle_status','in_service','reason','Commission synthetic asset','evidence_note','Synthetic fixture'),gen_random_uuid());
          insert into context values('asset'||n,a);
        end loop;
      end; $$;
      select set_config('request.jwt.claims',${jsonSql({ sub: actors[1], role: "authenticated" })}::text,true);
      insert into context
      select 'request'||n,to_jsonb(public.create_equipment_request_with_items(
        ('${prefix}'||lpad((100+n)::text,12,'0'))::uuid,'HK1','${actors[1]}',
        ((current_date+160+n)::text||' 09:00+07')::timestamptz,((current_date+160+n)::text||' 11:00+07')::timestamptz,null,
        'Synthetic S5 concurrency',jsonb_build_array(jsonb_build_object('skill_name','S5 race',
          'catalog_item_id',case when n<=3 then '${id(20)}' else '${id(21)}' end,'quantity',case when n=1 then 2 else 1 end))))
      from generate_series(1,5) n;
      select set_config('request.jwt.claims',${jsonSql({ sub: actors[0], role: "authenticated" })}::text,true);
      insert into context
      select 'map'||kind,public.equipment_preparation_command('map_item',request.id,
        jsonb_build_object('expected_revision',public.equipment_preparation_read(request.id)#>'{request,revision}',
          'catalog_item_id',catalog,'inventory_item_id',item,
          'base_units_per_requested_unit',factor,'reason','Explicit synthetic conversion'),gen_random_uuid())
      from (values('Q',1,'${id(20)}','${id(31)}','0.1'),('A',4,'${id(21)}','${id(32)}','1')) m(kind,req,catalog,item,factor)
      cross join lateral (select (v#>>'{}')::uuid id from context where k='request'||req) request;
      select set_config('request.jwt.claims',${jsonSql({ sub: actors[2], role: "authenticated" })}::text,true);
      do $$ declare n integer; r uuid; w jsonb; token uuid; alloc jsonb; mapping text; line text; q text; loc text; assets jsonb; begin
        for n in 1..5 loop
          select (v#>>'{}')::uuid into r from context where k='request'||n;
          w:=public.equipment_preparation_read(r); line:=w#>>'{lines,0,id}'; token:=gen_random_uuid();
          perform public.equipment_preparation_command('start',r,jsonb_build_object('expected_revision',w#>'{request,revision}','lock_token',token),gen_random_uuid());
          w:=public.equipment_preparation_read(r);
          select v->>'mapping_id' into mapping from context where k=case when n<=3 then 'mapQ' else 'mapA' end;
          q:=case when n=1 then '0.2' when n<=3 then '0.1' else '1' end;
          loc:=case when n=1 then '${id(42)}' else '${id(41)}' end;
          assets:=case when n>=4 then jsonb_build_array((select v->>'id' from context where k='asset'||(n-3))) else '[]'::jsonb end;
          alloc:=jsonb_build_array(jsonb_build_object('mapping_id',mapping,'location_id',loc,'base_quantity',q,'asset_ids',assets));
          perform public.equipment_preparation_command('confirm',r,jsonb_build_object('expected_revision',w#>'{request,revision}',
            'lock_token',token,'draft_revision',w#>'{preparation,revision}','plan',jsonb_build_object('lines',jsonb_build_array(
              jsonb_build_object('line_id',line,'planned_quantity',case when n=1 then '2' else '1' end,
                'reviewed_revision',w#>'{lines,0,line_revision}','shortage_reason','','allocations',alloc)))),gen_random_uuid());
          if n>1 then
            perform public.equipment_fulfillment_command('handover',r,jsonb_build_object('expected_revision',0,
              'business_key','S5-${nonce}-seed-'||n,'reason','Synthetic initial handover',
              'lines',jsonb_build_array(jsonb_build_object('line_id',line,'mapping_id',mapping,'location_id',loc,'quantity',q,'asset_ids',assets))),gen_random_uuid());
          end if;
          insert into context values('line'||n,to_jsonb(line));
        end loop;
      end; $$;
      select jsonb_object_agg(k,v) from context; commit;`);
    return parse(output);
  }

  async function cleanup() {
    // Committed fixtures are necessary for independent connections. Only this run's
    // actor/metadata ownership is removed; immutable guards remain active in every
    // scenario, and bypass is transaction-local to synthetic fixture teardown.
    const ownActors = actors.map(sqlLiteral).join(",");
    await run(`begin; set local session_replication_role=replica;
      create temporary table requests as select id from public.equipment_requests where class_schedule_id in
        (select id from public.class_schedules where course_id='${id(11)}');
      create temporary table preparations as select id from public.equipment_preparations where request_id in(select id from requests);
      create temporary table events as select id from public.equipment_fulfillment_events where request_id in(select id from requests);
      create temporary table origins as select id from public.inventory_stock_origins where catalog_item_id in('${id(31)}','${id(32)}');
      create temporary table transactions as select id from public.inventory_transactions where actor_id in(${ownActors});
      delete from public.equipment_fulfillment_signatures where event_id in(select id from events);
      delete from public.equipment_fulfillment_effects where event_id in(select id from events);
      delete from public.equipment_issue_slices where event_id in(select id from events);
      delete from public.equipment_fulfillment_events where id in(select id from events);
      delete from public.inventory_reservations where preparation_id in(select id from preparations);
      delete from public.equipment_preparation_allocations where plan_id in(select id from public.equipment_preparation_plans where preparation_id in(select id from preparations));
      delete from public.equipment_preparation_plans where preparation_id in(select id from preparations);
      delete from public.equipment_preparation_events where request_id in(select id from requests);
      delete from public.equipment_preparations where id in(select id from preparations);
      delete from public.equipment_inventory_mappings where catalog_item_id in('${id(20)}','${id(21)}');
      delete from public.email_outbox_events where actor_id in(${ownActors});
      delete from public.equipment_request_items where request_id in(select id from requests);
      delete from public.equipment_requests where id in(select id from requests);
      delete from public.equipment_asset_events where actor_id in(${ownActors});
      delete from public.equipment_assets where catalog_item_id='${id(32)}';
      delete from public.inventory_transaction_lines where transaction_id in(select id from transactions);
      delete from public.inventory_stock_balances where cohort_id in(select id from origins);
      delete from public.inventory_receipt_cohorts where origin_id in(select id from origins);
      delete from public.inventory_stock_facts where origin_id in(select id from origins);
      delete from public.inventory_stock_origins where id in(select id from origins);
      delete from public.inventory_opening_scope where catalog_item_id='${id(31)}';
      delete from public.inventory_opening_batches where transaction_id in(select id from transactions);
      delete from public.inventory_transactions where id in(select id from transactions);
      delete from public.inventory_operation_replays where actor_id in(${ownActors});
      delete from public.audit_logs where actor_id in(${ownActors});
      delete from public.inventory_catalog_items where id in('${id(31)}','${id(32)}');
      delete from public.inventory_categories where id='${id(30)}';
      delete from public.inventory_uoms where code in('s5_${nonce}_ml','s5_${nonce}_count');
      delete from public.inventory_storage_locations where id in('${id(41)}','${id(42)}');
      delete from public.equipment_catalog where id in('${id(20)}','${id(21)}');
      delete from public.email_notifications where recipient_id in(${ownActors})
        or payload->>'schedule_id' in(select id::text from public.class_schedules where course_id='${id(11)}');
      delete from public.class_schedules where course_id='${id(11)}';
      delete from public.courses where id='${id(11)}';
      delete from public.rooms where id='${id(10)}';
      delete from public.profile_room_types where profile_id in(${ownActors});
      delete from public.user_roles where user_id in(${ownActors});
      delete from public.profiles where id in(${ownActors});
      delete from auth.users where id in(${ownActors}); commit;`);
  }

  return { id, actors, setup, cleanup, race, command, read };
}
