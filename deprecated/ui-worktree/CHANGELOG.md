# @dungsil/dsh-plugin-ui-worktree

## [0.7.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-worktree%400.6.1...%40dungsil%2Fdsh-plugin-ui-worktree%400.7.0) (2026-11-06)

### Features

- **worktree:** 준비 내역에 작업 세부 정보 접기 설정을 적용한다 ([#174](https://github.com/dungsil/dsh-plugins/issues/174)) ([4f8f81d](https://github.com/dungsil/dsh-plugins/commit/4f8f81d243828a835228f0d4ca81413d977b1d85))

### Bug Fixes

- **ui-worktree:** 보관 시 워크트리 삭제 차단 조건을 수정한다 ([#182](https://github.com/dungsil/dsh-plugins/issues/182)) ([fa56546](https://github.com/dungsil/dsh-plugins/commit/fa56546b63710e0f168c5954ce205a4e0b99174f))
- **worktree:** 테스트 완료를 기다려 CI 린트 실패를 해결한다 ([e038749](https://github.com/dungsil/dsh-plugins/commit/e038749ff95f5b303d3a25f19a0e3aec1b630be9))

## [0.6.1](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-worktree%400.6.0...%40dungsil%2Fdsh-plugin-ui-worktree%400.6.1) (2026-11-05)

### Bug Fixes

- **compat:** dsh 0.2.2 프리릴리스 호환성을 수정한다 ([#80](https://github.com/dungsil/dsh-plugins/issues/80)) ([da66780](https://github.com/dungsil/dsh-plugins/commit/da66780c503983a174e2d891bbaffeda05515f49))

## [0.6.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-worktree%400.5.0...%40dungsil%2Fdsh-plugin-ui-worktree%400.6.0) (2026-11-05)

### ⚠ BREAKING CHANGES

- **session:** 비활성 세션 조회와 워크트리 전환을 막는다 ([#159](https://github.com/dungsil/dsh-plugins/issues/159))

### Features

- **model-settings:** 작업 등록 계약으로 모델 설정 책임을 분리한다 ([#163](https://github.com/dungsil/dsh-plugins/issues/163)) ([f3edf46](https://github.com/dungsil/dsh-plugins/commit/f3edf468421579868bf97371b2e2f9e61a37ea62))

### Bug Fixes

- **process:** Git 조회 동시 실행과 DSH 보조 프로세스 폭증을 제한한다 ([#161](https://github.com/dungsil/dsh-plugins/issues/161)) ([852855f](https://github.com/dungsil/dsh-plugins/commit/852855f22eb1dcc95fe352e3851b2997d9b0cd29))
- **session:** 비활성 세션 조회와 워크트리 전환을 막는다 ([#159](https://github.com/dungsil/dsh-plugins/issues/159)) ([91b4d68](https://github.com/dungsil/dsh-plugins/commit/91b4d6873d5034e44e8d1b272d79f81d7848b1e7))
- **worktree:** 선택과 실행을 분리하고 조회를 안정화한다 ([#162](https://github.com/dungsil/dsh-plugins/issues/162)) ([6826110](https://github.com/dungsil/dsh-plugins/commit/6826110afc694db9b2b83a41dcba07c43f244505))

## [0.5.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-worktree%400.4.0...%40dungsil%2Fdsh-plugin-ui-worktree%400.5.0) (2026-11-05)

### Features

- **model-settings:** 상황별 모델에 개별 지침 편집을 추가한다 ([#129](https://github.com/dungsil/dsh-plugins/issues/129)) ([1dcf04d](https://github.com/dungsil/dsh-plugins/commit/1dcf04d066b623aa2df5bc13f6731d90f7c5e3a2))
- **ui-vcs:** 사이드바 세션에 연결된 MR 상태 아이콘을 표시한다 ([#126](https://github.com/dungsil/dsh-plugins/issues/126)) ([ffed205](https://github.com/dungsil/dsh-plugins/commit/ffed205565043f84b524ca67ce96789eb2141f4c))
- **worktree:** 세션 보관 시 워크트리 삭제 옵션을 추가한다 ([#119](https://github.com/dungsil/dsh-plugins/issues/119)) ([ff61c63](https://github.com/dungsil/dsh-plugins/commit/ff61c631582fd24f3865e14fc2c6f469b3babb72))
- **worktree:** 현재 브랜치를 새 워크트리 아래에 고정한다 ([#106](https://github.com/dungsil/dsh-plugins/issues/106)) ([699d95f](https://github.com/dungsil/dsh-plugins/commit/699d95f1a89aa5f59864abd0c68268b677235f52))

### Bug Fixes

- **model-settings:** 기본 프롬프트를 표시하고 직접 수정하도록 한다 ([#130](https://github.com/dungsil/dsh-plugins/issues/130)) ([8831095](https://github.com/dungsil/dsh-plugins/commit/8831095538ca0fec6136481ab64500f6be10a3a6))
- **ui-worktree:** 조회와 초기화를 분리해 실행 중에도 목록을 읽는다 ([#103](https://github.com/dungsil/dsh-plugins/issues/103)) ([61e5f74](https://github.com/dungsil/dsh-plugins/commit/61e5f74ea49d555fa78bebec74261e2654f74c5e))
- **ui:** 턴 레일 호환성과 플러그인 미리보기를 보완한다 ([#109](https://github.com/dungsil/dsh-plugins/issues/109)) ([17e7094](https://github.com/dungsil/dsh-plugins/commit/17e7094351abd206fadceb9fcadde086351525e5))
- **worktree:** 경로 비교 정규식의 과도한 탐색을 제거한다 ([#127](https://github.com/dungsil/dsh-plugins/issues/127)) ([f9da722](https://github.com/dungsil/dsh-plugins/commit/f9da722e7496c8b1d2c42b71d003a012062d006e))

## [0.4.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-worktree%400.3.0...%40dungsil%2Fdsh-plugin-ui-worktree%400.4.0) (2026-11-04)

### Features

- **model-settings:** 상황별 모델에 공통 보조 모델을 추가한다 ([#79](https://github.com/dungsil/dsh-plugins/issues/79)) ([ce1503e](https://github.com/dungsil/dsh-plugins/commit/ce1503efd9cdc93e8daed8afe108b49835e15429))
- **worktree:** 기본 선택을 설정할 수 있게 한다 ([#75](https://github.com/dungsil/dsh-plugins/issues/75)) ([895405e](https://github.com/dungsil/dsh-plugins/commit/895405e3f2be2c2c4bc0544c807caa8ffbc0b936))

### Bug Fixes

- **security:** 비밀값 승인과 워크트리 보안 경계를 강화한다 ([#88](https://github.com/dungsil/dsh-plugins/issues/88)) ([eb30a91](https://github.com/dungsil/dsh-plugins/commit/eb30a916b0f2be7193db7ac9141f1c196e1430a4))
- **ui-worktree:** 준비 UI의 글꼴과 아이콘을 기존 UI에 맞춘다 ([#67](https://github.com/dungsil/dsh-plugins/issues/67)) ([65d60a2](https://github.com/dungsil/dsh-plugins/commit/65d60a2e76074e071dacb45a99d22b81c673fd11))
- **ui-worktree:** 준비 완료 내역에 작업 상세 접기를 적용한다 ([#66](https://github.com/dungsil/dsh-plugins/issues/66)) ([2c922cd](https://github.com/dungsil/dsh-plugins/commit/2c922cd214faf53f0abc648d7963184bc151c5d2))
- **ui:** 상황별 모델과 워크트리 설정 아이콘을 구분한다 ([#78](https://github.com/dungsil/dsh-plugins/issues/78)) ([96c80d8](https://github.com/dungsil/dsh-plugins/commit/96c80d81d24b2b6ae1bbf7222b6d7f400a0519bc))
- **worktree:** 선택 상자 밖의 오류 라벨을 제거한다 ([#70](https://github.com/dungsil/dsh-plugins/issues/70)) ([393dd4c](https://github.com/dungsil/dsh-plugins/commit/393dd4ce49de89497770e07229141b3bb7af6a3b))

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
