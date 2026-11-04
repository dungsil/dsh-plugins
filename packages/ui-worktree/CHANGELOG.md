# @dungsil/dsh-plugin-ui-worktree

## [0.3.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-worktree%400.2.0...%40dungsil%2Fdsh-plugin-ui-worktree%400.3.0) (2026-11-04)

### Features

- **settings:** 플러그인 설정을 변경 즉시 저장한다 ([cbafc1a](https://github.com/dungsil/dsh-plugins/commit/cbafc1a66823a6ea86b9dc36a8a9eb278a7c3680))
- **ui-worktree:** 누락된 중국어 로케일 추가 ([eee7152](https://github.com/dungsil/dsh-plugins/commit/eee71520b30ea18bef0d3ff48c2a99fc2d118574))
- **ui-worktree:** 프롬프트 전송 시 워크트리를 생성하도록 변경한다 ([#56](https://github.com/dungsil/dsh-plugins/issues/56)) ([d8d0b4c](https://github.com/dungsil/dsh-plugins/commit/d8d0b4ce6ebbd4c524ca550e529ee16e5a7611cd))

### Bug Fixes

- **settings:** 설정 페이지의 불필요한 안내 문구를 제거한다 ([#64](https://github.com/dungsil/dsh-plugins/issues/64)) ([f3e871e](https://github.com/dungsil/dsh-plugins/commit/f3e871eccbf5021372228c10063834363acc3c2e))
- **ui-worktree:** 워크트리 생성 실패 해결 ([a199971](https://github.com/dungsil/dsh-plugins/commit/a199971e7fb01ff20485398e72eb87da5d0d02f5))
- **ui-worktree:** 자동 이름 생성에 지원되는 추론 수준을 선택한다 ([fa08e0b](https://github.com/dungsil/dsh-plugins/commit/fa08e0b81f2139c6ab3ae82084a0d8308296c779))

## [0.2.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-worktree%400.1.0...%40dungsil%2Fdsh-plugin-ui-worktree%400.2.0) (2026-11-04)

### Features

- **locale:** 플러그인에 중국어 메타데이터를 추가한다 ([#49](https://github.com/dungsil/dsh-plugins/issues/49)) ([7876f45](https://github.com/dungsil/dsh-plugins/commit/7876f45448bb47d43a0f6cf8e16c7b29a6a1ecfb))
- **model-settings:** 상황별 모델에 추론 수준 설정을 추가한다 ([#52](https://github.com/dungsil/dsh-plugins/issues/52)) ([08cfdea](https://github.com/dungsil/dsh-plugins/commit/08cfdeabb4b57c7fe048a954731201f1302c0453))
- **model-settings:** 워크트리 이름 생성 모델 설정을 추가한다 ([#55](https://github.com/dungsil/dsh-plugins/issues/55)) ([613c61d](https://github.com/dungsil/dsh-plugins/commit/613c61dd65540e5d136e3596d4df124da188795c))
- **ui-worktree:** 사이드바에 현재 워크트리 이름을 표시한다 ([#53](https://github.com/dungsil/dsh-plugins/issues/53)) ([293373a](https://github.com/dungsil/dsh-plugins/commit/293373ada44dec31703f66c40292f9b98ef8861d))
- **ui-worktree:** 생성을 자동화하고 모델은 브랜치 이름만 정한다 ([#44](https://github.com/dungsil/dsh-plugins/issues/44)) ([aadad48](https://github.com/dungsil/dsh-plugins/commit/aadad48bfbe800c9a004452f4df81cb7e2720b9a))
- **ui-worktree:** 선택 상자에서 워크트리를 직접 생성하고 전환한다 ([#47](https://github.com/dungsil/dsh-plugins/issues/47)) ([e2d8518](https://github.com/dungsil/dsh-plugins/commit/e2d8518b0d27404d1ec4b6c61b5f82f258da2f94))
- **ui-worktree:** 워크트리 경로와 생성 규칙 설정 메뉴를 추가한다 ([#51](https://github.com/dungsil/dsh-plugins/issues/51)) ([019f423](https://github.com/dungsil/dsh-plugins/commit/019f4230ecff04bfa4530227f616200a98d2a78c))

### Bug Fixes

- **ui-worktree:** Windows 브랜치 판별과 오류 표시를 고친다 ([9c2d491](https://github.com/dungsil/dsh-plugins/commit/9c2d491b8b88b8c7f2e9155ee062adde94574297))
- **ui-worktree:** 권한 모드 선택상자와 워크트리 UI의 스타일을 통일한다 ([855024b](https://github.com/dungsil/dsh-plugins/commit/855024b9f4af98e1b122aece76317283f9c0ed8e))
- **ui-worktree:** 새로고침 아이콘 버튼을 제거한다 ([32d8adf](https://github.com/dungsil/dsh-plugins/commit/32d8adfe2f95637a523203ec6b9d6e0a0e03fb80))
- **ui-worktree:** 워크트리 선택상자를 권한 모드와 같은 공통 메뉴로 바꾼다 ([9076044](https://github.com/dungsil/dsh-plugins/commit/90760442d24efbed6652dbe8a16bf323120eb268))

## 0.1.1 (2026-11-04)

### Bug Fixes

- Windows 작업 경로와 Git 경로의 구분자를 맞춰 현재 브랜치를 판별한다
- 긴 오류 문구를 도구줄에서 제거하고 상세 창에 오류 코드와 재조회 버튼을 제공한다
- 진단 로그에는 요청 종류와 허용된 오류 코드만 기록한다

## 0.1.0 (2026-11-03)

### Features

- **ui-worktree:** 입력창에서 기존 도구 사용을 요청하는 UI를 추가한다 ([#35](https://github.com/dungsil/dsh-plugins/issues/35)) ([9093b59](https://github.com/dungsil/dsh-plugins/commit/9093b59de9120e1badf5b117aef8a3916da213ba))
