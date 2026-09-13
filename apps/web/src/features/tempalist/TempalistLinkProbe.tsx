import { buildTempalistUrl } from "../../../../../packages/domain/src";

const probeUrl = buildTempalistUrl({
  schemaVersion: 1,
  kind: "checklist-create",
  source: "atoqueue",
  requestId: "11111111-1111-4111-8111-111111111111",
  title: "試験用の買い物リスト",
  items: [
    { sourceTaskId: "probe-task-1", label: "牛乳🥛\n2本" },
    { sourceTaskId: "probe-task-2", label: "単三電池" },
  ],
});

export function TempalistLinkProbe() {
  return (
    <section aria-labelledby="tempalist-link-probe-title">
      <h1 id="tempalist-link-probe-title">!=テンパリスト連携の実機試験</h1>
      <p>固定の合成データ2件だけを!=テンパリストへ渡します。</p>
      <p>受信先で作成前の内容確認画面が表示されます。</p>
      <a href={probeUrl}>試験用リストを開く</a>
    </section>
  );
}
