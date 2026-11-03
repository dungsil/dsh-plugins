# @dungsil/dsh-plugin-ui-worktree

DSH 입력창의 권한 선택 옆에 **Worktree** 버튼을 추가합니다. Git 처리를 직접 구현하지 않는 **UI 전용 플러그인**입니다. 선택한 작업을 현재 세션의 모델에게 별도 메시지로 요청하며, 작성 중인 메시지·파일 참조·첨부는 그대로 유지합니다.

## 사용법

1. 새 worktree를 만들려면 DSH의 **플러그인 → 공식 → Git worktrees**에서 `@deepseek-ai/dsh-experimental-tool-worktree`를 켭니다.
2. 입력창의 **Worktree**를 누르고 **새로 만들기** 또는 **기존 경로 사용**을 선택합니다.
3. 브랜치 이름이나 기존 worktree 경로를 입력하고 **모델에 요청**을 누릅니다. 새 브랜치 이름을 비워 두면 기존 도구가 이름을 생성합니다.
4. 기존 경로를 모르면 **목록 요청**으로 대화에서 목록을 확인한 다음, 사용할 경로를 입력합니다.
5. 실제 생성·전환 결과와 오류는 대화에서 확인합니다. 요청 전송 성공은 worktree 생성 완료를 뜻하지 않습니다.

## 동작 범위

- 생성은 기존 `create_worktree` 도구를 사용하도록 요청합니다. 도구가 없으면 플러그인 활성화를 안내하고 중단하도록 요청하며, `git worktree add`로 대신 처리하지 않도록 명시합니다.
- 재사용은 같은 저장소의 worktree인지 확인한 뒤 기존 `working_directory({ cd: path })` 도구를 사용하도록 요청합니다. 목록 요청은 읽기 전용이며 자동으로 경로를 바꾸지 않습니다.
- 모델이 기존 도구를 실행하므로 모델 설정과 도구 권한이 필요하며, 모델 호출 비용이 발생할 수 있습니다. 플러그인이 모델의 지시 준수나 Git 작업 성공을 보장하지는 않습니다.
- 실행 중이거나 세션을 불러오는 동안, 요청 전송 중이거나 메시지 전송 권한이 없을 때는 버튼을 비활성화합니다. 다른 세션으로 이동하면 입력 폼을 초기화합니다.
- 영어·한국어 UI, Escape 닫기와 키보드 탐색을 지원합니다. 별도의 서버 API, Git 실행 코드, worktree 런타임, 자동 정리·삭제 기능은 추가하지 않습니다.

## 설치

DSH 지원 범위는 `^0.2.1-rc.5`입니다. npm 배포 전에는 저장소에서 패키지를 생성해 설치합니다.

```bash
pnpm --filter @dungsil/dsh-plugin-ui-worktree pack --pack-destination ../../release
dsh plugin --profile web add ./release/dungsil-dsh-plugin-ui-worktree-0.1.0.tgz
```

플러그인 관리 화면에서 **Git Worktree UI**를 활성화합니다. 공식 Git worktrees 플러그인의 활성화 상태는 이 플러그인이 변경하지 않습니다.

## 검증

```bash
pnpm --filter @dungsil/dsh-plugin-ui-worktree build
pnpm --filter @dungsil/dsh-plugin-ui-worktree typecheck
pnpm --filter @dungsil/dsh-plugin-ui-worktree test
```

테스트는 실제 UI 컴포넌트를 통해 생성·목록·재사용 요청의 내용, 중복 전송 방지, 전송 오류 표시, 세션 전환 격리, 언어 전환과 비활성화 조건을 확인합니다.

DSH `0.2.2-alpha.2`의 실제 웹 UI와 로컬 모델 fixture에서도 세 종류의 요청 전달, 작성 중인 메시지·첨부 보존, 전송 실패 표시, Escape 닫기, 라이트·다크 테마와 390px 너비를 검증했습니다. fixture는 요청 수신만 확인하며 Git 도구를 실행하지 않습니다.
