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

@AGENTS.md

<!-- END AGENT-RULES-TOOLS SHARED RULES -->
