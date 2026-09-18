import assert from 'node:assert/strict';
import {
  bootstrapContinuity,
  buildRenderContinuityContract,
  evaluateAndApplyScene
} from '../netlify/functions/_lib/continuity-core.mts';

const base=bootstrapContinuity({
  projectId:'smoke_project',
  storyVersion:'story_v1',
  productionBible:{
    characters:[
      {name:'Daniel',role:'lead',source_basis:{basis:'explicit',confidence:0.95}},
      {name:'Miriam',role:'mother',source_basis:{basis:'explicit',confidence:0.95}}
    ],
    locations:[{name:'Living Room'}]
  }
});

assert.equal(base.schema_version,'continuity-v4');

const established=evaluateAndApplyScene(base,{
  id:'scene_1',
  index:1,
  shot_id:'shot_1',
  room_topology:{
    location:'Living Room',
    anchors:[
      {label:'front door',kind:'door',locked:true,confidence:0.95},
      {label:'sofa',kind:'furniture',locked:true,confidence:0.95}
    ],
    relations:[
      {
        subject:'front door',
        relation:'left_of',
        target:'sofa',
        confidence:0.95,
        transition:false,
        locked:true
      }
    ]
  },
  camera_axes:[{
    axis_id:'axis_daniel_miriam',
    location:'Living Room',
    subject_a:'Daniel',
    subject_b:'Miriam',
    camera_side:'side_a',
    subject_a_screen_side:'left',
    subject_b_screen_side:'right',
    bridge_shot:false,
    intentional_cross:false,
    reset_axis:false,
    reason:''
  }]
},{apply:true});

assert.equal(established.can_render,true);
assert.equal(Object.keys(established.snapshot.room_topology).length,1);
assert.equal(established.snapshot.camera_axes.axis_daniel_miriam.last_camera_side,'side_a');

const illegalCross=evaluateAndApplyScene(established.snapshot,{
  id:'scene_1',
  index:1,
  shot_id:'shot_2',
  camera_axes:[{
    axis_id:'axis_daniel_miriam',
    location:'Living Room',
    subject_a:'Daniel',
    subject_b:'Miriam',
    camera_side:'side_b',
    subject_a_screen_side:'right',
    subject_b_screen_side:'left',
    bridge_shot:false,
    intentional_cross:false,
    reset_axis:false,
    reason:''
  }]
},{apply:false});

assert.equal(illegalCross.can_render,false);
assert.ok(illegalCross.warnings.some((w)=>w.code==='CAMERA_AXIS_CROSS'));

const neutralBridge=evaluateAndApplyScene(established.snapshot,{
  id:'scene_1',
  index:1,
  shot_id:'shot_bridge',
  camera_axes:[{
    axis_id:'axis_daniel_miriam',
    location:'Living Room',
    subject_a:'Daniel',
    subject_b:'Miriam',
    camera_side:'neutral',
    subject_a_screen_side:'center',
    subject_b_screen_side:'center',
    bridge_shot:true,
    intentional_cross:false,
    reset_axis:false,
    reason:'neutral two-shot re-establishes geography'
  }]
},{apply:true});

assert.equal(neutralBridge.can_render,true);

const bridgedCross=evaluateAndApplyScene(neutralBridge.snapshot,{
  id:'scene_1',
  index:1,
  shot_id:'shot_3',
  camera_axes:[{
    axis_id:'axis_daniel_miriam',
    location:'Living Room',
    subject_a:'Daniel',
    subject_b:'Miriam',
    camera_side:'side_b',
    subject_a_screen_side:'right',
    subject_b_screen_side:'left',
    bridge_shot:false,
    intentional_cross:false,
    reset_axis:false,
    reason:''
  }]
},{apply:false});

assert.equal(bridgedCross.can_render,true);
assert.ok(!bridgedCross.warnings.some((w)=>w.code==='CAMERA_AXIS_CROSS'));

const topologyBreak=evaluateAndApplyScene(established.snapshot,{
  id:'scene_1',
  index:1,
  shot_id:'shot_topology_bad',
  room_topology:{
    location:'Living Room',
    anchors:[],
    relations:[{
      subject:'front door',
      relation:'right_of',
      target:'sofa',
      confidence:0.95,
      transition:false,
      locked:true
    }]
  }
},{apply:false});

assert.equal(topologyBreak.can_render,false);
assert.ok(topologyBreak.warnings.some((w)=>w.code==='ROOM_TOPOLOGY_CONFLICT'));

const movedFurniture=evaluateAndApplyScene(established.snapshot,{
  id:'scene_1',
  index:1,
  shot_id:'shot_topology_move',
  room_topology:{
    location:'Living Room',
    anchors:[],
    relations:[{
      subject:'front door',
      relation:'right_of',
      target:'sofa',
      confidence:0.95,
      transition:true,
      locked:true
    }]
  }
},{apply:false});

assert.ok(!movedFurniture.warnings.some((w)=>w.code==='ROOM_TOPOLOGY_CONFLICT'));

const contract=buildRenderContinuityContract(established.snapshot,'scene_1','shot_1');
assert.equal(contract.contract_version,'render-continuity-v3');
assert.ok(contract.room_topology);
assert.ok(contract.camera_axes.axis_daniel_miriam);
assert.ok(contract.hard_rules.some((rule:string)=>/camera axis/i.test(rule)));

console.log(JSON.stringify({
  ok:true,
  schema:base.schema_version,
  illegal_axis_cross_blocked:true,
  neutral_bridge_allows_reorientation:true,
  locked_room_topology_conflict_blocked:true,
  render_contract:contract.contract_version
},null,2));
