# DUNGSIL's DSH Plugins

개인용 DSH 플러그인 모음

| Plugin                                                    | Description                              |
| --------------------------------------------------------- | ---------------------------------------- |
| [@dungsil/dsh-plugin-locale-ko](./packages/locale-ko)     | DSH 한국어 UI 플러그인                   |
| [@dungsil/dsh-plugin-korean-ime](./packages/korean-ime)   | 한국어 IME Enter 처리 구성 요소          |
| [@dungsil/dsh-plugin-yoonmoon](./packages/yoonmoon)       | 한국어 윤문·교정·문체 변환 스킬 플러그인 |
| [@dungsil/dsh-plugin-i-have-adhd](./packages/i-have-adhd) | ADHD 친화적 응답 스킬 플러그인           |

## 릴리스

`main`의 Conventional Commits를 분석하여 패키지별 버전과 변경 이력을 자동으로 관리합니다.
changeset 작성이나 별도의 버전 PR은 필요하지 않습니다.

1. `feat(locale-ko): 번역 추가`처럼 변경 내용을 커밋하고 `main`에 병합합니다.
   Squash merge를 사용한다면 최종 커밋 메시지가 되는 PR 제목에도 이 형식을 사용합니다.
2. GitHub Actions에서 `main`을 대상으로 **Release**를 한 번 수동 실행합니다.
   변경된 패키지의 버전·`CHANGELOG.md`를 갱신한 뒤 npm 게시, 릴리스 커밋·패키지별 태그,
   `.tgz`가 첨부된 GitHub Release 생성을 순서대로 진행합니다.

| 커밋                                                  | 버전 증가                              |
| ----------------------------------------------------- | -------------------------------------- |
| `fix`, `perf`, `revert`                               | patch                                  |
| `feat`                                                | minor                                  |
| `feat!`, `fix!` 등 `!` 또는 본문의 `BREAKING CHANGE:` | major                                  |
| `docs`, `test`, `chore`, `ci` 등                      | breaking change가 없으면 배포하지 않음 |

대상 패키지는 scope 문자열이 아니라 **커밋에서 실제로 수정한 패키지 디렉터리**로 결정합니다.
여러 패키지를 수정한 커밋은 각각에 반영하고, 루트 문서나 CI만 수정한 커밋은 플러그인을 배포하지 않습니다.
새 패키지는 `0.0.0`에서 시작하면 첫 `feat` 커밋으로 `0.1.0`을 배포합니다.
기존 `locale-ko`는 `v0.3.1` 이력을 이어받고, 이후 태그는 `@dungsil/dsh-plugin-locale-ko@0.4.0` 형식을 사용합니다.
private 패키지는 배포 대상에서 제외합니다.

`pnpm release --dry-run`으로 게시·커밋·태그 생성 없이 예정된 버전과 릴리스 노트를 확인할 수 있습니다.
배포할 커밋이 없으면 새 버전을 만들지 않습니다.

npm 게시는 패키지별 Trusted Publisher 설정이 필요합니다. 새 패키지는 최초 게시 인증도 준비해야 합니다.
