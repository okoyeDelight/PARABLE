import assert from 'node:assert/strict';
import {
  buildSceneAudioPlan,
  buildFinalEditPlan,
  buildFinalFilmManifest
} from '../netlify/functions/_lib/audio-edit-foundation.mts';
import type { SequenceTimeline } from '../netlify/functions/_lib/sequence-timeline.mts';

const timeline:SequenceTimeline={
  timeline_version:'parable-sequence-timeline-v1',
  timeline_hash:'timeline-hash-1',
  project_id:'p1',story_version:'v1',scene_id:'scene_1',
  adaptation_ref:'adapt-ref',spatial_plan_hash:'space-ref',shot_count:2,
  entries:[
    {order:1,shot_id:'shot_1',continuity_break_before:false,accepted_ref:'a1',handoff_ref:'h1',attempt_id:'attempt_1',asset_uri:'parable://render/'+ '1'.repeat(64),asset_sha256:'1'.repeat(64),asset_storage:'parable-blobs-v1',spec_hash:'spec1',provider:'fal',model:'renderer-a',accepted_by_human_override:false,full_motion_review_confirmed:false,known_motion_defects_acknowledged:false,qa_decision:'PASS',motion_decision:'CLEAR_FOR_QA',motion_inspection_id:'m1',motion_sample_set_hash:'mh1',handoff_frame_sha256:'a'.repeat(64)},
    {order:2,shot_id:'shot_2',continuity_break_before:false,accepted_ref:'a2',handoff_ref:null,attempt_id:'attempt_2',asset_uri:'parable://render/'+ '2'.repeat(64),asset_sha256:'2'.repeat(64),asset_storage:'parable-blobs-v1',spec_hash:'spec2',provider:'fal',model:'renderer-a',accepted_by_human_override:false,full_motion_review_confirmed:false,known_motion_defects_acknowledged:false,qa_decision:'PASS',motion_decision:'CLEAR_FOR_QA',motion_inspection_id:'m2',motion_sample_set_hash:'mh2',handoff_frame_sha256:null}
  ],
  readiness:{ready_to_lock:true,blockers:[],manual_exceptions:[]},
  lock:{status:'locked',approved_by_actor_id:'reviewer',approved_at:new Date().toISOString(),reviewer_note:null,manual_exceptions_accepted:false},
  built_at:new Date().toISOString()
};

const adaptation:any={
  story_version:'v1',
  setting:'Awka, Nigeria',
  shot_plan:[
    {id:'shot_1',scene_id:'scene_1',duration_seconds:5},
    {id:'shot_2',scene_id:'scene_1',duration_seconds:7}
  ],
  screenplay:{beats:[
    {type:'action',text:'Daniel crosses the room.'},
    {type:'dialogue',speaker:'Daniel',text:'I will still go.'}
  ]},
  production_bible:{setting:'Awka, Nigeria',world:{soundscape:'Rain against windows, quiet interior room tone.'}}
};

const draftAudio=await buildSceneAudioPlan({projectId:'p1',storyVersion:'v1',sceneId:'scene_1',adaptation,timeline});
assert.equal(draftAudio.readiness.ready_to_lock,true);
assert.ok(draftAudio.cues.some(c=>c.kind==='dialogue'&&c.required_for_final));
assert.equal(draftAudio.policy.celebrity_or_public_figure_voice_clone_without_rights,false);

const audio={...draftAudio,lock:{status:'locked' as const,approved_by_actor_id:'reviewer',approved_at:new Date().toISOString(),reviewer_note:'voices reviewed'}};
const draftEdit=await buildFinalEditPlan({projectId:'p1',storyVersion:'v1',sceneId:'scene_1',adaptation,timeline,audioPlan:audio});
assert.equal(draftEdit.readiness.ready_to_lock,true);
assert.equal(draftEdit.clips.length,2);
assert.equal(draftEdit.output.container,'mp4');

const edit={...draftEdit,lock:{status:'locked' as const,approved_by_actor_id:'reviewer',approved_at:new Date().toISOString(),reviewer_note:'cut reviewed'}};
const blocked=await buildFinalFilmManifest({editPlan:edit,audioPlan:audio,audioAssets:[]});
assert.equal(blocked.readiness.ready_to_assemble,false);
assert.ok(blocked.readiness.blockers.some(x=>x.includes('dialogue_001')));

const ready=await buildFinalFilmManifest({
  editPlan:edit,audioPlan:audio,
  audioAssets:[{cue_id:'dialogue_001',asset_uri:'https://example.test/dialogue.wav',rights_confirmed:true,duration_seconds:2}]
});
assert.equal(ready.readiness.ready_to_assemble,true);
assert.equal(ready.video_clips.length,2);
assert.equal(ready.audio_layers.length,1);
assert.equal(ready.output.video_codec,'h264');

const staleAudio={...audio,sequence_timeline_hash:'other'};
const staleEdit=await buildFinalEditPlan({projectId:'p1',storyVersion:'v1',sceneId:'scene_1',adaptation,timeline,audioPlan:staleAudio});
assert.equal(staleEdit.readiness.ready_to_lock,false);
assert.ok(staleEdit.readiness.blockers.some(x=>x.includes('different visual timeline')));

console.log(JSON.stringify({ok:true,audio_plan_hash:audio.plan_hash,edit_hash:edit.edit_hash,manifest_hash:ready.manifest_hash},null,2));
