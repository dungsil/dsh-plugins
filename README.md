# DUNGSIL's DSH Plugins

개인용 DSH 플러그인 모음

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

## CLIProxyAPI

실행 중인 CLIProxyAPI v8 서버가 필요합니다. 플러그인은 서버를 설치하거나 실행하지 않습니다.

1. dsh 설정의 **CLIProxyAPI**에서 `/v1`을 제외한 서버 주소, 프록시 API 키, 관리 키를 입력하고 **연결 저장**을 누릅니다. 원격 서버는 HTTPS와 CLIProxyAPI의 `management.allow-remote: true` 설정이 필요합니다.
2. 사이드바의 **CLIProxyAPI** 메뉴를 열면 할당량 화면이 바로 표시됩니다. 연결 정보는 화면 진입·설정 저장·재연결 시 자동으로 갱신되며, 연결 확인에 실패하면 재시도 버튼이 표시됩니다.
3. 계정을 불러온 뒤 개별 할당량을 조회합니다. 카드·테이블 보기로 전환하고 기간별 상세를 펼칠 수 있습니다. Claude, Codex, Antigravity, Kimi, Devin, Meta, xAI 및 할당량 기능을 광고하는 외부 플러그인을 지원합니다. 사용률·잔여량·초기화 시각을 표시하며 미지원·미확인 값은 구분합니다. 대기 시간 초기화는 프록시의 라우팅 차단만 해제하며 공급자의 할당량을 충전하지 않습니다. 유료 추론이나 초기화 크레딧 소비는 수행하지 않습니다.

모델별 이미지·추론 지원과 컨텍스트 크기는 dsh의 기본 **모델** 설정에서 조정할 수 있으며, 같은 서버의 모델 목록을 갱신해도 해당 설정은 유지합니다.

프록시 API 키와 관리 키는 별도 dsh 자격 증명으로 저장하며 조회 응답이나 모델에게 전달하지 않습니다. 서버 주소가 바뀌면 기존 키를 새 서버로 보내지 않습니다. 관리 API는 `/v8/management`를 사용하고 소유자만 호출할 수 있습니다. 할당량 조회에 필요한 자격 증명 원문과 공급자 응답은 서버에서 처리하고 브라우저에는 표시용 결과만 전달합니다. 공급자 등록·OAuth·라우팅 설정 화면, 계정 삭제·자격 증명 파일 다운로드 UI·서버 플러그인 설치·전체 설정 덮어쓰기는 제공하지 않습니다. 외부 제공자의 실제 로그인과 계정 권한은 해당 제공자가 관리합니다. 플러그인을 제거해도 등록한 공급자 설정과 자격 증명은 남으므로, 필요하면 dsh의 **모델** 설정과 자격 증명 저장소에서 별도로 정리합니다.
