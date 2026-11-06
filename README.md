# DUNGSIL's DSH Plugins

개인용 DSH 플러그인 모음

버전 관리·워크트리 확장은 DSH `0.2.2-rc.1`의 공식 `@deepseek-ai/dsh-experimental-forge-bundle`을 먼저 활성화해야 합니다. 프로필의 `dsh.profile.bundles`에서 공식 Forge 번들을 UI 프리셋 또는 개별 확장보다 앞에 두세요. 기존 프리셋 뒤에 Forge 번들을 추가한 프로필은 순서를 변경한 뒤 다시 시작해야 합니다. 중복 PR 패널과 워크트리 선택·진행 UI는 공식 Forge가 담당합니다.

이 저장소의 플러그인은 DSH Web의 Plugins → Discover(플러그인 → 탐색) 탭에서 검색하고 설치할 수 있습니다. 다음 인덱스 URL을 추가합니다.

```text
https://raw.githubusercontent.com/dungsil/dsh-plugins/main/market/index.json
```

| Plugin                                                                    | Description                                                                        | 라이선스 |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | :------: |
| [@dungsil/dsh-plugin-locale-ko](./packages/locale-ko)                     | DSH 한국어 UI 플러그인                                                             |   MIT    |
| [@dungsil/dsh-plugin-korean-ime](./packages/korean-ime)                   | 한국어 IME Enter 처리 구성 요소 (한국어 UI 플러그인에 포함됨)                      |   MIT    |
| [@dungsil/dsh-plugin-yoonmoon](./packages/yoonmoon)                       | 한국어 윤문·교정·문체 변환 스킬 플러그인                                           |   MIT    |
| [@dungsil/dsh-plugin-i-have-adhd](./packages/i-have-adhd)                 | ADHD 친화적 응답 스킬 플러그인                                                     |   MIT    |
| [@dungsil/dsh-plugin-ui-sidebar-inbox](./packages/ui-sidebar-inbox)       | Inbox·Working·Archived 상태별 사이드바 목록 배치 플러그인                          |   MIT    |
| [@dungsil/dsh-plugin-tool-secret-request](./packages/tool-secret-request) | 비밀값을 메시지 내 입력 카드에서 받고 모델에는 참조만 전달하는 도구                |   MIT    |
| [@dungsil/dsh-plugin-model-settings](./packages/model-settings)           | 세션 제목 모델을 관리하는 소유자 전용 API                                          |   MIT    |
| [@dungsil/dsh-plugin-ui-model-settings](./packages/ui-model-settings)     | 상황별 모델 설정 UI (모델 설정 기능 플러그인을 함께 설치함)                        |   MIT    |
| [@dungsil/dsh-plugin-ui-worktree](./packages/ui-worktree)                 | 공식 Forge 워크트리에 AI 브랜치 이름·원격 기준·보관 시 정리를 추가하는 확장        |   MIT    |
| [@dungsil/dsh-plugin-ui-model-picker](./packages/ui-model-picker)         | 입력창 모델 메뉴와 추론 강도 슬라이더                                              |   MIT    |
| [@dungsil/dsh-plugin-ui-turn-rail-left](./packages/ui-turn-rail-left)     | 공식 턴 레일을 대화 화면 왼쪽으로 옮기는 플러그인                                  |   MIT    |
| [@dungsil/dsh-plugin-ui-vcs](./packages/ui-vcs)                           | 공식 Forge에 Git 커밋·푸시·PR 생성/업데이트와 추가 호스팅 provider를 제공하는 확장 |   MIT    |
| [@dungsil/dsh-plugin-ui-usage](./packages/ui-usage)                       | 세션에 기록된 토큰 사용량과 일별·모델별 집계를 확인하는 대시보드                   |   MIT    |
| [@dungsil/dsh-plugin-cli-proxy-api](./packages/cli-proxy-api)             | CLIProxyAPI 모델 연결과 계정별 할당량 조회 UI                                      |   MIT    |
