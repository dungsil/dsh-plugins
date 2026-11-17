# @dungsil/dsh-plugin-ui-setting-skills

## [0.6.2](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-setting-skills%400.6.1...%40dungsil%2Fdsh-plugin-ui-setting-skills%400.6.2) (2026-11-17)

### Bug Fixes

- **ui:** 슬롯 order와 스타일을 DSH 디자인 리소스 규칙에 맞춘다 ([#254](https://github.com/dungsil/dsh-plugins/issues/254)) ([2b3d8a0](https://github.com/dungsil/dsh-plugins/commit/2b3d8a09629737622c9772d2729cdf502f85c260))

## [0.6.1](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-setting-skills%400.6.0...%40dungsil%2Fdsh-plugin-ui-setting-skills%400.6.1) (2026-11-17)

## [0.6.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-setting-skills%400.5.0...%40dungsil%2Fdsh-plugin-ui-setting-skills%400.6.0) (2026-11-16)

### ⚠ BREAKING CHANGES

- **skills:** 작업 공간과 프리셋의 유효 스킬 카탈로그를 제공한다 ([#229](https://github.com/dungsil/dsh-plugins/issues/229))

### Features

- **skills:** 스킬 전문과 표시 메타데이터를 제공한다 ([#220](https://github.com/dungsil/dsh-plugins/issues/220)) ([88001e0](https://github.com/dungsil/dsh-plugins/commit/88001e059163a44904191593dae6c2e0488983f3))
- **skills:** 작업 공간과 프리셋의 유효 스킬 카탈로그를 제공한다 ([#229](https://github.com/dungsil/dsh-plugins/issues/229)) ([d92cbf5](https://github.com/dungsil/dsh-plugins/commit/d92cbf5c229c17e577602322de41c4c218e769ff))

### Bug Fixes

- **setting-skills:** 스킬 비활성화 필터를 사용자 소스로 한정한다 ([#238](https://github.com/dungsil/dsh-plugins/issues/238)) ([1a047ee](https://github.com/dungsil/dsh-plugins/commit/1a047ee341c31d2a1e5d0f3e716bd3243866f319))

## [0.5.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-setting-skills%400.4.0...%40dungsil%2Fdsh-plugin-ui-setting-skills%400.5.0) (2026-11-15)

### Features

- **i18n:** 플러그인에 6개 언어 지원을 추가한다 ([#204](https://github.com/dungsil/dsh-plugins/issues/204)) ([02a89f6](https://github.com/dungsil/dsh-plugins/commit/02a89f604db192a44ebd69a6547ede3025a2adf8))

### Bug Fixes

- **compat:** dsh v0.2.2-rc.2 API와 의존성에 맞춰 갱신한다 ([#210](https://github.com/dungsil/dsh-plugins/issues/210)) ([b40eda5](https://github.com/dungsil/dsh-plugins/commit/b40eda51bb0475498130c8696d845eef5525eeb0))
- **compat:** 패키지 라이선스를 추가하고 DSH rc3로 갱신한다 ([#214](https://github.com/dungsil/dsh-plugins/issues/214)) ([3dc8480](https://github.com/dungsil/dsh-plugins/commit/3dc84808a152c14723d3b988e60144e751c69e02))
- **skills:** 설정 화면 배치와 사용 여부 문구를 개선한다 ([#198](https://github.com/dungsil/dsh-plugins/issues/198)) ([e34836a](https://github.com/dungsil/dsh-plugins/commit/e34836aa24d370ccedf20de50b1c598128cf5959))

## [0.4.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-setting-skills%400.3.2...%40dungsil%2Fdsh-plugin-ui-setting-skills%400.4.0) (2026-11-06)

### Features

- **skills:** 번역문 미리보기와 전체 스킬 번역을 추가한다 ([#176](https://github.com/dungsil/dsh-plugins/issues/176)) ([643e422](https://github.com/dungsil/dsh-plugins/commit/643e422e058ebf19ef3d075186d064362427c48e))
- **skills:** 스킬 설정에 검색 기능을 추가한다 ([#185](https://github.com/dungsil/dsh-plugins/issues/185)) ([9c50d63](https://github.com/dungsil/dsh-plugins/commit/9c50d63bc9750e40a5323f12f6077e97765ba4cc))

### Performance Improvements

- **skills:** 원문과 대상 언어가 같으면 번역 요청을 생략한다 ([#172](https://github.com/dungsil/dsh-plugins/issues/172)) ([2d8943b](https://github.com/dungsil/dsh-plugins/commit/2d8943b8869da711fe80d8152b56c429e274f435))

## [0.3.2](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-setting-skills%400.3.1...%40dungsil%2Fdsh-plugin-ui-setting-skills%400.3.2) (2026-11-05)

### Bug Fixes

- **compat:** dsh 0.2.2 프리릴리스 호환성을 수정한다 ([#80](https://github.com/dungsil/dsh-plugins/issues/80)) ([da66780](https://github.com/dungsil/dsh-plugins/commit/da66780c503983a174e2d891bbaffeda05515f49))

* fix(session)!: 비활성 세션 조회와 워크트리 전환을 막는다 (#159) (91b4d68)
* feat(model-settings): 작업 등록 계약으로 모델 설정 책임을 분리한다 (#163) (f3edf46)
* fix(model-picker): 입력 확정과 포커스 접근성을 개선한다 (#160) (1f98854)
* fix(worktree): 선택과 실행을 분리하고 조회를 안정화한다 (#162) (6826110)
* fix(process): Git 조회 동시 실행과 DSH 보조 프로세스 폭증을 제한한다 (#161) (852855f)
* fix(usage): 사용량과 CPA 재진입 시 캐시를 즉시 표시한다 (#158) (27bfda8)
* fix(ui-vcs): 커밋 적용 범위 안내를 작성자 제목 아래로 옮긴다 (#157) (7c9de3f)
* fix(model-settings): 선택적 제목 생성기의 실패를 설정 API와 분리한다 (#156) (086ce22)
* fix(vcs): 세션 없이 CLI 인증 상태를 조회한다 (#154) (37a038d)
* feat(usage): 토큰 사용량을 언어별 축약 단위로 표시한다 (#155) (247564d)
* chore(gitignore): 에이전트 샘플 파일 제거 (1372441)
* fix(skills): 폴더 열기 상태를 스킬별로 분리한다 (#153) (3a2b9b8)
* chore(market): 릴리스한 패키지의 인덱스를 갱신한다 [skip ci] (c08bbe2)
* chore(release): 6개 패키지를 릴리즈한다 [skip ci] (56b0382)
* fix(ui-vcs): 버튼 밖에 표시되는 상태 문구를 제거한다 (#151) (38fad12)
* fix(cli-proxy-api): 할당량 병렬 조회 시 불필요한 busy 오류를 방지한다 (3e3ebbe)
* fix(preset-ui): 버전 관리와 사용량 플러그인 누락을 수정한다 (#149) (17d0ddd)
* fix(model-settings): 설정이 없는 플러그인으로 인한 전체 조회 실패를 방지한다 (#150) (2bf065c)
* feat(preset-tools): 기존 도구 플러그인을 묶는 프리셋을 추가한다 (#148) (4fa23ab)
* feat(ui-vcs): 커밋 설정과 CLI 인증 상태 메뉴를 추가한다 (#146) (c54732d)
* fix(model-picker): 추론 강도 적용 후 슬라이더 포커스를 유지한다 (#147) (c0d7c08)

## [0.3.0](https://github.com/dungsil/dsh-plugins/compare/%40dungsil%2Fdsh-plugin-ui-setting-skills%400.2.0...%40dungsil%2Fdsh-plugin-ui-setting-skills%400.3.0) (2026-11-05)

### Features

- **skills:** 스킬 폴더 열기 버튼을 추가한다 ([#110](https://github.com/dungsil/dsh-plugins/issues/110)) ([375e8a3](https://github.com/dungsil/dsh-plugins/commit/375e8a3cf9dae0d9fa38e1ae85516a6f95e60c8f))
- **skills:** 펼친 스킬 설명을 자동 번역하고 캐시에 저장한다 ([#96](https://github.com/dungsil/dsh-plugins/issues/96)) ([871d313](https://github.com/dungsil/dsh-plugins/commit/871d313b86dfedc164a0efbad209592159bb8fc6))

### Bug Fixes

- **lint:** oxlint 경고가 있으면 커밋을 차단한다 ([#131](https://github.com/dungsil/dsh-plugins/issues/131)) ([08e0766](https://github.com/dungsil/dsh-plugins/commit/08e0766cf3c16457973a9ff34d3a289dbc557125))
- **skills:** 설정 메뉴에 DSH 기본 스킬 아이콘을 표시한다 ([#105](https://github.com/dungsil/dsh-plugins/issues/105)) ([b55bf50](https://github.com/dungsil/dsh-plugins/commit/b55bf5092ba2e626f6f00df128603450227208ed))
- **ui:** 턴 레일 호환성과 플러그인 미리보기를 보완한다 ([#109](https://github.com/dungsil/dsh-plugins/issues/109)) ([17e7094](https://github.com/dungsil/dsh-plugins/commit/17e7094351abd206fadceb9fcadde086351525e5))

## 0.2.0 (2026-11-04)

### Features

- **skills:** DSH에서만 스킬을 비활성화하는 설정을 추가한다 ([#86](https://github.com/dungsil/dsh-plugins/issues/86)) ([f2f2037](https://github.com/dungsil/dsh-plugins/commit/f2f2037d53768c3e215ebc1455c5a7908c47cb5d))
- **ui:** 설정 화면에 사용자 스킬 목록을 추가한다 ([#77](https://github.com/dungsil/dsh-plugins/issues/77)) ([3398b5d](https://github.com/dungsil/dsh-plugins/commit/3398b5d2d9e9b6d0d7d58387218add9aba85393c))
