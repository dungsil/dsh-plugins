# @dungsil/dsh-plugin-model-settings

DSH의 **세션 제목**, **Git Worktree UI의 브랜치 이름**, **윤문** 작업에 사용할 모델·추론 수준을 관리하는 기능 플러그인입니다. 소유자 전용 API와 설정 저장을 제공하며, 웹 UI는 포함하지 않습니다.

## 사용 방법

설정 화면을 사용하려면 [`@dungsil/dsh-plugin-ui-model-settings`](../ui-model-settings)를 설치합니다. UI 플러그인이 이 기능 플러그인을 함께 설치·활성화합니다. API만 필요하다면 `@dungsil/dsh-plugin-model-settings`만 설치할 수 있습니다.

기존 통합 버전에서 업데이트한 뒤에도 설정 화면을 사용하려면 UI 플러그인을 추가로 설치해야 합니다. 이미 저장한 모델 설정은 유지됩니다. 기존 `./client` export는 UI 패키지로 이동했습니다.

## API

DSH connection RPC의 `/api` 채널에서 다음 메서드를 제공합니다. 채널·메서드 접두사와 요청에 사용하는 타입은 `@dungsil/dsh-plugin-model-settings/protocol`에서 가져올 수 있습니다.

- `dungsil-model-settings/describe`: 공통 보조 모델인 `auxiliary`, 활성 제목 생성기의 `target`, 활성 Git Worktree UI의 `worktree`, 활성 윤문 플러그인의 `yoonmoon`과 제공자별 모델 목록을 반환합니다. 각 대상은 `id`, `revision`, `route`, `reasoningEffort`, `useAuxiliary`를 포함하며, 활성 대상이 없거나 여러 개이면 해당 필드는 `null`입니다. 각 모델의 `efforts`에는 지원하는 추론 수준의 `id`와 `name`이 들어 있습니다.
- `dungsil-model-settings/save`: `{ id, revision, route, reasoningEffort, useAuxiliary }`를 전달합니다. `id`로 보조 모델·제목·워크트리·윤문 대상을 구분합니다. `route`는 `{ provider, model }`이며, `null`이면 별도 모델 지정을 해제합니다. 이때 `useAuxiliary: true`이면 보조 모델을 따르고, 생략하거나 `false`이면 대화 모델을 따릅니다. `reasoningEffort`는 선택한 모델이 지원하는 수준의 ID이며, 생략하거나 `null`로 전달하면 제목은 기존 최저 수준, 워크트리와 윤문은 모델 기본값을 사용합니다. 다른 모델을 따를 때에는 추론 수준을 별도로 지정할 수 없습니다. 오래된 `revision`은 `conflict`, 지원하지 않는 추론 수준은 `reasoning_unavailable` 오류를 반환합니다.

선택한 모델은 다음 제목 생성부터 사용합니다. 이 설정은 활성 프로필 전체에 적용되며, 기존 제목이나 대화 모델은 바꾸지 않습니다. 제목 생성용 모델 호출에는 해당 제공자의 요금이 적용될 수 있습니다.

워크트리 모델·추론 수준은 활성 `@dungsil/dsh-plugin-ui-worktree`의 `provider`·`model`·`reasoningEffort` 설정에 저장합니다. 이후 브랜치 이름을 비운 생성 요청에만 사용하며, 직접 입력한 이름이나 대화 모델에는 영향을 주지 않습니다. 설정 저장 자체는 모델을 호출하지 않으며, 자동 이름 생성에는 제공자의 요금이 적용될 수 있습니다. 제목 설정과 독립적으로 저장·해제하고, 워크트리 플러그인을 설치하거나 활성화하지는 않습니다.

윤문 모델·추론 수준은 활성 `@dungsil/dsh-plugin-yoonmoon`의 `provider`·`model`·`reasoningEffort` 설정에 저장합니다. 다음 `yoonmoon` 도구 호출부터 적용하며, 대화 모델을 바꾸지 않고 글다듬기·진단만 별도 호출합니다. 윤문 플러그인이 하나만 활성화되어 있을 때 표시하며 제목 생성기 없이도 설정할 수 있습니다. 자동 추론 수준은 모델 기본값을 사용합니다. 다른 작업과 마찬가지로 `route: null, useAuxiliary: true`는 보조 모델과 추론 수준을 따르고, `route: null, useAuxiliary: false`는 대화 모델만 따르며 대화의 추론 수준은 상속하지 않습니다.

## 동작과 호환성

- DSH `0.2.1-rc.5` 이상 `0.3.0` 미만을 지원합니다. DSH의 `configEditor`, `llm`, `connection` 서비스가 필요하며 웹 설정 UI는 필요하지 않습니다.
- 활성 상태인 `@deepseek-ai/dsh-session-title-first-prompt-llm` 또는 `@deepseek-ai/dsh-session-title-all-prompts-llm`의 `provider`·`model` 설정을 편집합니다. 사용자 지정 entry ID도 지원합니다.
- DSH의 설정 편집 API가 프로필 패치에 값을 저장하고 제목 생성기를 다시 로드합니다. 제목 생성 방식, 길이·토큰 제한, 타임아웃은 유지합니다. 변경 시 진행 중인 제목 생성은 DSH의 수명주기에 따라 취소될 수 있습니다.
- 추론 수준은 이 플러그인의 `titleReasoning` 설정에 제목 생성기 ID와 모델을 함께 저장합니다. 제목 생성기의 LLM 호출을 준비할 때 적용하므로 지원 여부 검증, 요청 로그, 실제 요청에 동일한 수준이 반영됩니다. 대화 요청에는 적용하지 않으며, 제목 모델을 다른 곳에서 변경하면 기존 모델에 저장한 수준은 적용하지 않습니다.
- **대화 모델 따르기**는 두 모델 필드와 추론 수준 지정을 제거하여 DSH가 기록한 대화 요청의 모델을 사용하게 합니다. 별도 설정 파일이나 스트림 변경은 사용하지 않습니다.
- 지원하는 제목 생성기가 없거나 여러 개가 동시에 활성화된 경우 제목 모델 저장을 제공하지 않습니다. 워크트리 모델은 제목 생성기 없이도 저장할 수 있습니다. 다른 창에서 설정을 변경했다면 새로고침 후 다시 저장해야 합니다. 상위 설정이 강제하는 값은 DSH가 변경을 거절할 수 있습니다.

설정 API는 인증된 소유자만 접근할 수 있습니다. 플러그인을 제거해도 제목 생성기에 저장한 모델 설정은 유지되지만 추론 수준은 DSH의 기존 최저 수준 동작으로 돌아갑니다. 제거 전에 **대화 모델 따르기**로 저장하면 별도 모델 지정을 해제할 수 있습니다.
