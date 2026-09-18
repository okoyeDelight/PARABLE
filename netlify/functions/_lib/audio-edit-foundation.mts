import { stableHash } from './render-foundation.mts';
import type { SequenceTimeline } from './sequence-timeline.mts';

export type AudioCueKind = 'dialogue' | 'ambience' | 'foley' | 'music';

export type AudioCue = {
  id: string;
  kind: AudioCueKind;
  shot_id: string | null;
  speaker: string | null;
  text: string | null;
  prompt: string | null;
  start_seconds: number;
  duration_seconds: number;
  required_for_final: boolean;
  voice_policy: {
    mode: 'synthetic-original' | 'licensed-clone';
    consent_required: boolean;
    consent_ref: string | null;
  } | null;
};

export type SceneAudioPlan = {
  audio_plan_version: 'parable-scene-audio-plan-v1';
  plan_hash: string;
  project_id: string;
  story_version: string;
  scene_id: string;
  sequence_timeline_hash: string;
  cues: AudioCue[];
  mix: {
    sample_rate_hz: 48000;
    channels: 2;
    integrated_lufs: -14;
    true_peak_dbtp: -1.5;
    dialogue_priority: true;
  };
  policy: {
    celebrity_or_public_figure_voice_clone_without_rights: false;
    exact_actor_voice_requires_explicit_consent_ref: true;
    music_default: 'original-instrumental';
  };
  readiness: {
    ready_to_lock: boolean;
    blockers: string[];
    warnings: string[];
  };
  lock: {
    status: 'draft' | 'locked';
    approved_by_actor_id: string | null;
    approved_at: string | null;
    reviewer_note: string | null;
  };
  built_at: string;
};

export type FinalEditClip = {
  order: number;
  scene_id: string;
  shot_id: string;
  attempt_id: string;
  asset_uri: string;
  spec_hash: string;
  duration_seconds: number;
  transition: 'cut' | 'dissolve';
};

export type FinalEditPlan = {
  edit_plan_version: 'parable-final-edit-plan-v1';
  edit_hash: string;
  project_id: string;
  story_version: string;
  scene_id: string;
  sequence_timeline_hash: string;
  audio_plan_hash: string;
  clips: FinalEditClip[];
  captions: Array<{
    cue_id: string;
    start_seconds: number;
    end_seconds: number;
    speaker: string | null;
    text: string;
  }>;
  output: {
    container: 'mp4';
    video_codec: 'h264';
    audio_codec: 'aac';
    fps: 24;
    pixel_format: 'yuv420p';
    faststart: true;
    integrated_lufs: -14;
    true_peak_dbtp: -1.5;
  };
  readiness: {
    ready_to_lock: boolean;
    blockers: string[];
    warnings: string[];
  };
  lock: {
    status: 'draft' | 'locked';
    approved_by_actor_id: string | null;
    approved_at: string | null;
    reviewer_note: string | null;
  };
  built_at: string;
};

export type AudioAssetBinding = {
  cue_id: string;
  asset_uri: string;
  content_sha256?: string | null;
  duration_seconds?: number | null;
  rights_confirmed?: boolean;
};

export type FinalFilmManifest = {
  manifest_version: 'parable-final-film-manifest-v1';
  manifest_hash: string;
  project_id: string;
  story_version: string;
  scene_id: string;
  edit_hash: string;
  video_clips: FinalEditClip[];
  audio_layers: Array<{
    cue_id: string;
    kind: AudioCueKind;
    asset_uri: string;
    start_seconds: number;
    duration_seconds: number;
    gain_db: number;
    required_for_final: boolean;
  }>;
  captions: FinalEditPlan['captions'];
  output: FinalEditPlan['output'];
  readiness: {
    ready_to_assemble: boolean;
    blockers: string[];
    warnings: string[];
  };
  created_at: string;
};

const clean = (value: unknown, max = 3000) =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const positive = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(120, n) : fallback;
};

function sceneShots(adaptation: Record<string, any>, sceneId: string) {
  const shots = Array.isArray(adaptation?.shot_plan)
    ? adaptation.shot_plan
    : Array.isArray(adaptation?.production_bible?.shot_plan)
      ? adaptation.production_bible.shot_plan
      : [];
  const tagged = shots.filter((shot: any) => clean(shot?.scene_id || shot?.sceneId, 96));
  return tagged.length
    ? shots.filter((shot: any) => clean(shot?.scene_id || shot?.sceneId, 96) === sceneId)
    : shots;
}

function sceneBeats(adaptation: Record<string, any>, sceneId: string) {
  const screenplay = adaptation?.screenplay || {};
  const all = Array.isArray(screenplay?.beats) ? screenplay.beats : [];
  const tagged = all.filter((beat: any) => clean(beat?.scene_id || beat?.sceneId, 96));
  return tagged.length
    ? all.filter((beat: any) => clean(beat?.scene_id || beat?.sceneId, 96) === sceneId)
    : all;
}

function shotDurations(adaptation: Record<string, any>, sceneId: string, timeline: SequenceTimeline) {
  const source = sceneShots(adaptation, sceneId);
  const byId = new Map(source.map((shot: any, index: number) => [
    clean(shot?.id || ('shot_' + (index + 1)), 96),
    positive(
      shot?.duration_seconds ?? shot?.duration ?? shot?.estimated_duration_seconds,
      0
    )
  ]));
  return timeline.entries.map((entry) => ({
    shot_id: entry.shot_id,
    duration_seconds: byId.get(entry.shot_id) || 0
  }));
}

function assignShotForBeat(index: number, beatCount: number, entries: SequenceTimeline['entries']) {
  if (!entries.length) return null;
  if (beatCount <= 1) return entries[0].shot_id;
  const scaled = Math.min(
    entries.length - 1,
    Math.floor((index / Math.max(1, beatCount)) * entries.length)
  );
  return entries[scaled]?.shot_id || entries[0].shot_id;
}

export async function buildSceneAudioPlan(args: {
  projectId: string;
  storyVersion: string;
  sceneId: string;
  adaptation: Record<string, any>;
  timeline: SequenceTimeline;
  existing?: SceneAudioPlan | null;
}) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (args.timeline.lock.status !== 'locked') {
    blockers.push('The visual sequence must be human-locked before audio can be locked.');
  }
  if (!args.timeline.entries.length) blockers.push('The locked visual sequence has no accepted shots.');

  const durations = shotDurations(args.adaptation, args.sceneId, args.timeline);
  if (durations.some((item) => item.duration_seconds <= 0)) {
    warnings.push('One or more shot durations are not explicit; PARABLE will use editorial estimates until the edit is locked.');
  }

  const effectiveDurations = durations.map((item) => ({
    ...item,
    duration_seconds: item.duration_seconds > 0 ? item.duration_seconds : 6
  }));

  const startByShot = new Map<string, number>();
  let cursor = 0;
  for (const item of effectiveDurations) {
    startByShot.set(item.shot_id, cursor);
    cursor += item.duration_seconds;
  }

  const beats = sceneBeats(args.adaptation, args.sceneId);
  const dialogueBeats = beats
    .map((beat: any, index: number) => ({ beat, index }))
    .filter(({ beat }) => clean(beat?.speaker, 160) && clean(beat?.text, 3000));

  const cues: AudioCue[] = dialogueBeats.map(({ beat, index }, dialogueIndex) => {
    const shotId = clean(beat?.shot_id || beat?.shotId, 96) ||
      assignShotForBeat(index, Math.max(1, beats.length), args.timeline.entries);
    const text = clean(beat?.text, 3000);
    const speaker = clean(beat?.speaker, 160);
    const estimate = Math.max(1.2, Math.min(20, text.split(/\s+/).filter(Boolean).length / 2.45));
    const base = shotId ? (startByShot.get(shotId) || 0) : 0;
    return {
      id: 'dialogue_' + String(dialogueIndex + 1).padStart(3, '0'),
      kind: 'dialogue' as const,
      shot_id: shotId,
      speaker,
      text,
      prompt: null,
      start_seconds: Math.round(base * 1000) / 1000,
      duration_seconds: Math.round(estimate * 1000) / 1000,
      required_for_final: true,
      voice_policy: {
        mode: 'synthetic-original' as const,
        consent_required: false,
        consent_ref: null
      }
    };
  });

  const ambiencePrompt = clean(
    args.adaptation?.production_bible?.world?.soundscape ||
    args.adaptation?.production_bible?.world?.ambient_sound ||
    args.adaptation?.production_bible?.setting ||
    args.adaptation?.setting ||
    'Natural room tone faithful to the scene location and period.',
    1200
  );

  cues.push({
    id: 'ambience_001',
    kind: 'ambience',
    shot_id: null,
    speaker: null,
    text: null,
    prompt: ambiencePrompt,
    start_seconds: 0,
    duration_seconds: Math.max(1, Math.round(cursor * 1000) / 1000),
    required_for_final: false,
    voice_policy: null
  });

  cues.push({
    id: 'foley_001',
    kind: 'foley',
    shot_id: null,
    speaker: null,
    text: null,
    prompt: 'Subtle production Foley derived from visible actions only; no invented off-screen event.',
    start_seconds: 0,
    duration_seconds: Math.max(1, Math.round(cursor * 1000) / 1000),
    required_for_final: false,
    voice_policy: null
  });

  cues.push({
    id: 'music_001',
    kind: 'music',
    shot_id: null,
    speaker: null,
    text: null,
    prompt: 'Original restrained instrumental score supporting the emotional arc without imitating a named living artist or copyrighted composition.',
    start_seconds: 0,
    duration_seconds: Math.max(1, Math.round(cursor * 1000) / 1000),
    required_for_final: false,
    voice_policy: null
  });

  const unsigned = {
    audio_plan_version: 'parable-scene-audio-plan-v1' as const,
    project_id: args.projectId,
    story_version: args.storyVersion,
    scene_id: args.sceneId,
    sequence_timeline_hash: args.timeline.timeline_hash,
    cues,
    mix: {
      sample_rate_hz: 48000 as const,
      channels: 2 as const,
      integrated_lufs: -14 as const,
      true_peak_dbtp: -1.5 as const,
      dialogue_priority: true as const
    },
    policy: {
      celebrity_or_public_figure_voice_clone_without_rights: false as const,
      exact_actor_voice_requires_explicit_consent_ref: true as const,
      music_default: 'original-instrumental' as const
    },
    readiness: {
      ready_to_lock: blockers.length === 0,
      blockers: [...new Set(blockers)],
      warnings: [...new Set(warnings)]
    }
  };

  const planHash = await stableHash(unsigned);
  const keepLock = args.existing?.plan_hash === planHash && args.existing.lock.status === 'locked';

  return {
    ...unsigned,
    plan_hash: planHash,
    lock: keepLock
      ? args.existing!.lock
      : {
          status: 'draft' as const,
          approved_by_actor_id: null,
          approved_at: null,
          reviewer_note: null
        },
    built_at: new Date().toISOString()
  } satisfies SceneAudioPlan;
}

export async function buildFinalEditPlan(args: {
  projectId: string;
  storyVersion: string;
  sceneId: string;
  adaptation: Record<string, any>;
  timeline: SequenceTimeline;
  audioPlan: SceneAudioPlan;
  existing?: FinalEditPlan | null;
}) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (args.timeline.lock.status !== 'locked') blockers.push('Visual sequence is not locked.');
  if (args.audioPlan.lock.status !== 'locked') blockers.push('Audio plan is not human-locked.');
  if (args.audioPlan.sequence_timeline_hash !== args.timeline.timeline_hash) {
    blockers.push('Audio plan was built against a different visual timeline.');
  }

  const durations = shotDurations(args.adaptation, args.sceneId, args.timeline);
  const durationByShot = new Map(durations.map((item) => [item.shot_id, item.duration_seconds]));
  if (durations.some((item) => item.duration_seconds <= 0)) {
    warnings.push('Missing explicit shot duration was replaced with a six-second editorial estimate.');
  }

  const clips = args.timeline.entries.map((entry, index) => ({
    order: index + 1,
    scene_id: args.sceneId,
    shot_id: entry.shot_id,
    attempt_id: entry.attempt_id,
    asset_uri: entry.asset_uri,
    spec_hash: entry.spec_hash,
    duration_seconds: durationByShot.get(entry.shot_id) || 6,
    transition: 'cut' as const
  }));

  const captions = args.audioPlan.cues
    .filter((cue) => cue.kind === 'dialogue' && cue.text)
    .map((cue) => ({
      cue_id: cue.id,
      start_seconds: cue.start_seconds,
      end_seconds: cue.start_seconds + cue.duration_seconds,
      speaker: cue.speaker,
      text: cue.text!
    }));

  if (!clips.length) blockers.push('There are no accepted clips to edit.');
  if (clips.some((clip) => !/^https:\/\//i.test(clip.asset_uri))) {
    blockers.push('Every accepted clip must have a valid HTTP media asset URI.');
  }

  const unsigned = {
    edit_plan_version: 'parable-final-edit-plan-v1' as const,
    project_id: args.projectId,
    story_version: args.storyVersion,
    scene_id: args.sceneId,
    sequence_timeline_hash: args.timeline.timeline_hash,
    audio_plan_hash: args.audioPlan.plan_hash,
    clips,
    captions,
    output: {
      container: 'mp4' as const,
      video_codec: 'h264' as const,
      audio_codec: 'aac' as const,
      fps: 24 as const,
      pixel_format: 'yuv420p' as const,
      faststart: true as const,
      integrated_lufs: -14 as const,
      true_peak_dbtp: -1.5 as const
    },
    readiness: {
      ready_to_lock: blockers.length === 0,
      blockers: [...new Set(blockers)],
      warnings: [...new Set(warnings)]
    }
  };

  const editHash = await stableHash(unsigned);
  const keepLock = args.existing?.edit_hash === editHash && args.existing.lock.status === 'locked';

  return {
    ...unsigned,
    edit_hash: editHash,
    lock: keepLock
      ? args.existing!.lock
      : {
          status: 'draft' as const,
          approved_by_actor_id: null,
          approved_at: null,
          reviewer_note: null
        },
    built_at: new Date().toISOString()
  } satisfies FinalEditPlan;
}

export async function buildFinalFilmManifest(args: {
  editPlan: FinalEditPlan;
  audioPlan: SceneAudioPlan;
  audioAssets: AudioAssetBinding[];
}) {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (args.editPlan.lock.status !== 'locked') blockers.push('Final edit plan is not human-locked.');
  if (args.audioPlan.lock.status !== 'locked') blockers.push('Audio plan is not human-locked.');
  if (args.editPlan.audio_plan_hash !== args.audioPlan.plan_hash) {
    blockers.push('Final edit plan is bound to a different audio plan.');
  }

  const assets = new Map(args.audioAssets.map((asset) => [asset.cue_id, asset]));
  const audioLayers = args.audioPlan.cues.flatMap((cue) => {
    const asset = assets.get(cue.id);
    if (!asset?.asset_uri) {
      if (cue.required_for_final) blockers.push('Required audio cue ' + cue.id + ' has no bound audio asset.');
      else warnings.push('Optional ' + cue.kind + ' cue ' + cue.id + ' has no audio asset and will be omitted.');
      return [];
    }
    if (!/^https:\/\//i.test(asset.asset_uri)) {
      blockers.push('Audio cue ' + cue.id + ' has an invalid asset URI.');
      return [];
    }
    if (asset.rights_confirmed === false) {
      blockers.push('Audio cue ' + cue.id + ' does not have rights confirmation.');
      return [];
    }
    return [{
      cue_id: cue.id,
      kind: cue.kind,
      asset_uri: asset.asset_uri,
      start_seconds: cue.start_seconds,
      duration_seconds: positive(asset.duration_seconds, cue.duration_seconds),
      gain_db: cue.kind === 'music' ? -12 : cue.kind === 'ambience' ? -9 : 0,
      required_for_final: cue.required_for_final
    }];
  });

  const unsigned = {
    manifest_version: 'parable-final-film-manifest-v1' as const,
    project_id: args.editPlan.project_id,
    story_version: args.editPlan.story_version,
    scene_id: args.editPlan.scene_id,
    edit_hash: args.editPlan.edit_hash,
    video_clips: args.editPlan.clips,
    audio_layers: audioLayers,
    captions: args.editPlan.captions,
    output: args.editPlan.output,
    readiness: {
      ready_to_assemble: blockers.length === 0,
      blockers: [...new Set(blockers)],
      warnings: [...new Set(warnings)]
    }
  };
  const manifestHash = await stableHash(unsigned);
  return {
    ...unsigned,
    manifest_hash: manifestHash,
    created_at: new Date().toISOString()
  } satisfies FinalFilmManifest;
}
