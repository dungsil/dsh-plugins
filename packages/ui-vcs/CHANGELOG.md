# @dungsil/dsh-plugin-ui-vcs

## [0.4.2](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-vcs%400.4.1...%40dungsil%2Fdsh-plugin-ui-vcs%400.4.2) (2026-11-05)

### Bug Fixes

- **compat:** dsh 0.2.2 프리릴리스 호환성을 수정한다 ([#80](https://github.com/dungsil/dsh-plugins/issues/80)) ([da66780](https://github.com/dungsil/dsh-plugins/commit/da66780c503983a174e2d891bbaffeda05515f49))

## [0.4.1](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-vcs%400.4.0...%40dungsil%2Fdsh-plugin-ui-vcs%400.4.1) (2026-11-05)

### Bug Fixes

- **vcs:** CI 상태를 선형 원형 아이콘으로 표시한다 ([#166](https://github.com/dungsil/dsh-plugins/issues/166)) ([80c0169](https://github.com/dungsil/dsh-plugins/commit/80c0169c7880e22445bae90ed0d3a13db00861d1))

## [0.4.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-vcs%400.3.0...%40dungsil%2Fdsh-plugin-ui-vcs%400.4.0) (2026-11-05)

### ⚠ BREAKING CHANGES

- **session:** 비활성 세션 조회와 워크트리 전환을 막는다 ([#159](https://github.com/dungsil/dsh-plugins/issues/159))

### Bug Fixes

- **process:** Git 조회 동시 실행과 DSH 보조 프로세스 폭증을 제한한다 ([#161](https://github.com/dungsil/dsh-plugins/issues/161)) ([852855f](https://github.com/dungsil/dsh-plugins/commit/852855f22eb1dcc95fe352e3851b2997d9b0cd29))
- **session:** 비활성 세션 조회와 워크트리 전환을 막는다 ([#159](https://github.com/dungsil/dsh-plugins/issues/159)) ([91b4d68](https://github.com/dungsil/dsh-plugins/commit/91b4d6873d5034e44e8d1b272d79f81d7848b1e7))
- **ui-vcs:** 커밋 적용 범위 안내를 작성자 제목 아래로 옮긴다 ([#157](https://github.com/dungsil/dsh-plugins/issues/157)) ([7c9de3f](https://github.com/dungsil/dsh-plugins/commit/7c9de3f99f822c8ecc6aebaa86cb8ce74971facc))
- **vcs:** 세션 없이 CLI 인증 상태를 조회한다 ([#154](https://github.com/dungsil/dsh-plugins/issues/154)) ([37a038d](https://github.com/dungsil/dsh-plugins/commit/37a038de5a484cec10da55878f1272aaae5efd76))

## [0.3.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-vcs%400.2.0...%40dungsil%2Fdsh-plugin-ui-vcs%400.3.0) (2026-11-05)

### Features

- **ui-vcs:** 커밋 설정과 CLI 인증 상태 메뉴를 추가한다 ([#146](https://github.com/dungsil/dsh-plugins/issues/146)) ([c54732d](https://github.com/dungsil/dsh-plugins/commit/c54732d807862a3f0baa70bc8cae4a72b0fccfb0))

### Bug Fixes

- **ui-vcs:** 버튼 밖에 표시되는 상태 문구를 제거한다 ([#151](https://github.com/dungsil/dsh-plugins/issues/151)) ([38fad12](https://github.com/dungsil/dsh-plugins/commit/38fad12fddac5eb9c1c450bdd561c51f82ac9aaa))

## [0.2.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-vcs%400.1.0...%40dungsil%2Fdsh-plugin-ui-vcs%400.2.0) (2026-11-05)

### Features

- **ui-vcs:** Gitea와 Forgejo 및 셀프호스트 GitLab 작업을 지원한다 ([#91](https://github.com/dungsil/dsh-plugins/issues/91)) ([908418d](https://github.com/dungsil/dsh-plugins/commit/908418d8c26d5d70ba3fb80f7c1815ac4f5c6e07))
- **ui-vcs:** 사이드바 세션에 연결된 MR 상태 아이콘을 표시한다 ([#126](https://github.com/dungsil/dsh-plugins/issues/126)) ([ffed205](https://github.com/dungsil/dsh-plugins/commit/ffed205565043f84b524ca67ce96789eb2141f4c))
- **ui-vcs:** 현재 브랜치의 PR과 MR 검토·병합을 통합한다 ([#74](https://github.com/dungsil/dsh-plugins/issues/74)) ([b043791](https://github.com/dungsil/dsh-plugins/commit/b0437918139f1366980ab32fea1fd0df5f44d80d))
- **vcs:** PR 링크를 버전 관리 사이드바로 연다 ([#112](https://github.com/dungsil/dsh-plugins/issues/112)) ([3103556](https://github.com/dungsil/dsh-plugins/commit/3103556e805f6c543f25452d9a04ee031bad6404))
- **vcs:** PR 보기 옆에 CI 상태와 결과 바로가기를 추가한다 ([#128](https://github.com/dungsil/dsh-plugins/issues/128)) ([0316fdf](https://github.com/dungsil/dsh-plugins/commit/0316fdfdcfd42a22f9a1fae90bf6376a3b1d8520))

### Bug Fixes

- **ci:** 마켓 인덱스와 공통 UI 가져오기를 바로잡는다 ([#92](https://github.com/dungsil/dsh-plugins/issues/92)) ([7ec85fe](https://github.com/dungsil/dsh-plugins/commit/7ec85fe0458f2fe475f32887189595b93104801c))
- **lint:** oxlint 경고가 있으면 커밋을 차단한다 ([#131](https://github.com/dungsil/dsh-plugins/issues/131)) ([08e0766](https://github.com/dungsil/dsh-plugins/commit/08e0766cf3c16457973a9ff34d3a289dbc557125))
- **ui-vcs:** 버전 관리 버블을 목표와 할 일 위에 배치한다 ([#118](https://github.com/dungsil/dsh-plugins/issues/118)) ([0c8b606](https://github.com/dungsil/dsh-plugins/commit/0c8b6069dba217a3f20e488cc8c6452313065a99))
- **ui:** 턴 레일 호환성과 플러그인 미리보기를 보완한다 ([#109](https://github.com/dungsil/dsh-plugins/issues/109)) ([17e7094](https://github.com/dungsil/dsh-plugins/commit/17e7094351abd206fadceb9fcadde086351525e5))
- **vcs:** PR 생성 후 보기 버튼으로 전환한다 ([#117](https://github.com/dungsil/dsh-plugins/issues/117)) ([5243e33](https://github.com/dungsil/dsh-plugins/commit/5243e33f87d21e87b06f36a8b5262e7777adebb2))
- **vcs:** PR 생성 후 추가 변경에 업데이트 작업을 표시한다 ([#123](https://github.com/dungsil/dsh-plugins/issues/123)) ([07d969b](https://github.com/dungsil/dsh-plugins/commit/07d969beebc37c3f0043eb80144e52b5441ff53d))

### Performance Improvements

- **check:** 독립된 검증 작업과 PR 테스트를 병렬로 실행한다 ([#133](https://github.com/dungsil/dsh-plugins/issues/133)) ([0589dd3](https://github.com/dungsil/dsh-plugins/commit/0589dd387c800d8272aa4ae285282b61b531cc43))
- **vcs:** PR 사이드바의 초기 표시 지연을 줄인다 ([#114](https://github.com/dungsil/dsh-plugins/issues/114)) ([8b7e11a](https://github.com/dungsil/dsh-plugins/commit/8b7e11a8037b28132fa50092400cd4ffcb64d761))

## 0.1.0 (2026-11-04)

### Features

- **ui-vcs:** 에이전트에게 Git 버전 관리 작업을 요청한다 ([#68](https://github.com/dungsil/dsh-plugins/issues/68)) ([44d6e14](https://github.com/dungsil/dsh-plugins/commit/44d6e14e5cb0d927b0a58631904f6ff47b77c303))
