import type {
  AppSnapshot,
  TempalistState,
} from "../../../../packages/domain/src";

export interface TempalistRepository {
  load(): Promise<AppSnapshot>;
  updateTempalist(
    update: (latest: AppSnapshot) => TempalistState,
  ): Promise<TempalistState>;
}
