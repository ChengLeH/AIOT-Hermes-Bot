import test from 'node:test';
import assert from 'node:assert/strict';
import { artifactMimeForName, collectToolArtifacts } from './aiot-session-artifacts.mjs';

test('accepts explicit artifacts from structured and wrapped tool results', () => {
  const rows = collectToolArtifacts([
    { role:'tool', tool_name:'document_export', content:JSON.stringify({ output_path:'/tmp/report.pdf' }) },
    { role:'tool', name:'write_file', content:'<untrusted_tool_result>\nmetadata\n\n{"files_written":["./chart.png"]}\n</untrusted_tool_result>' },
    { role:'tool', name:'image_generation_tool', content:{ _multimodal:true, meta:{ generated_file:'C:\\work\\image.webp' } } },
  ]);
  assert.deepEqual(rows, [
    { path:'/tmp/report.pdf', name:'report.pdf', mime:'application/pdf' },
    { path:'./chart.png', name:'chart.png', mime:'image/png' },
    { path:'C:\\work\\image.webp', name:'image.webp', mime:'image/webp' },
  ]);
});

test('rejects assistant claims, generic paths from non-producers, URLs and unsupported files', () => {
  assert.deepEqual(collectToolArtifacts([
    { role:'assistant', content:'Download /etc/private.pdf' },
    { role:'tool', name:'search', content:JSON.stringify({ path:'/tmp/claimed.pdf', output_path:'https://evil.example/x.pdf' }) },
    { role:'tool', name:'write_file', content:JSON.stringify({ path:'/tmp/script.sh' }) },
  ]), []);
  assert.equal(artifactMimeForName('slides.pptx'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  assert.equal(artifactMimeForName('run.sh'), null);
});
