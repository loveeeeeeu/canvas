import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { BoardCRDT, LOCAL_ORIGIN, REMOTE_ORIGIN } from './crdtDoc';
import type { BoardElement } from '../types/board';

function sampleNode(id: string, text: string, x = 0): BoardElement {
  return {
    id,
    type: 'rectangle',
    x,
    y: 0,
    width: 140,
    height: 70,
    seed: 101,
    zIndex: 1,
    text,
    strokeColor: '#1e293b',
    fillColor: '#dbeafe',
    fillStyle: 'hachure',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 'rough',
    opacity: 1,
    fontSize: 16,
    updatedAt: 1,
  };
}

test('two independent Yjs peers converge to identical state after concurrent edits', () => {
  const peerA = new BoardCRDT();
  const peerB = new BoardCRDT();

  // Peer A and Peer B both make concurrent offline edits
  peerA.upsertElement(sampleNode('node-a', 'From Peer A', 100));
  peerB.upsertElement(sampleNode('node-b', 'From Peer B', 300));

  // Both concurrently edit the same shared node ID (CRDT conflict resolution)
  peerA.upsertElement(sampleNode('shared', 'Edit A', 50));
  peerB.upsertElement(sampleNode('shared', 'Edit B', 80));

  // Exchange full Yjs binary updates bidirectionally (simulating WebRTC/BroadcastChannel sync)
  const updateFromA = Y.encodeStateAsUpdate(peerA.doc);
  const updateFromB = Y.encodeStateAsUpdate(peerB.doc);

  Y.applyUpdate(peerB.doc, updateFromA, REMOTE_ORIGIN);
  Y.applyUpdate(peerA.doc, updateFromB, REMOTE_ORIGIN);

  const listA = peerA.getElements();
  const listB = peerB.getElements();

  assert.equal(listA.length, 3);
  assert.equal(listB.length, 3);
  assert.deepEqual(
    listA.map((e) => ({ id: e.id, text: e.text, x: e.x })),
    listB.map((e) => ({ id: e.id, text: e.text, x: e.x })),
  );

  peerA.destroy();
  peerB.destroy();
});

test('UndoManager only reverts local edits and preserves remote collaborator changes', () => {
  const peerA = new BoardCRDT();
  const peerB = new BoardCRDT();

  peerA.upsertElement(sampleNode('a1', 'Local A'), LOCAL_ORIGIN);
  const deltaA = Y.encodeStateAsUpdate(peerA.doc);
  Y.applyUpdate(peerB.doc, deltaA, REMOTE_ORIGIN);

  // Peer B creates a remote element and syncs to Peer A
  peerB.upsertElement(sampleNode('b1', 'Remote B'), LOCAL_ORIGIN);
  const deltaB = Y.encodeStateAsUpdate(peerB.doc, Y.encodeStateVector(peerA.doc));
  Y.applyUpdate(peerA.doc, deltaB, REMOTE_ORIGIN);

  assert.equal(peerA.getElements().length, 2);

  // Peer A presses Undo -> only a1 should disappear; b1 from remote peer remains intact
  assert.equal(peerA.undo(), true);
  assert.deepEqual(
    peerA.getElements().map((e) => e.id),
    ['b1'],
  );

  // Peer A presses Redo -> a1 returns
  assert.equal(peerA.redo(), true);
  assert.equal(peerA.getElements().length, 2);

  peerA.destroy();
  peerB.destroy();
});

test('seedIfEmpty is idempotent and does not overwrite existing synced elements', () => {
  const board = new BoardCRDT();
  const seed = [sampleNode('seed-1', 'Starter')];

  assert.equal(board.seedIfEmpty(seed), true);
  assert.equal(board.getElements().length, 1);

  // Calling seedIfEmpty again does nothing
  assert.equal(board.seedIfEmpty([sampleNode('seed-2', 'Duplicate')]), false);
  assert.equal(board.getElements().length, 1);
  assert.equal(board.getElements()[0].id, 'seed-1');

  board.destroy();
});

test('deleting a node automatically detaches bound arrows without corrupting them', () => {
  const board = new BoardCRDT();
  const n1 = sampleNode('n1', 'Start', 0);
  const n2 = sampleNode('n2', 'End', 300);
  const arrow: BoardElement = {
    ...sampleNode('arr', 'Link', 0),
    type: 'arrow',
    points: [
      { x: 140, y: 35 },
      { x: 300, y: 35 },
    ],
    startBinding: { elementId: 'n1', side: 'right' },
    endBinding: { elementId: 'n2', side: 'left' },
  };
  board.upsertElements([n1, n2, arrow]);
  board.deleteElements(['n1']);

  const remainingArrow = board.getElement('arr');
  assert.ok(remainingArrow);
  assert.equal(remainingArrow.startBinding, null);
  assert.deepEqual(remainingArrow.endBinding, { elementId: 'n2', side: 'left' });

  board.destroy();
});
