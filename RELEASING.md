# 릴리즈

GitHub Actions **Release → Run workflow → main**으로 릴리즈한다. 기존 CI는
변경하지 않는다. 릴리즈는 별도 `workflow_dispatch` 워크플로에서
GitHub 공식 `actions/github-script`가 설치된 semantic-release와 기성 플러그인을
호출하여 처리한다. `gh api`나 비공식 릴리즈 래퍼 Action은 사용하지 않는다.
Push, 태그, PR은 릴리즈를 시작하지 않으며, 동시 릴리즈는 직렬화한다.

`workflow_dispatch`는 `on:`의 `branches` 필터를 지원하지 않는다.
따라서 `main` 제한은 job의 `if: github.ref == 'refs/heads/main'`으로 적용한다.
다른 브랜치를 선택하면 릴리즈 job을 건너뛴다.

## 최초 설정

1. 저장소 **Settings → General → Releases → Enable release immutability**를 켠다.
2. 이 저장소에 접근할 수 있는 fine-grained PAT를 Actions secret
   **`RELEASE_TOKEN`**으로 등록한다. 필요한 repository permissions는
   **Contents: Read and write**, **Administration: Read-only**이다.
   `GITHUB_TOKEN`은 불변 릴리즈 설정 조회에 필요한 Administration 권한이 없어
   대신 사용할 수 없다. 토큰은 `main`에 릴리즈 커밋을 push할 수 있어야 한다.
   브랜치 보호 규칙을 사용하는 경우 릴리즈 주체의 push를 허용해야 한다.

설정 조회에 실패하거나 불변 릴리즈가 비활성화되어 있으면, 파일·태그·릴리즈를
변경하기 전에 실패한다. 기존의 가변 릴리즈는 이 설정으로 소급 변경되지 않는다.

## 자동 버전 및 변경 기록

저장소 전체에 하나의 `vX.Y.Z` 버전을 사용한다. semantic-release가 마지막
릴리즈 태그 이후의 Conventional Commits를 분석한다. 현재 기준 태그는 `v0.1.1`이다.

| 커밋                                                    | 버전 변경   |
| ------------------------------------------------------- | ----------- |
| `fix: ...`, `perf: ...`                                 | patch       |
| `feat: ...`                                             | minor       |
| `feat!: ...` 등 `!` 표기 또는 `BREAKING CHANGE:` footer | major       |
| `docs: ...`, `chore: ...`, `ci: ...`, `test: ...` 등    | 릴리즈 없음 |

여러 커밋이 있으면 가장 큰 변경을 선택한다. Squash merge 시에는 PR 제목과
본문이 최종 Conventional Commit이 되도록 작성한다. 릴리즈 대상 변경이 없으면
버전·태그·CHANGELOG·GitHub Release를 만들지 않고 성공으로 종료한다.

기성 semantic-release 플러그인을 설정하여 처리한다. 별도 릴리즈 스크립트는 없다.

1. 기존 CI의 `pnpm check`를 통과해야 한다.
2. `@semantic-release/changelog`가 루트 `CHANGELOG.md`를 작성하고,
   `@semantic-release/npm`이 플러그인의 `package.json` 버전을 갱신한다.
   `npmPublish: false`로 npm registry 게시를 막는다.
3. `@semantic-release/exec`가 기존 CI의 `pnpm --filter ... pack` 명령을 실행한다.
   npm pack은 저장소의 pnpm 전용 `devEngines` 설정과 충돌하므로 사용하지 않는다.
4. `@semantic-release/git`이 CHANGELOG와 패키지 버전을 `main`에 커밋하고,
   semantic-release가 그 커밋에 버전 태그를 만든다.
5. `@semantic-release/github`이 draft release에 패키지를 업로드한 후 공개한다.
   사전에 확인한 저장소의 불변 릴리즈 설정이 태그와 파일을 보호한다.
   `actions/github-script`의 인증된 GitHub 클라이언트로 해당 태그의
   `immutable: true`를 다시 확인한다.

GitHub의 불변성은 **태그와 첨부 파일**에 적용된다. 릴리즈 제목과 본문은 GitHub
정책상 편집할 수 있다. 게시된 릴리즈의 태그를 이동하거나 파일을 덮어쓰지 말고,
변경이 필요하면 새 커밋과 새 버전을 릴리즈한다.

태그 생성 이후 업로드/게시 단계가 실패했다면 자동 재실행으로 복구되지 않을 수 있다.
해당 실행의 draft release와 태그를 확인하고, 같은 태그의 검증된 패키지를 모두
첨부한 뒤 draft를 공개한다. 게시된 불변 릴리즈를 삭제하거나 태그를 재사용하지 않는다.
