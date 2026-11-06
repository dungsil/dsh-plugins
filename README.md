# DUNGSIL's DSH Plugins

개인용 DSH 플러그인 모음

pstack은 `@dungsil/dsh-plugin-pstack` 번들로 제공합니다. 설치 후 `poteto-help`로 사용법을 확인하고 `poteto-mode`로 개발 작업을 시작합니다. 58개 스킬과 플레이북·원칙을 포함하며, 모델 선호 설정은 `setup-pstack`을 사용합니다. 스킬은 DSH 도구와 세션·팀 실행 절차를 직접 사용하며 [DSH 실행 지침](./packages/pstack/DSH.md)을 따릅니다. 설치만으로 모드가 자동 적용되거나 모델 설정이 변경되지는 않습니다.

이 저장소의 플러그인은 DSH Web의 Plugins → Discover(플러그인 → 탐색) 탭에서 검색하고 설치할 수 있습니다. 다음 인덱스 URL을 추가합니다.

```text
https://raw.githubusercontent.com/dungsil/dsh-plugins/main/market/index.json
```

| Plugin                                                                    | Description                                                              | 라이선스 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------ | :------: |
| [@dungsil/dsh-plugin-locale-ko](./packages/locale-ko)                     | DSH 한국어 UI 플러그인                                                   |   MIT    |
| [@dungsil/dsh-plugin-korean-ime](./packages/korean-ime)                   | 한국어 IME Enter 처리 구성 요소 (한국어 UI 플러그인에 포함됨)            |   MIT    |
| [@dungsil/dsh-plugin-yoonmoon](./packages/yoonmoon)                       | 한국어 윤문·교정·문체 변환 스킬 플러그인                                 |   MIT    |
| [@dungsil/dsh-plugin-i-have-adhd](./packages/i-have-adhd)                 | ADHD 친화적 응답 스킬 플러그인                                           |   MIT    |
| [@dungsil/dsh-plugin-pstack](./packages/pstack)                           | 검증 중심 엔지니어링 스킬 58개와 플레이북 23개                           |   MIT    |
| [@dungsil/dsh-plugin-ui-sidebar-inbox](./packages/ui-sidebar-inbox)       | Inbox·Working·Archived 상태별 사이드바 목록 배치 플러그인                |   MIT    |
| [@dungsil/dsh-plugin-tool-secret-request](./packages/tool-secret-request) | 비밀값을 메시지 내 입력 카드에서 받고 모델에는 참조만 전달하는 도구      |   MIT    |
| [@dungsil/dsh-plugin-model-settings](./packages/model-settings)           | 세션 제목 모델을 관리하는 소유자 전용 API                                |   MIT    |
| [@dungsil/dsh-plugin-ui-model-settings](./packages/ui-model-settings)     | 상황별 모델 설정 UI (모델 설정 기능 플러그인을 함께 설치함)              |   MIT    |
| [@dungsil/dsh-plugin-ui-worktree](./packages/ui-worktree)                 | 입력창에서 기존 도구를 통한 worktree 생성·재사용을 모델에 요청하는 UI    |   MIT    |
| [@dungsil/dsh-plugin-ui-model-picker](./packages/ui-model-picker)         | 입력창 모델 메뉴와 추론 강도 슬라이더                                    |   MIT    |
| [@dungsil/dsh-plugin-ui-turn-rail-left](./packages/ui-turn-rail-left)     | 공식 턴 레일을 대화 화면 왼쪽으로 옮기는 플러그인                        |   MIT    |
| [@dungsil/dsh-plugin-ui-vcs](./packages/ui-vcs)                           | Git 커밋·푸시·PR 생성을 요청하고 사이드바에서 PR / MR을 검토·병합하는 UI |   MIT    |
| [@dungsil/dsh-plugin-ui-usage](./packages/ui-usage)                       | 세션에 기록된 토큰 사용량과 일별·모델별 집계를 확인하는 대시보드         |   MIT    |
| [@dungsil/dsh-plugin-cli-proxy-api](./packages/cli-proxy-api)             | CLIProxyAPI 모델 연결과 계정별 할당량 조회 UI                            |   MIT    |
