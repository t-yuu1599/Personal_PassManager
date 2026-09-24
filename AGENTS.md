<!-- BEGIN SHARED PROJECT STATE RULES -->

<!-- AUTO-GENERATED FILE -->
<!-- Source: agent-rules/source/project-state.md -->
<!-- Do not edit directly. -->

# プロジェクト継続ルール

作成日: 2026-09-22  
更新日: 2026-09-22

AI エージェントが変わっても、説明なしで作業を再開できるようにする。正本は `agent-rules/source/project-state.md`。

## 現在地

- 現在地は `.ai/PROJECT_STATE.yaml` に置く
- 経緯・判断理由は `.agent-log/` に置く（形式は agent-log ルールに従う）
- Git の実態と STATE が食い違うときは、Git を優先して STATE を直す

## 作業開始時

1. `.ai/PROJECT_STATE.yaml` を読む
2. `git status` と直近コミットを確認する
3. `locked_decisions` に反する変更はしない。より良い案は提案のみし、ユーザー判断を待つ
4. `current` / `next` から作業を続ける

## 作業終了時・コンテキスト圧縮前

実変更があった場合だけ:

1. STATE を短く更新する（`current` `done` `next` `risks` `unverified` `work_context`）
2. 新しい確定判断があれば `locked_decisions` へ追加する（削除・文言変更はユーザー明示指示があるときだけ）
3. 必要なら `.agent-log/` に作業ログを書く
4. 履歴の長文やファイル差分の列挙は STATE に書かない

## STATE のキー

- `goal` / `current` / `done` / `next`
- `locked_decisions`（id と rule）
- `risks` / `unverified`
- `work_context`（branch / head / dirty など、分かる範囲で）

## 禁止

- ユーザーへの「引き継ぎを書いて」要求
- AI 単独での `locked_decisions` 削除・改変
- STATE への細かい差分・時系列履歴の蓄積

<!-- END SHARED PROJECT STATE RULES -->

<!-- BEGIN AGENT-RULES-TOOLS SHARED RULES -->
<!-- 自動生成。編集は agent-rules-tools の rules/common.md で行い、distribute.bat で配る -->

# 共通作業ルール

どのエージェント（Cursor / Codex / Claude Code など）でも、ローカルでもクラウドでも、このルールに従う。
このリポジトリの作業状況は、次の2つだけで引き継ぐ。

- `.ai/HANDOFF.md` … 本筋の現在地。全エージェントで1つ。毎回上書きする
- `.agent-log/` … エージェントごとの作業ログ。1回の作業で1ファイル追加する。過去のファイルは消さない

## 作業開始時

1. `.ai/HANDOFF.md` を読む。現在地・次にやること・決まったことはここに書いてある
2. `.agent-log/` の新しいものから2〜3件を読む
3. 最新の main を取り込む（`git pull`）。クラウドで新しく clone した場合は不要
4. main にまだ入っていない作業ブランチがあれば確認する（`git fetch origin` のあと `git branch -r --no-merged origin/main`）。見つかったら、そのブランチの `.ai/HANDOFF.md` も読む（`git show origin/<ブランチ>:.ai/HANDOFF.md`）
5. HANDOFF に「済み」「判明した」と書いてあることは調べ直さない。ただし、HANDOFF と実際のコードが違うときはコードを正しいものとして扱い、HANDOFF を直す

`.ai/HANDOFF.md` が無いときは、作業の現在地がまだ記録されていないということ。作業終了時に作る。

## 作業終了時（ファイルを変更した場合）

1. `.ai/HANDOFF.md` を今の状態に書き換える。履歴は書かない（履歴は作業ログへ）
   - 次のエージェントが同じ調査をしなくて済むように、調べて分かったこと（原因・構造・ハマりどころ）も「分かっていること」に書く
   - 秘密情報（キー、パスワード、トークン）は書かない
2. `.agent-log/YYYYMMDD-HHMM-<エージェント名>.md` を新しく作る（書き方は下の「作業ログの書式」）
3. 作業の変更と HANDOFF と作業ログを同じコミットに入れる
4. main にマージして push するまでを作業完了とする
   - プルリクエストは作らず main にマージして push する。プルリクエストはクラウドで main に push できない状況の時だけ、ユーザーに説明してから作る

調査・質問への回答だけでファイルを変更しない場合は、作業ログはいらない。
ただし、次の人が同じ調査をせずに済む結論が出たときは、HANDOFF の「分かっていること」に書いてコミットする。

## Git

- コミットメッセージはかならず日本語で書く
- 作業完了とは、main にマージして push した状態を指す。マージしていないものは完了として扱わない
- 個人開発では main への直接コミットを認める。不要なブランチは作らない
- ブランチを作ったときは、特別な理由がなければ作業終了時に main へマージする
- force push、`reset --hard`、rebase など、共有された履歴を書き換える操作はしない
- HANDOFF がコンフリクトしたら、両方の内容を読んで今の状態に合わせて書き直す。片方を捨てない

## 作業ログの書式

ファイル名は `.agent-log/YYYYMMDD-HHMM-<エージェント名>.md`（例: `20260923-1530-claude-code.md`）。

```markdown
# 作業ログ

- Agent: エージェント名とモデル名
- Date: YYYY-MM-DD HH:MM
- Task: 何を頼まれたか
- Reason: なぜその変更をしたか
- Changes: 何を変えたか
- Files Changed: 変更したファイル
- Verification: 何で確かめたか（実行したコマンドと結果）
- Remaining Issues: 確かめていないこと・残っている課題
```

「何を変えたか」だけでなく「なぜ変えたか」を必ず書く。確かめていないことは、確かめていないと書く。

## このルールについて

- この区間は agent-rules-tools の `rules/common.md` から自動で生成している。ここを直接編集しない
- このリポジトリ固有のルールは、この区間の外に書く

<!-- END AGENT-RULES-TOOLS SHARED RULES -->
