# @dungsil/dsh-preset-ui

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

## [0.3.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-preset-ui%400.2.0...%40dungsil%2Fdsh-preset-ui%400.3.0) (2026-11-15)

### Features

- **i18n:** 플러그인에 6개 언어 지원을 추가한다 ([#204](https://github.com/dungsil/dsh-plugins/issues/204)) ([02a89f6](https://github.com/dungsil/dsh-plugins/commit/02a89f604db192a44ebd69a6547ede3025a2adf8))
- **ui-forge-pulls:** Forge에 연결한 PR 미리보기를 추가한다 ([8929416](https://github.com/dungsil/dsh-plugins/commit/8929416c487a7c764021ac8145c4401ccab4f703))
- **ui-image-paths:** 메시지별 작업 디렉터리로 상대 이미지를 표시한다 ([#209](https://github.com/dungsil/dsh-plugins/issues/209)) ([1a97afe](https://github.com/dungsil/dsh-plugins/commit/1a97afe0110797b190672165cb7ed6f587a05318))

### Bug Fixes

- **agent-browser:** 동봉 의존성을 제거하고 최초 실행 시 사용자 캐시에 자동 설치한다 ([82db7d7](https://github.com/dungsil/dsh-plugins/commit/82db7d78a1c2527db272e1ee12614652b35d9227))
- **compat:** 패키지 라이선스를 추가하고 DSH rc3로 갱신한다 ([#214](https://github.com/dungsil/dsh-plugins/issues/214)) ([3dc8480](https://github.com/dungsil/dsh-plugins/commit/3dc84808a152c14723d3b988e60144e751c69e02))
- **preset-ui:** 누락된 UI 플러그인과 설치 의존성을 추가한다 ([#206](https://github.com/dungsil/dsh-plugins/issues/206)) ([9c5182a](https://github.com/dungsil/dsh-plugins/commit/9c5182a7cc151698b2073608ef8eba7e931d9879))

## [0.2.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-preset-ui%400.1.2...%40dungsil%2Fdsh-preset-ui%400.2.0) (2026-11-06)

### ⚠ BREAKING CHANGES

- **compat:** 모델 설정의 DSH rc.5 호환성을 제거한다 ([#169](https://github.com/dungsil/dsh-plugins/issues/169))

### Bug Fixes

- **compat:** 모델 설정의 DSH rc.5 호환성을 제거한다 ([#169](https://github.com/dungsil/dsh-plugins/issues/169)) ([cce2f6b](https://github.com/dungsil/dsh-plugins/commit/cce2f6b8a81ad91276f1d6c89ab846e9a2c0e909))

## [0.1.2](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-preset-ui%400.1.1...%40dungsil%2Fdsh-preset-ui%400.1.2) (2026-11-05)

### Bug Fixes

- **compat:** dsh 0.2.2 프리릴리스 호환성을 수정한다 ([#80](https://github.com/dungsil/dsh-plugins/issues/80)) ([da66780](https://github.com/dungsil/dsh-plugins/commit/da66780c503983a174e2d891bbaffeda05515f49))

## [0.1.1](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-preset-ui%400.1.0...%40dungsil%2Fdsh-preset-ui%400.1.1) (2026-11-05)

### Bug Fixes

- **preset-ui:** 버전 관리와 사용량 플러그인 누락을 수정한다 ([#149](https://github.com/dungsil/dsh-plugins/issues/149)) ([17d0ddd](https://github.com/dungsil/dsh-plugins/commit/17d0ddd3278f22857b8076fe038d779acd98610d))

## 0.1.0 (2026-11-05)

### Features

- **preset-ui:** 기존 UI 플러그인을 묶은 프리셋을 추가한다 ([#93](https://github.com/dungsil/dsh-plugins/issues/93)) ([944666f](https://github.com/dungsil/dsh-plugins/commit/944666f6b08706c400e0f1a9a74dac95c3222c75))
