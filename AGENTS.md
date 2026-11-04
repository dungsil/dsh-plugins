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
