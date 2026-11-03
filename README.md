# DUNGSIL's DSH Plugins

개인용 DSH 플러그인 모음

| Plugin                                                                    | Description                                                         | 라이선스 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- | :------: |
| [@dungsil/dsh-plugin-locale-ko](./packages/locale-ko)                     | DSH 한국어 UI 플러그인                                              |   MIT    |
| [@dungsil/dsh-plugin-korean-ime](./packages/korean-ime)                   | 한국어 IME Enter 처리 구성 요소 (한국어 UI 플러그인에 포함됨)       |   MIT    |
| [@dungsil/dsh-plugin-yoonmoon](./packages/yoonmoon)                       | 한국어 윤문·교정·문체 변환 스킬 플러그인                            |   MIT    |
| [@dungsil/dsh-plugin-i-have-adhd](./packages/i-have-adhd)                 | ADHD 친화적 응답 스킬 플러그인                                      |   MIT    |
| [@dungsil/dsh-plugin-sidebar-inbox](./packages/sidebar-inbox)             | Inbox·Working·Archived 상태별 사이드바 목록 배치 플러그인           |   MIT    |
| [@dungsil/dsh-plugin-tool-secret-request](./packages/tool-secret-request) | 비밀값을 메시지 내 입력 카드에서 받고 모델에는 참조만 전달하는 도구 |   MIT    |

## 플러그인 마켓

이 저장소의 플러그인은 DSH Web의 Plugins → Discover(플러그인 → 탐색) 탭에서 검색하고 설치할 수 있습니다. 다음 인덱스 URL을 추가합니다.

```text
https://raw.githubusercontent.com/dungsil/dsh-plugins/main/market/index.json
```

1. DSH Web에서 Plugins → Discover를 엽니다.
2. 인덱스 소스가 없으면 **인덱스 소스 추가**(Add index source)를 누릅니다. 이미 추가한 인덱스가 있으면 마켓 메뉴에서 **인덱스 소스 관리…**(Manage index sources…)를 선택합니다.
3. URL 입력란에 위 주소를 넣고 **추가**(Add)를 누릅니다.
4. 목록에서 플러그인을 고르고 **설치**(Install)를 누릅니다.

인덱스에는 npm에 배포된 버전만 들어갑니다. `@dungsil/dsh-plugin-tool-secret-request`은 아직 배포하지 않아 목록에 없으며, 첫 배포 뒤 릴리스 워크플로가 자동으로 추가합니다.

### 인덱스 갱신

인덱스 파일은 `market/index.json`입니다. 패키지를 추가하거나 버전을 배포한 뒤에는 다음 명령으로 파일을 다시 만들고 함께 커밋합니다. CI는 인덱스가 최신이 아니면 실패합니다.

```sh
pnpm market:index
pnpm market:index --check
```

릴리스 워크플로는 `pnpm release` 뒤에 인덱스를 다시 만들고, 내용이 바뀐 경우에만 커밋해 main에 푸시합니다.
