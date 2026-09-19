import assert from 'node:assert/strict';
import {
  canonicalRenderMediaUri,
  detectRenderMediaType,
  parseCanonicalRenderMediaUri,
  readBoundedResponseBody,
  RenderMediaIngestError,
  validateProviderAssetUrl
} from '../netlify/functions/_lib/render-media-ingest-core.mts';

const hash='d'.repeat(64);
assert.equal(canonicalRenderMediaUri(hash),'parable://render/'+hash);
assert.equal(parseCanonicalRenderMediaUri('parable://render/'+hash),hash);
assert.equal(parseCanonicalRenderMediaUri('https://provider.example/video.mp4'),null);

assert.throws(
  ()=>validateProviderAssetUrl('http://example.com/video.mp4'),
  (error:any)=>error instanceof RenderMediaIngestError&&error.code==='RENDER_MEDIA_SOURCE_URL_UNSAFE'
);
assert.throws(
  ()=>validateProviderAssetUrl('https://127.0.0.1/video.mp4'),
  (error:any)=>error instanceof RenderMediaIngestError&&error.code==='RENDER_MEDIA_SOURCE_URL_UNSAFE'
);
assert.match(validateProviderAssetUrl('https://cdn.example.com/video.mp4'),/^https:\/\/cdn\.example\.com\//);

const mp4=new Uint8Array([
  0x00,0x00,0x00,0x18,
  0x66,0x74,0x79,0x70,
  0x69,0x73,0x6f,0x6d,
  0x00,0x00,0x00,0x00
]);
assert.equal(detectRenderMediaType(mp4,'application/octet-stream'),'video/mp4');

const webm=new Uint8Array([0x1a,0x45,0xdf,0xa3,0x42,0x86,0x81,0x01]);
assert.equal(detectRenderMediaType(webm,'application/octet-stream'),'video/webm');

assert.throws(
  ()=>detectRenderMediaType(new Uint8Array([1,2,3,4,5,6,7,8]),'video/mp4'),
  (error:any)=>error instanceof RenderMediaIngestError&&error.code==='RENDER_MEDIA_SIGNATURE_INVALID'
);

const streamed=new Response(new ReadableStream({
  start(controller){
    controller.enqueue(new Uint8Array([1,2,3]));
    controller.enqueue(new Uint8Array([4,5]));
    controller.close();
  }
}));
const streamedBytes=await readBoundedResponseBody(streamed,5);
assert.deepEqual([...streamedBytes],[1,2,3,4,5]);

const oversized=new Response(new ReadableStream({
  start(controller){
    controller.enqueue(new Uint8Array([1,2,3,4]));
    controller.enqueue(new Uint8Array([5,6,7,8]));
    controller.close();
  }
}));
await assert.rejects(
  ()=>readBoundedResponseBody(oversized,6),
  (error:any)=>error instanceof RenderMediaIngestError&&error.code==='RENDER_MEDIA_TOO_LARGE'
);

const declaredTooLarge=new Response(new Uint8Array([1]),{
  headers:{'content-length':'100'}
});
await assert.rejects(
  ()=>readBoundedResponseBody(declaredTooLarge,10),
  (error:any)=>error instanceof RenderMediaIngestError&&error.code==='RENDER_MEDIA_TOO_LARGE'
);

console.log(JSON.stringify({
  ok:true,
  canonical_uri:canonicalRenderMediaUri(hash),
  bounded_stream:true,
  media_signatures:['mp4','webm'],
  unsafe_sources_blocked:true
},null,2));
