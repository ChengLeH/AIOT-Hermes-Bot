import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentenceBubbles } from './sentence-bubbles.ts';

test('token streams reveal sentences atomically and flush last fragment', () => {
  const first = '這是一整句。';
  for (let n = 1; n < first.length; n++) assert.deepEqual(sentenceBubbles(first.slice(0,n), true), []);
  assert.deepEqual(sentenceBubbles(first + '下一句尚未完成', true), [first]);
  assert.deepEqual(sentenceBubbles(first + '下一句尚未完成', false), [first, '下一句尚未完成']);
});
test('closed code blocks remain whole, incomplete fence waits', () => {
  const code = '```js\nconst n = 3.14;\nconsole.log(n);\n```\n';
  assert.deepEqual(sentenceBubbles(code.slice(0, -4), true), []);
  assert.deepEqual(sentenceBubbles(code, true), [code]);
});
test('content is preserved exactly, including whitespace and inline code', () => {
  for (const text of ['Hello world. Next sentence!', '第一句。\n\n第二句！', 'Use `a.b()` here. Done.', '```js\nx()\n```\nTail', 'no final punctuation']) {
    assert.equal(sentenceBubbles(text, false).join(''), text);
  }
});
test('decimals and URLs stay intact; markdown list/table/bold stays one block', () => {
  assert.deepEqual(sentenceBubbles('See https://example.com and 3.14. Next', true), ['See https://example.com and 3.14.']);
  for (const text of ['- First item.\n- Second item.', '| Name | Value |\n| --- | --- |\n| A. | 1 |', '**A complete. Bold phrase.**']) {
    assert.deepEqual(sentenceBubbles(text, true), []);
    assert.deepEqual(sentenceBubbles(text, false), [text]);
  }
});
