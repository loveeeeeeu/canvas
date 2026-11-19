import * as Y from 'yjs';
import type { BoardElement } from '../types/board';

export const LOCAL_ORIGIN = 'local-user';
export const REMOTE_ORIGIN = 'remote-peer';
export const SYSTEM_ORIGIN = 'system-seed';

export class BoardCRDT {
  public readonly doc: Y.Doc;
  public readonly elementsMap: Y.Map<BoardElement>;
  public readonly metaMap: Y.Map<unknown>;
  public readonly undoManager: Y.UndoManager;

  constructor(doc?: Y.Doc) {
    this.doc = doc ?? new Y.Doc();
    this.elementsMap = this.doc.getMap<BoardElement>('elements');
    this.metaMap = this.doc.getMap<unknown>('meta');
    this.undoManager = new Y.UndoManager(this.elementsMap, {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: 350,
    });
  }

  /** Returns all elements sorted deterministically by zIndex then id */
  getElements(): BoardElement[] {
    const items: BoardElement[] = [];
    this.elementsMap.forEach((el) => {
      if (el && el.id) {
        items.push(el);
      }
    });
    return items.sort((a, b) => {
      if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
      return a.id.localeCompare(b.id);
    });
  }

  getElement(id: string): BoardElement | undefined {
    return this.elementsMap.get(id);
  }

  getNextZIndex(): number {
    let maxZ = 0;
    this.elementsMap.forEach((el) => {
      if (el && el.zIndex > maxZ) maxZ = el.zIndex;
    });
    return maxZ + 1;
  }

  upsertElement(element: BoardElement, origin: string = LOCAL_ORIGIN): void {
    this.doc.transact(() => {
      this.elementsMap.set(element.id, { ...element, updatedAt: Date.now() });
    }, origin);
  }

  upsertElements(elements: BoardElement[], origin: string = LOCAL_ORIGIN): void {
    if (elements.length === 0) return;
    const now = Date.now();
    this.doc.transact(() => {
      for (const el of elements) {
        this.elementsMap.set(el.id, { ...el, updatedAt: now });
      }
    }, origin);
  }

  patchElement(
    id: string,
    patch: Partial<BoardElement>,
    origin: string = LOCAL_ORIGIN,
  ): BoardElement | null {
    const current = this.elementsMap.get(id);
    if (!current) return null;
    const updated: BoardElement = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: Date.now(),
    };
    this.doc.transact(() => {
      this.elementsMap.set(id, updated);
    }, origin);
    return updated;
  }

  deleteElements(ids: string[], origin: string = LOCAL_ORIGIN): void {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    this.doc.transact(() => {
      for (const id of ids) {
        this.elementsMap.delete(id);
      }
      // Clean up arrow bindings pointing to deleted elements so arrows stay valid
      this.elementsMap.forEach((el, key) => {
        if (el.type === 'arrow') {
          const startGone = el.startBinding && idSet.has(el.startBinding.elementId);
          const endGone = el.endBinding && idSet.has(el.endBinding.elementId);
          if (startGone || endGone) {
            this.elementsMap.set(key, {
              ...el,
              startBinding: startGone ? null : el.startBinding,
              endBinding: endGone ? null : el.endBinding,
              updatedAt: Date.now(),
            });
          }
        }
      });
    }, origin);
  }

  /**
   * Idempotently seeds starter elements only if the document has never been initialized
   * and currently has no elements. Prevents duplicate nodes when two tabs join concurrently.
   */
  seedIfEmpty(templateElements: BoardElement[]): boolean {
    if (this.metaMap.get('seeded') === true || this.elementsMap.size > 0) {
      return false;
    }
    this.doc.transact(() => {
      if (this.metaMap.get('seeded') === true || this.elementsMap.size > 0) {
        return;
      }
      this.metaMap.set('seeded', true);
      for (const el of templateElements) {
        this.elementsMap.set(el.id, { ...el });
      }
    }, SYSTEM_ORIGIN);
    return true;
  }

  /**
   * Replaces all elements with a new template or imported scene (recorded as undoable local transaction).
   */
  replaceAllElements(elements: BoardElement[], origin: string = LOCAL_ORIGIN): void {
    this.doc.transact(() => {
      this.metaMap.set('seeded', true);
      const existingKeys = Array.from(this.elementsMap.keys());
      for (const key of existingKeys) {
        this.elementsMap.delete(key);
      }
      for (const el of elements) {
        this.elementsMap.set(el.id, { ...el });
      }
    }, origin);
  }

  bringToFront(ids: string[]): void {
    let nextZ = this.getNextZIndex();
    this.doc.transact(() => {
      for (const id of ids) {
        const el = this.elementsMap.get(id);
        if (el) {
          this.elementsMap.set(id, { ...el, zIndex: nextZ++, updatedAt: Date.now() });
        }
      }
    }, LOCAL_ORIGIN);
  }

  sendToBack(ids: string[]): void {
    let minZ = Infinity;
    this.elementsMap.forEach((el) => {
      if (el && el.zIndex < minZ) minZ = el.zIndex;
    });
    let nextZ = Number.isFinite(minZ) ? minZ - ids.length : 0;
    this.doc.transact(() => {
      for (const id of ids) {
        const el = this.elementsMap.get(id);
        if (el) {
          this.elementsMap.set(id, { ...el, zIndex: nextZ++, updatedAt: Date.now() });
        }
      }
    }, LOCAL_ORIGIN);
  }

  undo(): boolean {
    if (!this.undoManager.canUndo()) return false;
    this.undoManager.undo();
    return true;
  }

  redo(): boolean {
    if (!this.undoManager.canRedo()) return false;
    this.undoManager.redo();
    return true;
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  /** Decodes the Yjs vector clock for live CRDT inspection */
  getStateVectorEntries(): Array<{ clientId: number; clock: number }> {
    const sv = Y.decodeStateVector(Y.encodeStateVector(this.doc));
    const entries: Array<{ clientId: number; clock: number }> = [];
    sv.forEach((clock, clientId) => {
      entries.push({ clientId, clock });
    });
    return entries.sort((a, b) => b.clock - a.clock);
  }

  destroy(): void {
    this.undoManager.destroy();
    this.doc.destroy();
  }
}
