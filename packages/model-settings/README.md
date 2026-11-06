# @dungsil/dsh-plugin-model-settings

DSH 작업 플러그인이 등록한 모델·추론 수준·지침을 관리하는 기능 플러그인입니다. 공통 보조 모델, 선택적 작업 등록 서비스, 소유자 전용 API와 설정 저장을 제공하며 웹 UI는 포함하지 않습니다. **Git Worktree UI의 브랜치 이름**과 **윤문**은 공개 계약으로 참여하고, 외부 **세션 제목** 생성기는 호환 어댑터로 연결합니다.

## 사용 방법

설정 화면을 사용하려면 [`@dungsil/dsh-plugin-ui-model-settings`](../ui-model-settings)를 설치합니다. UI 플러그인이 이 기능 플러그인을 함께 설치·활성화합니다. API만 필요하다면 `@dungsil/dsh-plugin-model-settings`만 설치할 수 있습니다.

기존 통합 버전에서 업데이트한 뒤에도 설정 화면을 사용하려면 UI 플러그인을 추가로 설치해야 합니다. 이미 저장한 모델 설정은 유지됩니다. 기존 `./client` export는 UI 패키지로 이동했습니다.

## PowerShell 추가 지침

**설정 → 상황 별 모델 및 지침 → 도구 지침 → PowerShell (pwsh)**에서 추가 지침을 저장합니다. 예를 들어 `description은 현재 사용자 요청의 언어로 작성한다`를 입력할 수 있습니다. 저장된 `pwshInstructions`는 활성 프로필의 다음 대화 요청부터 기본 도구 규칙과 함께 적용하며, 기존 호출 설명은 변경하지 않습니다. 빈 값으로 저장하면 해제합니다.

이 항목은 별도 모델을 호출하거나 대화 모델을 변경하지 않으며, 보조 모델의 공통 지침도 상속하지 않습니다. 기본 도구 설명·안전 규칙을 대체하거나 실행 권한을 변경하지 않습니다. 모델이 설명을 작성하는 방식을 유도할 뿐 언어를 강제하지는 않습니다. 프롬프트 적용에는 선택적 `systemPrompt` 서비스가 필요합니다.

## 작업 플러그인의 공개 계약

`@dungsil/dsh-plugin-model-settings/contract`에서 `TaskDefinition`, `TaskSettings`, `TaskRegistration` 타입을 가져옵니다. 타입 전용 참조이므로 이 기능 플러그인을 설치·활성화하지 않아도 작업 플러그인은 단독으로 동작할 수 있습니다.

작업 플러그인은 기존 필수 `inject`를 유지하고 선택적 자식 연결에서 등록합니다. `definition`은 안정적인 작업 `key`, 영어·한국어·중국어 표시 문구, 설정의 순수 `read`·`write` 변환, 현재 기본 프롬프트를 제공합니다. 전체 타입은 [공개 계약](./src/contract.ts)을 참고합니다.

```ts
let registration: TaskRegistration | undefined
ctx.inject(['dungsilModelSettings'], (child) => {
  const current = child.dungsilModelSettings.register(ctx, definition)
  registration = current
  child.effect(() => () => {
    current.dispose()
    if (registration === current) registration = undefined
  })
})
```

등록 owner에는 원래 플러그인의 Context를 전달합니다. 작업은 프로필의 고유 entry에 속해야 하며 같은 entry·key의 중복 등록은 거부합니다. 다른 entry에서 같은 작업을 등록하는 것은 허용합니다. 중앙 API와 UI에 작업 이름을 추가할 필요는 없습니다.

실제 호출 직전에 `registration.resolve(conversationRoute)`를 호출합니다. 반환값의 `route`·`reasoningEffort`를 LLM 준비에 명시적으로 전달하고, `instructions`의 작업별 변수를 직접 치환한 뒤 `additionalInstructions`를 붙입니다. 추론 수준이 `null`이면 기존 작업의 자동 정책을 유지합니다. 중앙 서비스는 참여 작업의 LLM 서비스나 프롬프트를 가로채지 않습니다. `kind: 'instructions'` 작업은 지침만 편집하며 모델 선택 저장을 거부합니다. 해당 작업의 지침 적용은 소유 플러그인이 담당합니다. 서비스가 없으면 작업의 기존 명시적 모델 또는 대화 모델과 로컬 지침으로 동작해야 합니다.

설정 저장은 중앙 서비스가 `configEditor.edit`로 조정하지만 설정 형식은 해당 플러그인이 소유합니다. `write`는 최신 config에서 자기 필드만 바꾸고 나머지를 보존해야 합니다. 이미 시작한 호출은 resolve 시점의 스냅샷을 사용하고, 재등록된 작업의 이전 revision은 쓰기에 사용할 수 없습니다.

## API V2

DSH connection RPC의 소유자 전용 `/api` 채널에 다음 메서드를 제공합니다.

- `dungsil-model-settings/v2/describe`: `{ auxiliary, tasks, providers, catalogError }`를 반환합니다. 작업은 불투명한 `id`, `revision`, `key`, `owner`, 다국어 표시 문구, `selection`, `instructions`, `defaultInstructions`를 포함합니다. `tasks`는 제공자 패키지·entry·key 순서로 정렬합니다.
- `dungsil-model-settings/v2/save`: `{ id, revision, selection }`으로 모델 선택만 변경하고 최신 작업 스냅샷을 반환합니다. `selection`은 `{ mode: 'conversation' }`, `{ mode: 'auxiliary' }`, `{ mode: 'model', route: { provider, model }, reasoningEffort: string | null }` 중 하나입니다. 보조 설정 자신은 `auxiliary`를 선택할 수 없습니다.
- `dungsil-model-settings/v2/instructions`: `{ id, revision, instructions }`으로 지침만 변경합니다. 빈 문자열이나 현재 기본값은 사용자 지정을 해제합니다. 모델 카탈로그를 조회할 수 없어도 지침은 저장할 수 있습니다.

보조 모델 따르기는 보조 모델이 미지정이어도 공통 추가 지침을 상속합니다. 대화 모델 따르기와 명시적 모델은 공통 추가 지침을 상속하지 않습니다. 대화의 추론 수준은 상속하지 않으며 모델을 사용할 수 없다고 다른 모델로 자동 변경하지 않습니다.

공통 보조 설정과 외부 제목 확장 설정을 저장하면 서비스가 재등록될 수 있으므로 UI는 성공 후에도 작업 revision을 다시 조회합니다. 저장 결과가 불확실할 때에는 자동 재시도하지 않고 조회로 상태를 확인해야 합니다.

## 구형 API 호환

DSH connection RPC의 `/api` 채널에서 다음 메서드를 제공합니다. 채널·메서드 접두사와 요청에 사용하는 타입은 `@dungsil/dsh-plugin-model-settings/protocol`에서 가져올 수 있습니다.

- `dungsil-model-settings/describe`: 공통 보조 모델인 `auxiliary`, 활성 제목 생성기의 `target`, 활성 Git Worktree UI의 `worktree`, 활성 윤문 플러그인의 `yoonmoon`과 제공자별 모델 목록을 반환합니다. 각 대상은 `id`, `revision`, `route`, `reasoningEffort`, `useAuxiliary`, `instructions`, `defaultInstructions`를 포함하며, 활성 대상이 없거나 여러 개이면 해당 필드는 `null`입니다. `instructions`는 저장된 프롬프트 또는 현재 기본값이며 `defaultInstructions`는 복원할 기본 프롬프트입니다. 각 모델의 `efforts`에는 지원하는 추론 수준의 `id`와 `name`이 들어 있습니다.
- `dungsil-model-settings/save`: `{ id, revision, route, reasoningEffort, useAuxiliary }`를 전달합니다. `id`로 보조 모델·제목·워크트리·윤문 대상을 구분합니다. `route`는 `{ provider, model }`이며, `null`이면 별도 모델 지정을 해제합니다. 이때 `useAuxiliary: true`이면 보조 모델을 따르고, 생략하거나 `false`이면 대화 모델을 따릅니다. `reasoningEffort`는 선택한 모델이 지원하는 수준의 ID이며, 생략하거나 `null`로 전달하면 제목은 기존 최저 수준, 워크트리와 윤문은 모델 기본값을 사용합니다. 다른 모델을 따를 때에는 추론 수준을 별도로 지정할 수 없습니다. 오래된 `revision`은 `conflict`, 지원하지 않는 추론 수준은 `reasoning_unavailable` 오류를 반환합니다.
- `dungsil-model-settings/instructions`: `{ id, revision, instructions }`를 전달하여 해당 대상의 프롬프트만 저장합니다. 앞뒤 공백을 제거하며 빈 문자열이나 현재 기본값을 저장하면 사용자 지정을 해제하여 기본 프롬프트를 복원합니다. 모델·추론 수준은 유지하고, 오래된 `revision`은 `conflict` 오류를 반환합니다. 모델 목록을 불러오지 못하거나 저장된 모델을 사용할 수 없어도 지침을 수정할 수 있습니다.

Worktree·윤문의 지침과 상속 선택은 각 플러그인의 `modelSettings`에 저장합니다. 기존 중앙 `instructions`·`inheritAuxiliary` 값은 읽기 호환으로 유지하며 해당 작업의 첫 저장에서만 새 위치로 이전합니다. 이후에는 새 설정만 읽으므로 기본 지침을 복원해도 구형 사용자 지침이 되살아나지 않습니다. 구형 중앙 값을 자동으로 삭제하거나 이중 쓰기하지는 않습니다. 이전 버전으로 되돌릴 경우 최신 지침·상속 변경까지 동기화되지는 않습니다. 제목 지침과 공통 추가 지침은 기존 중앙 저장 위치를 유지합니다.

다음 작업 호출부터 기본 시스템 프롬프트를 대체하며 일반 대화에는 적용하지 않습니다. 제목은 현재 길이 설정과 생성 방식에 맞는 원문을 표시하며 all-prompts의 기존 제목 유지 규칙도 포함합니다. 워크트리는 현재 이름 생성 방식에 맞는 원문을 표시합니다. 윤문은 `{{skill}}`과 `{{resources}}`를 실행할 스킬과 내장 자료로 치환하는 기본 템플릿을 표시합니다. 보조 모델에는 고유한 기본 프롬프트가 없으며 **보조 모델 따르기**인 작업의 프롬프트 뒤에 공통 추가 지침으로 적용합니다. 모델을 변경해도 저장된 프롬프트는 유지합니다.

선택한 모델은 다음 제목 생성부터 사용합니다. 이 설정은 활성 프로필 전체에 적용되며, 기존 제목이나 대화 모델은 바꾸지 않습니다. 제목 생성용 모델 호출에는 해당 제공자의 요금이 적용될 수 있습니다.

워크트리 모델·추론 수준은 활성 `@dungsil/dsh-plugin-ui-worktree`의 `provider`·`model`·`reasoningEffort` 설정에 저장합니다. 이후 브랜치 이름을 비운 생성 요청에만 사용하며, 직접 입력한 이름이나 대화 모델에는 영향을 주지 않습니다. 설정 저장 자체는 모델을 호출하지 않으며, 자동 이름 생성에는 제공자의 요금이 적용될 수 있습니다. 제목 설정과 독립적으로 저장·해제하고, 워크트리 플러그인을 설치하거나 활성화하지는 않습니다.

윤문 모델·추론 수준은 활성 `@dungsil/dsh-plugin-yoonmoon`의 `provider`·`model`·`reasoningEffort` 설정에 저장합니다. 다음 `yoonmoon` 도구 호출부터 적용하며, 대화 모델을 바꾸지 않고 글다듬기·진단만 별도 호출합니다. 구형 API는 윤문 플러그인이 하나만 활성화되어 있을 때 노출하며, V2 API와 UI는 여러 entry를 개별 표시합니다. 제목 생성기 없이도 설정할 수 있습니다. 자동 추론 수준은 모델 기본값을 사용합니다. 다른 작업과 마찬가지로 `route: null, useAuxiliary: true`는 보조 모델과 추론 수준을 따르고, `route: null, useAuxiliary: false`는 대화 모델만 따르며 대화의 추론 수준은 상속하지 않습니다.

## 동작과 호환성

- DSH `0.2.2-rc.1` 이상 `0.3.0` 미만을 지원합니다. DSH의 `configEditor`, `llm`, `connection` 서비스가 필요하며 웹 설정 UI는 필요하지 않습니다. 실행 중인 설정은 Cordis `4.1.0`의 `effectiveConfig`로 읽으며 DSH `0.2.1-rc.5`는 지원하지 않습니다.
- 활성 상태인 `@deepseek-ai/dsh-session-title-first-prompt-llm` 또는 `@deepseek-ai/dsh-session-title-all-prompts-llm`의 `provider`·`model` 설정을 편집합니다. 사용자 지정 entry ID도 지원합니다.
- DSH의 설정 편집 API가 프로필 패치에 값을 저장하고 제목 생성기를 다시 로드합니다. 제목 생성 방식, 길이·토큰 제한, 타임아웃은 유지합니다. 변경 시 진행 중인 제목 생성은 DSH의 수명주기에 따라 취소될 수 있습니다.
- 추론 수준은 이 플러그인의 `titleReasoning` 설정에 제목 생성기 ID와 모델을 함께 저장합니다. 제목 생성기의 LLM 호출을 준비할 때 적용하므로 지원 여부 검증, 요청 로그, 실제 요청에 동일한 수준이 반영됩니다. 대화 요청에는 적용하지 않으며, 제목 모델을 다른 곳에서 변경하면 기존 모델에 저장한 수준은 적용하지 않습니다.
- **대화 모델 따르기**는 두 모델 필드와 추론 수준 지정을 제거하여 DSH가 기록한 대화 요청의 모델을 사용하게 합니다. 해당 작업에 저장한 지침은 계속 적용하며 별도 설정 파일은 사용하지 않습니다.
- 지원하는 제목 생성기가 없거나 여러 개가 동시에 활성화된 경우 제목 모델 저장을 제공하지 않습니다. 워크트리 모델은 제목 생성기 없이도 저장할 수 있습니다. 다른 창에서 설정을 변경했다면 새로고침 후 다시 저장해야 합니다. 상위 설정이 강제하는 값은 DSH가 변경을 거절할 수 있습니다.

설정 API는 인증된 소유자만 접근할 수 있습니다. 플러그인을 제거해도 제목 생성기에 저장한 모델 설정은 유지되지만 추론 수준은 DSH의 기존 최저 수준 동작으로 돌아갑니다. 제거 전에 **대화 모델 따르기**로 저장하면 별도 모델 지정을 해제할 수 있습니다.
