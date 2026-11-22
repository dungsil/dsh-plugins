# @dungsil/dsh-plugin-ui-sidebar-inbox

## [0.5.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.4.2...%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.5.0) (2026-11-22)

### Features

- **compat:** DSH 0.2.3-alpha.2를 지원하고 0.2.2 rc 호환을 유지한다 ([#263](https://github.com/dungsil/dsh-plugins/issues/263)) ([48abf1a](https://github.com/dungsil/dsh-plugins/commit/48abf1a97094314917348e0fc7fdef122c180bf8))

## [0.4.2](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.4.1...%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.4.2) (2026-11-17)

### Bug Fixes

- **ui:** 슬롯 order와 스타일을 DSH 디자인 리소스 규칙에 맞춘다 ([#254](https://github.com/dungsil/dsh-plugins/issues/254)) ([2b3d8a0](https://github.com/dungsil/dsh-plugins/commit/2b3d8a09629737622c9772d2729cdf502f85c260))

## [0.4.1](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.4.0...%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.4.1) (2026-11-17)

## [0.4.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.3.0...%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.4.0) (2026-11-16)

### Features

- **sidebar-inbox:** 기존 API로 잠시 숨김과 자동화 분류를 이식한다 ([#224](https://github.com/dungsil/dsh-plugins/issues/224)) ([36326bd](https://github.com/dungsil/dsh-plugins/commit/36326bd88d2829b0a69358777cfc679626ce2ad7))

### Bug Fixes

- **sidebar-inbox:** 플러그인 해제 시 강제한 flat 그룹을 원래 그룹으로 복원한다 ([#239](https://github.com/dungsil/dsh-plugins/issues/239)) ([defd7ec](https://github.com/dungsil/dsh-plugins/commit/defd7ec688a693a8b008e6b6fb67c740ca0d0f77))
- **sidebar-inbox:** 하단 고정을 복구하고 잠시 숨김 미리보기를 갱신한다 ([#234](https://github.com/dungsil/dsh-plugins/issues/234)) ([244f9a0](https://github.com/dungsil/dsh-plugins/commit/244f9a09b9a1133d50e1e6d67eeb38f14e302b00))
- **sidebar-inbox:** 활동 정렬을 다시 선택해도 유지한다 ([#222](https://github.com/dungsil/dsh-plugins/issues/222)) ([a1975a3](https://github.com/dungsil/dsh-plugins/commit/a1975a3fa30b9d461dcd495fb9e67fc749c0aa2d))

## [0.3.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.2.3...%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.3.0) (2026-11-15)

### Features

- **i18n:** 플러그인에 6개 언어 지원을 추가한다 ([#204](https://github.com/dungsil/dsh-plugins/issues/204)) ([02a89f6](https://github.com/dungsil/dsh-plugins/commit/02a89f604db192a44ebd69a6547ede3025a2adf8))

### Bug Fixes

- **compat:** dsh v0.2.2-rc.2 API와 의존성에 맞춰 갱신한다 ([#210](https://github.com/dungsil/dsh-plugins/issues/210)) ([b40eda5](https://github.com/dungsil/dsh-plugins/commit/b40eda51bb0475498130c8696d845eef5525eeb0))
- **compat:** 패키지 라이선스를 추가하고 DSH rc3로 갱신한다 ([#214](https://github.com/dungsil/dsh-plugins/issues/214)) ([3dc8480](https://github.com/dungsil/dsh-plugins/commit/3dc84808a152c14723d3b988e60144e751c69e02))
- **sidebar-inbox:** 업데이트 후 정렬 선택을 유지한다 ([#192](https://github.com/dungsil/dsh-plugins/issues/192)) ([4ccf525](https://github.com/dungsil/dsh-plugins/commit/4ccf52599acc6d84c4d1d698bff2a6aa001cc9c8))
- **tooling:** 커밋 훅과 CI의 lint 검사 범위를 통일한다 ([#197](https://github.com/dungsil/dsh-plugins/issues/197)) ([b80b3ab](https://github.com/dungsil/dsh-plugins/commit/b80b3abbcfce85aa23ca69b56defcfcbac74ff6f))
- **tooling:** 테스트의 await 누락을 커밋 전에 자동 수정한다 ([#203](https://github.com/dungsil/dsh-plugins/issues/203)) ([13bdf36](https://github.com/dungsil/dsh-plugins/commit/13bdf36df6780acaf430a00e0ec971e6b4d8ea03))

## [0.2.3](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.2.2...%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.2.3) (2026-11-05)

### Bug Fixes

- **compat:** dsh 0.2.2 프리릴리스 호환성을 수정한다 ([#80](https://github.com/dungsil/dsh-plugins/issues/80)) ([da66780](https://github.com/dungsil/dsh-plugins/commit/da66780c503983a174e2d891bbaffeda05515f49))

## [0.2.2](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.2.1...%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.2.2) (2026-11-05)

### Bug Fixes

- **sidebar-inbox:** 하단 스크롤바를 실제 스크롤 중에만 표시한다 ([#99](https://github.com/dungsil/dsh-plugins/issues/99)) ([70d36c7](https://github.com/dungsil/dsh-plugins/commit/70d36c759db9f722936f65d1e97738d8cf5aa1c5))
- **ui:** 턴 레일 호환성과 플러그인 미리보기를 보완한다 ([#109](https://github.com/dungsil/dsh-plugins/issues/109)) ([17e7094](https://github.com/dungsil/dsh-plugins/commit/17e7094351abd206fadceb9fcadde086351525e5))

## [0.2.1](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.2.0...%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.2.1) (2026-11-04)

### Bug Fixes

- **sidebar-inbox:** 하단 영역 높이와 펼침 속도 및 스크롤바를 조정한다 ([d9e48f8](https://github.com/dungsil/dsh-plugins/commit/d9e48f8a3dc0a84d913810fd9dfe7bff197fa5d1))

## [0.2.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.1.0...%40dungsil%2Fdsh-plugin-ui-sidebar-inbox%400.2.0) (2026-11-04)

### Features

- **locale:** 플러그인에 중국어 메타데이터를 추가한다 ([#49](https://github.com/dungsil/dsh-plugins/issues/49)) ([7876f45](https://github.com/dungsil/dsh-plugins/commit/7876f45448bb47d43a0f6cf8e16c7b29a6a1ecfb))

### Bug Fixes

- **sidebar-inbox:** 새 설치의 기본 정렬을 에이전트 활동으로 설정한다 ([#57](https://github.com/dungsil/dsh-plugins/issues/57)) ([8684cb7](https://github.com/dungsil/dsh-plugins/commit/8684cb77eeaccef4288117301aacbe1bff9bd391))
- **ui-sidebar-inbox:** 긴 목록에서 제목과 스크롤이 가려지지 않게 한다 ([#45](https://github.com/dungsil/dsh-plugins/issues/45)) ([78d7258](https://github.com/dungsil/dsh-plugins/commit/78d725878cf4356e6b33cd808094552575ddeb43))
- **ui-sidebar-inbox:** 라벨 화살표를 DSH 공식 아이콘으로 교체한다 ([#48](https://github.com/dungsil/dsh-plugins/issues/48)) ([a18411a](https://github.com/dungsil/dsh-plugins/commit/a18411adc55e1444457a99b490b6e60fc44ab474))

패키지 이름을 `@dungsil/dsh-plugin-sidebar-inbox`에서 변경하고 `0.1.0`부터 다시 배포합니다. 아래 `2.0.0` 이하 기록은 사용 중단 대상인 이전 패키지의 이력입니다.

## 0.1.0 (2026-11-04)

### Features

- **ui-sidebar-inbox:** 사이드바 패키지 이름을 변경하고 0.1.0으로 전환한다 ([#40](https://github.com/dungsil/dsh-plugins/issues/40)) ([246965f](https://github.com/dungsil/dsh-plugins/commit/246965f92ceb17b67252e2cb29fdd37e437b0366))

## [2.0.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-sidebar-inbox%401.0.0...%40dungsil%2Fdsh-plugin-sidebar-inbox%402.0.0) (2026-11-03)

### ⚠ BREAKING CHANGES

- **sidebar-inbox:** 상태별 정렬을 보기 옵션의 에이전트 활동 정렬로 옮긴다 ([#38](https://github.com/dungsil/dsh-plugins/issues/38))

### Features

- **sidebar-inbox:** 상태별 정렬을 보기 옵션의 에이전트 활동 정렬로 옮긴다 ([#38](https://github.com/dungsil/dsh-plugins/issues/38)) ([ce9932b](https://github.com/dungsil/dsh-plugins/commit/ce9932bcbf4ec4ef15718f004bd44e11b37d1176))

## [1.0.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-sidebar-inbox%400.1.0...%40dungsil%2Fdsh-plugin-sidebar-inbox%401.0.0) (2026-11-03)

### ⚠ BREAKING CHANGES

- **sidebar-inbox:** 정리(Settle) 기능을 DSH 보관(Archived) 영역으로 대체한다 ([#27](https://github.com/dungsil/dsh-plugins/issues/27))

### Features

- **market:** 플러그인 마켓 인덱스를 추가한다 ([#30](https://github.com/dungsil/dsh-plugins/issues/30)) ([79163df](https://github.com/dungsil/dsh-plugins/commit/79163dfd7d47da7fb78e7454138360b6076967e7))
- **sidebar-inbox:** 목록 제목으로 작업과 보관 영역을 접고 펼친다 ([#33](https://github.com/dungsil/dsh-plugins/issues/33)) ([5bbbe37](https://github.com/dungsil/dsh-plugins/commit/5bbbe37713cea654e4d3c7d80691916db902e93c))
- **sidebar-inbox:** 정리(Settle) 기능을 DSH 보관(Archived) 영역으로 대체한다 ([#27](https://github.com/dungsil/dsh-plugins/issues/27)) ([f346894](https://github.com/dungsil/dsh-plugins/commit/f3468945c257ff372cd2f27b625cb95b1d145bf5))

## 0.1.0 (2026-11-03)

### Features

- **sidebar-inbox:** 목록 제목과 메뉴 라벨에 한국어 번역을 추가한다 ([#26](https://github.com/dungsil/dsh-plugins/issues/26)) ([87bf68c](https://github.com/dungsil/dsh-plugins/commit/87bf68cf41d5b974d57aee92d3cb4a63579fcf9c))
- **sidebar-inbox:** 세션을 작업 상태별 목록으로 배치한다 ([5d5f6b6](https://github.com/dungsil/dsh-plugins/commit/5d5f6b66cf5d2d76e0cd629ef08d211e793e7d14))
- **sidebar-inbox:** 작업 목록을 하단에 고정하고 정리 목록을 접는다 ([42d3c75](https://github.com/dungsil/dsh-plugins/commit/42d3c753f097a0d990736be0b5b0ac1ee28676a5))
