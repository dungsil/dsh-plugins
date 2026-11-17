# @dungsil/dsh-plugin-tool-secret-request

- feat(ui-forge-chip): Git 칩에 단축키와 키보드 이동, 세션 상태 캐시를 추가한다 (#247) (9667c48)
- feat(ui-forge-chip): 워크트리 커밋을 원본 작업 공간에 통합하는 칩을 추가한다 (#246) (1f73326)
- ci(release): 변경 사항이 없는 패키지도 강제로 패치 릴리스한다 (#245) (0fd859b)
- feat(ui-forge-chip): 커밋·푸시·PR 생성을 호스트 Git 작업으로 실행한다 (#244) (c2100e6)
- fix(ui-model-settings): 패키징 전에 클라이언트 번들을 검증한다 (#243) (a44e072)
- fix(ui-forge-worktree): 워크트리 메뉴 레이아웃을 DUN 구현체와 맞춘다 (#242) (46763ff)
- chore(release): 8개 패키지를 릴리즈한다 [skip ci] (e37eb71)
- refactor(ui): 로케일 선택과 스타일 주입을 공용 헬퍼로 통일한다 (#241) (c589087)
- refactor(plugin-server): RPC 봉투 파싱과 git spawn 하드닝을 공용 패키지로 추출한다 (#240) (b1dbbb3)
- fix(sidebar-inbox): 플러그인 해제 시 강제한 flat 그룹을 원래 그룹으로 복원한다 (#239) (defd7ec)
- fix(setting-skills): 스킬 비활성화 필터를 사용자 소스로 한정한다 (#238) (1a047ee)
- fix(image-paths): node가 없는 소유자로 renderSlot이 호출되면 cwd 보정을 건너뛴다 (#237) (50b7fab)
- fix(forge-pulls): 리뷰 액션이 성공하면 읽기 한 번으로 원격 상태를 자동 갱신한다 (#236) (9a2fb14)
- fix(release): 배포되지 않은 워크스페이스 의존성으로 패키지를 배포하지 않는다 (#235) (213319f)
- fix(sidebar-inbox): 하단 고정을 복구하고 잠시 숨김 미리보기를 갱신한다 (#234) (244f9a0)
- chore(deps-dev): bump happy-dom from 20.8.9 to 21.0.4 in /packages/ui-forge-worktree in the npm_and_yarn group across 1 directory (#230) (69e19bb)
- docs: Korean IME와 Sidebar Inbox README에 Open Plugin Market 배지를 추가한다 (#233) (ee49851)
- feat(skills)!: 작업 공간과 프리셋의 유효 스킬 카탈로그를 제공한다 (#229) (d92cbf5)
- docs(forge-worktree): README와 언어별 미리보기 이미지를 추가한다 (#231) (f0eaae5)
- feat(sidebar-inbox): 기존 API로 잠시 숨김과 자동화 분류를 이식한다 (#224) (36326bd)
- fix(sidebar-inbox): 활동 정렬을 다시 선택해도 유지한다 (#222) (a1975a3)
- docs(readme): README 표 형식을 정리한다 (#232) (d8d5318)
- feat(worktree)!: 새 세션의 기본 체크아웃을 설정한다 (#225) (f5bc9cd)
- docs: README 업데이트 (e8f3eaa)
- feat(pulls): PR과 MR의 변경 파일 및 diff를 표시한다 (#227) (fe19bd5)
- feat(pulls): GitHub PR을 SHA 조건으로 명시적으로 병합한다 (#223) (8db29eb)
- feat(vcs): 보관 시 워크트리 제거 설정을 제공한다 (#221) (2c18dc2)
- feat(skills): 스킬 전문과 표시 메타데이터를 제공한다 (#220) (88001e0)
- docs(sidebar-inbox): README 미리보기 이미지를 언어별로 제공한다 (#219) (219e529)
- docs(readme): 중복 설명과 일회성 검증 기록을 정리한다 (#218) (65180f5)
- docs(sidebar-inbox): README를 정리하고 지원 언어 전체로 번역한다 (#217) (ff722e0)
- Update README.md (62e0dae)
- chore(release): 14개 패키지를 릴리즈한다 [skip ci] (b9fe740)
- fix(release): 배포된 버전의 저장소 메타데이터를 복구한다 (#216) (6e65d0f)
- chore(release): 12개 패키지를 릴리즈한다 [skip ci] (bc3bd51)
- fix(ui-forge-chip): 패키징 전에 실행 번들을 빌드한다 (#215) (5c1f39d)

## [0.3.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-tool-secret-request%400.2.2...%40dungsil%2Fdsh-plugin-tool-secret-request%400.3.0) (2026-11-15)

### Features

- **i18n:** 플러그인에 6개 언어 지원을 추가한다 ([#204](https://github.com/dungsil/dsh-plugins/issues/204)) ([02a89f6](https://github.com/dungsil/dsh-plugins/commit/02a89f604db192a44ebd69a6547ede3025a2adf8))

### Bug Fixes

- **compat:** dsh v0.2.2-rc.2 API와 의존성에 맞춰 갱신한다 ([#210](https://github.com/dungsil/dsh-plugins/issues/210)) ([b40eda5](https://github.com/dungsil/dsh-plugins/commit/b40eda51bb0475498130c8696d845eef5525eeb0))
- **compat:** 패키지 라이선스를 추가하고 DSH rc3로 갱신한다 ([#214](https://github.com/dungsil/dsh-plugins/issues/214)) ([3dc8480](https://github.com/dungsil/dsh-plugins/commit/3dc84808a152c14723d3b988e60144e751c69e02))

## [0.2.2](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-tool-secret-request%400.2.1...%40dungsil%2Fdsh-plugin-tool-secret-request%400.2.2) (2026-11-05)

### Bug Fixes

- **compat:** dsh 0.2.2 프리릴리스 호환성을 수정한다 ([#80](https://github.com/dungsil/dsh-plugins/issues/80)) ([da66780](https://github.com/dungsil/dsh-plugins/commit/da66780c503983a174e2d891bbaffeda05515f49))

## [0.2.1](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-tool-secret-request%400.2.0...%40dungsil%2Fdsh-plugin-tool-secret-request%400.2.1) (2026-11-04)

### Bug Fixes

- **security:** 비밀값 승인과 워크트리 보안 경계를 강화한다 ([#88](https://github.com/dungsil/dsh-plugins/issues/88)) ([eb30a91](https://github.com/dungsil/dsh-plugins/commit/eb30a916b0f2be7193db7ac9141f1c196e1430a4))

## [0.2.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-tool-secret-request%400.1.0...%40dungsil%2Fdsh-plugin-tool-secret-request%400.2.0) (2026-11-04)

### Features

- **locale:** 플러그인에 중국어 메타데이터를 추가한다 ([#49](https://github.com/dungsil/dsh-plugins/issues/49)) ([7876f45](https://github.com/dungsil/dsh-plugins/commit/7876f45448bb47d43a0f6cf8e16c7b29a6a1ecfb))

## 0.1.0 (2026-11-03)

### Features

- **market:** 플러그인 마켓 인덱스를 추가한다 ([#30](https://github.com/dungsil/dsh-plugins/issues/30)) ([79163df](https://github.com/dungsil/dsh-plugins/commit/79163dfd7d47da7fb78e7454138360b6076967e7))

### Bug Fixes

- **tool-secret-request:** 비밀값 안내를 추가하고 패키지 이름을 변경한다 ([#24](https://github.com/dungsil/dsh-plugins/issues/24)) ([94aa880](https://github.com/dungsil/dsh-plugins/commit/94aa88069f02f313e1b88de3eeabf75aca74eb4a))
