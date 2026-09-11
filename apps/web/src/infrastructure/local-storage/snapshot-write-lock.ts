import { PersistenceError } from "../../../../../packages/domain/src";

export interface SnapshotWriteLock {
  run<T>(operation: () => T): Promise<T>;
}

export class BrowserSnapshotWriteLock implements SnapshotWriteLock {
  async run<T>(operation: () => T): Promise<T> {
    const locks = globalThis.navigator?.locks;
    if (!locks) {
      throw new PersistenceError(
        "このブラウザでは保存ロックを利用できないため、テンパリスト連携を実行できません。",
      );
    }
    return locks.request("atoqueue:snapshot-write", operation);
  }
}
