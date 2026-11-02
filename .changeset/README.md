# Changesets

각 공개 패키지는 독립적인 버전과 `CHANGELOG.md`를 갖습니다. `fixed`와 `linked`는 비워 두며,
`private: true`인 내부 도구는 버전을 올리거나 게시하지 않습니다.

## 변경 PR

플러그인의 배포가 필요한 변경에는 `pnpm changeset`으로 변경 파일을 추가합니다.
변경한 패키지만 선택하고 `patch`, `minor`, `major` 중 증가 폭과 변경 설명을 지정합니다.
커밋 메시지만으로는 버전이 올라가지 않으며, 배포가 필요 없는 문서·CI 변경에는 변경 파일을 추가하지 않습니다.

예를 들어 아래 파일은 `locale-ko`만 `0.3.1`에서 `0.3.2`로 올립니다.

```md
---
'@dungsil/dsh-plugin-locale-ko': patch
---

한국어 UI 번역을 수정합니다.
```

## 수동 릴리스

1. 변경 PR을 `main`에 병합합니다.
2. `main`에서 GitHub Actions의 `Release` 워크플로를 수동 실행하여 버전 PR을 생성하거나 갱신합니다.
3. 버전 PR의 패키지별 버전과 변경 이력을 검토하고 병합합니다.
4. `Release`를 다시 수동 실행하여 npm 게시와 패키지별 GitHub Release 생성을 진행합니다.

변경 파일이 남아 있으면 게시하지 않고 버전 PR을 갱신합니다. 변경 파일이 없으면 아직 npm에
게시되지 않은 버전만 게시합니다. 버전 PR을 만들려면 저장소의 Actions 설정에서
**Allow GitHub Actions to create and approve pull requests**를 허용해야 합니다.
`GITHUB_TOKEN`으로 만든 버전 PR에는 CI가 자동으로 시작되지 않으므로, 병합 전에 로컬에서
`pnpm check`를 실행하거나 PR을 닫았다 다시 열어 CI를 실행합니다. 게시 워크플로도 `pnpm check`를 실행합니다.

태그와 GitHub Release 이름은 `@dungsil/dsh-plugin-locale-ko@0.3.2`처럼 패키지 이름을 포함합니다.
각 Release에는 해당 버전의 변경 설명과 `.tgz` 파일을 첨부한 뒤 게시하므로 불변 릴리스에서도
배포 파일을 보존합니다. 기존 `vX.Y.Z` 태그와 Release는 변경하지 않으며, `locale-ko`의 기존
`0.3.1` 버전과 변경 이력도 이어서 사용합니다.

## 새 플러그인

`packages/<plugin>/package.json`에 고유한 `name`, 시작 `version`, `publishConfig.access: "public"`과
`prepack` 빌드 스크립트를 선언하고, 첫 배포를 위한 changeset을 추가합니다.
릴리스 및 CI 워크플로의 패키지 목록을 수정할 필요는 없습니다.
각 npm 패키지에서 이 저장소의 `.github/workflows/release.yml`을 trusted publisher로 등록해야 하며,
처음 게시하는 패키지는 npm의 초기 게시 및 trusted publishing 등록 절차를 먼저 완료해야 합니다.

자세한 사용법은 [Changesets 문서](https://github.com/changesets/changesets/tree/main/docs)를 참고합니다.
