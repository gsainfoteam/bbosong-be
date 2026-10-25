import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import test from 'node:test';
import {
  brotliCompressSync,
  brotliDecompressSync,
  createBrotliDecompress,
} from 'node:zlib';

// Public detection vector from Bun's upstream regression test, not an exploit:
// https://github.com/oven-sh/bun/blob/bun-v1.4.4/test/js/node/test/parallel/test-zlib-invalid-input.js
const invalidBlockSwitch = Buffer.from(
  '200010414141fcffff07002228f00b60f7f41f000000',
  'hex',
);
const expectedError = {
  code: 'ERR__ERROR_FORMAT_BLOCK_SWITCH',
  errno: -17,
};

const byteChunks = (input) =>
  Array.from(input, (_, index) => input.subarray(index, index + 1));

const decodeStream = async (input) => {
  const chunks = [];
  await pipeline(
    Readable.from(byteChunks(input)),
    createBrotliDecompress(),
    new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    }),
  );
  return Buffer.concat(chunks);
};

test('Brotli rejects an invalid block switch immediately in synchronous decoding', () => {
  assert.throws(() => brotliDecompressSync(invalidBlockSwitch), expectedError);
});

test('Brotli rejects an invalid block switch with byte-at-a-time streaming input', async () => {
  await assert.rejects(decodeStream(invalidBlockSwitch), expectedError);
});

test('Brotli still decodes valid data synchronously and with byte-at-a-time streaming input', async () => {
  const body = Buffer.from(
    JSON.stringify({ message: '정상 Brotli 요청 본문' }),
  );
  const compressed = brotliCompressSync(body);

  assert.deepEqual(brotliDecompressSync(compressed), body);
  assert.deepEqual(await decodeStream(compressed), body);
});
