import assert from 'node:assert/strict';
import test from 'node:test';
import { MatterClient } from '@matter-server/ws-client';

// Exercise the installed package so a missing dependency patch fails this test.
test('Matter client keeps communication quiet while preserving events, warnings and errors', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const debug = t.mock.method(console, 'debug', () => {});
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const node = {
    node_id: 1,
    attributes: { '0/40/15': 'test-device', '1/144/8': 0 },
    attribute_subscriptions: [],
  };
  const sent = [];
  const socket = {
    readyState: 1,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send(data) {
      const message = JSON.parse(data);
      sent.push(message);
      this.receive({
        message_id: message.message_id,
        result: message.command === 'start_listening' ? [node] : node,
      });
    },
    close() {
      this.readyState = 3;
      this.onclose({});
    },
    receive(message) {
      this.onmessage({ data: JSON.stringify(message) });
    },
  };
  const client = new MatterClient('ws://test.invalid/ws', () => socket);
  t.after(() => client.disconnect());

  const listening = client.startListening();
  socket.onopen({});
  socket.receive({ schema_version: 12 });
  await listening;
  assert.equal(client.nodes['1'].serialNumber, 'test-device');

  let changed = 0;
  client.addEventListener('nodes_changed', () => changed++);
  socket.receive({ event: 'attribute_updated', data: [1, '1/144/8', 123] });
  assert.equal(changed, 1);
  assert.equal(client.nodes['1'].attributes['1/144/8'], 123);

  const commissioned = await client.commissionWithCode(
    'SYNTHETIC_PAIRING_CODE',
    true,
  );
  assert.equal(commissioned.serialNumber, 'test-device');
  assert.equal(sent.at(-1).args.code, 'SYNTHETIC_PAIRING_CODE');
  assert.equal(log.mock.callCount(), 0);
  assert.equal(debug.mock.callCount(), 0);

  socket.receive({ unexpected: true });
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(
    warn.mock.calls[0].arguments[0],
    'Received message with unknown format',
  );

  const wsError = new Error('Synthetic WebSocket error');
  socket.onerror(wsError);
  assert.equal(error.mock.callCount(), 1);
  assert.equal(error.mock.calls[0].arguments[1], wsError);

  let lost = 0;
  client.addEventListener('connection_lost', () => lost++);
  client.disconnect();
  assert.equal(lost, 1);
  assert.equal(log.mock.callCount(), 0);
  assert.equal(debug.mock.callCount(), 0);
});
