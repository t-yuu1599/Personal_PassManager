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

<!-- BEGIN SHARED CONTINUITY RULES -->

<!-- AUTO-GENERATED FILE -->
<!-- Source: agent-rules/source/agent-log.md -->
<!-- Do not edit directly. -->

# Agent Log 運用ルール

共通 AI エージェント向けの作業ログ運用ルール。正本は `agent-rules/source/agent-log.md`。

## 作業開始時

- プロジェクトルートの `.agent-log/` が存在する場合、最近のログを確認する
- `.ai/PROJECT_STATE.yaml` を読む。無ければ、作業の現在地が未記録だと扱う
- `.agent-log/` の最近のログを読む
- 継続ルールは本ファイル（配布された入口）に書いてある。クラウドでもローカルでも、リポジトリ内のこのファイルを読む
- 過去の設計判断・変更理由を尊重する
- AI エージェントが変わっても `.agent-log` を引き継ぐ

## 作業終了時（実変更がある場合）

- `.agent-log/` が無ければ作成する
- ログファイル名: `YYYYMMDD-HHMM-<agent>.md`
- 以下を必ず記録する
  - Agent
  - Date
  - Task
  - Reason（なぜその変更を行ったか）
  - Changes
  - Files Changed
  - Verification
  - Remaining Issues
- 「何を変更したか」だけでなく「なぜ変更したか」を必ず書く
- 未検証事項・残課題を明記する
- `.ai/PROJECT_STATE.yaml` と、今回書いた `.agent-log/` を更新する
- 公開はフックが自動で行う（Cursor の stop / sessionEnd、Claude の Stop）。本線と作業ブランチの両方へ上がる
- フックが動かない環境（クラウド等）だけ、次を実行して完了とする

実行するフォルダ: リポジトリのルート
シェル: PowerShell

    powershell -NoProfile -ExecutionPolicy Bypass -File .ai/publish-handoff.ps1

## 禁止・注意

- 調査・質問回答・コード変更を伴わない作業ではログ不要
- 不要なブランチ作成を避ける
- 既存履歴の破壊（force push / hard reset 等）を避ける
- 通常の個人開発では main への直接変更を許可する
- ブランチを作った場合、特別な理由がなければ作業終了時に main へ反映する
- 未マージ状態を作業完了として扱わない

## 正本について

- ルール変更時は原則 `agent-rules/source/agent-log.md` のみを編集する
- 各プロジェクトへ配布された生成ファイルを直接編集しない

<!-- END SHARED CONTINUITY RULES -->

