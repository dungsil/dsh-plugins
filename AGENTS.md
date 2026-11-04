# Repository Guidelines

## Versioning Policy

- 버전 변경은 CI가 수행합니다. 에이전트는 버전을 수동으로 변경하지 않습니다.
- CI는 다음 기준으로 버전을 변경합니다.
  - 0.x 버전에서는 breaking change가 있어도 메이저 버전을 올리지 않고 마이너 버전을 올립니다.
  - 일반 기능 추가는 마이너 버전, 버그 수정은 패치 버전을 올립니다.
  - 1.x 이상에서는 breaking change가 있으면 메이저 버전을 올립니다.

## UI Guidelines

- UI는 기존 dsh와 같은 look and feel을 유지합니다.
- 기존 dsh의 컴포넌트와 스타일을 우선 재사용하여 시각적 표현과 상호작용을 일관되게 구현합니다.
- 자체 UI 컨트롤 아이콘은 `tools/ui/src/icons/`에 아이콘별 SVG 파일로 두고, 클라이언트 빌드에서 인라인합니다. DSH가 제공하는 아이콘은 기존 공통 컴포넌트를 재사용합니다.
- 자체 UI 아이콘의 루트에는 `xmlns="http://www.w3.org/2000/svg"`, `width="16"`, `height="16"`, `viewBox="0 0 16 16"`, `aria-hidden="true"`를 명시합니다. 모든 도형은 같은 16×16 좌표계 안에 작성하며, 사용처의 표시 크기는 CSS나 컴포넌트 속성으로 조절하고 원본 크기나 `viewBox`는 변경하지 않습니다.
- 자체 UI 아이콘은 투명한 배경과 `currentColor`를 사용합니다. 선형 아이콘은 `fill="none"`으로 작성하고 기존 DSH 아이콘과 어울리는 선 두께와 여백을 유지합니다. 아이콘만 있는 컨트롤의 접근성 이름은 SVG가 아니라 해당 버튼에 지정합니다.

## Documentation Policy

- 사용자가 명시적으로 요청하거나 작업 요구사항에서 산출물로 지정한 경우에만 새 문서 파일을 만듭니다. Markdown 파일도 이 규칙을 따릅니다.
- 작업 계획, 진행 상황, 변경 요약, 검증 결과를 남기기 위한 별도 문서 파일을 만들지 않습니다. 파일 형식이나 확장자를 바꿔서 이 제한을 우회하지 않습니다.
- 문서 수정이 필요하면 기존 문서를 우선 수정합니다. 작업 보고와 검증 결과는 대화 응답이나 사용자가 요청한 PR 본문에 작성합니다.

## Implementation Completion Checklist

구현을 마친 뒤 다음 항목을 확인합니다. 실제로 확인한 항목만 완료로 표시합니다.

- [ ] 추가하거나 변경한 UI 문구에 영어, 한국어, 중국어 로케일이 모두 있는지 확인합니다. 각 로케일의 번역 키와 번역문이 빠지지 않았는지 검사합니다.
- [ ] 최신 구현으로 플러그인을 빌드합니다. 플러그인 검증은 항상 현재 작업 세션과 분리된 검증용 `web` 프로필에서 수행합니다. 현재 작업 세션의 번들은 변경하거나 제거하지 않습니다. 검증용 프로필에 최신 빌드 결과를 설치하고 활성화한 뒤, 해당 결과를 불러왔는지 확인합니다.
- [ ] 실제 dsh 세션에서 변경한 기능을 실행하여 화면과 동작을 확인합니다. UI 변경은 기존 dsh의 look and feel과 일치하는지도 확인합니다.
- [ ] 영어, 한국어, 중국어로 각각 전환하여 변경한 UI 문구가 올바르게 표시되는지 확인합니다.
- [ ] 검증에 사용한 dsh 버전, 세션, 확인 절차와 결과를 대화 응답이나 사용자가 요청한 PR 본문에 기록합니다. 검증 기록용 문서 파일은 만들지 않습니다. 확인하지 못한 항목은 사유와 함께 남기며, 자동 테스트 통과만으로 실제 세션 검증을 완료했다고 표시하지 않습니다.

## Commit Message Convention

<!-- Adapted from https://www.conventionalcommits.org/en/v1.0.0/ (Conventional Commits contributors, CC BY 3.0: https://creativecommons.org/licenses/by/3.0/). Korean project-specific rules were added. -->

- Conventional Commits 형식을 따릅니다: `<type>(<scope>): <subject>`
- 사용 가능한 `type`은 `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `chore`, `revert`입니다.
- `subject`는 한국어 평서문으로 작성하고, 80자 이내로 제한하며, 끝에 마침표를 찍지 않습니다.
- `scope`는 선택 사항입니다. 영문 소문자로 모듈이나 도메인 이름을 사용합니다(예: `auth`, `api`, `ui`).
- 커밋 제목에는 이슈 번호를 포함하지 않습니다.
- `body`에는 파일 목록이 아니라 변경이 필요한 이유(WHY)를 설명하고, 줄당 120자 이내로 줄바꿈합니다. `subject`만으로 충분히 설명된다면 생략할 수 있습니다.
- 호환성을 깨뜨리는 변경에는 `type` 뒤에 `!`를 추가하고(예: `feat!:`), `body`에 마이그레이션 방법을 설명합니다.
- `revert` 커밋은 `body`에 원본 커밋의 해시를 반드시 명시합니다.

## Pull Request Convention

- PR 제목은 [Commit Message Convention](#commit-message-convention)을 따릅니다.
- PR 본문은 한국어로 작성하며, [.github/pull_request_template.md](.github/pull_request_template.md) 템플릿을 따릅니다.
