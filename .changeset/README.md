# 릴리스 절차

패키지별 버전은 커밋 메시지가 아니라 changeset으로 결정합니다. 배포할 변경에는
`pnpm changeset`으로 대상 패키지, 버전 증가 폭, 변경 설명을 추가하고 함께 커밋합니다.
새 패키지는 `0.0.0`에서 시작하고 `minor` changeset을 추가하면 첫 버전이 `0.1.0`이 됩니다.

1. 배포할 코드와 changeset을 `main`에 병합합니다.
2. GitHub Actions에서 `main`을 대상으로 **Release** 워크플로를 수동 실행합니다.
   이 실행은 버전과 `CHANGELOG.md`를 갱신하는 `chore(release): version packages` PR을 만듭니다.
3. 버전 PR의 변경 사항을 확인하고 `main`에 병합합니다.
4. `main`을 대상으로 **Release** 워크플로를 다시 실행합니다.
   남은 changeset이 없으면 미게시 버전을 npm에 게시하고 패키지별 GitHub Release와 `.tgz`를 만듭니다.

## 성공했지만 릴리스가 없는 경우

`All changesets are empty; not creating PR`은 버전 증가 대상이 없는 changeset만
있다는 뜻입니다. 이 상태에서는 버전 PR도 npm 게시도 실행하지 않습니다.
빈 changeset은 문서나 CI처럼 배포가 필요 없는 변경에만 사용합니다.
배포할 코드가 변경됐다면 해당 패키지를 지정한 changeset을 추가합니다.

`pnpm changeset status`로 예정된 버전 증가 대상을 확인할 수 있습니다.
이미 게시한 버전만 있고 남은 changeset도 없다면 다시 실행해도 새 버전은 생기지 않습니다.

npm 게시는 패키지별 Trusted Publisher 설정이 필요합니다. 새 패키지를 최초 게시할 때는
npm 인증과 패키지 설정도 확인해야 합니다.
