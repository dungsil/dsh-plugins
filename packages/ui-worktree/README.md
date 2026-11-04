# @dungsil/dsh-plugin-ui-worktree

DSH 입력창의 권한 선택 옆에 **Worktree** 버튼을 추가합니다. 새 worktree는 공식 런타임을 직접 호출하여 자동으로 생성하고 전환합니다. 모델은 브랜치 이름을 비워 둔 경우에만 이름을 정하며, 작성 중인 메시지·파일 참조·첨부는 그대로 유지합니다.

## 사용법

1. 새 worktree를 만들려면 DSH의 **플러그인 → 공식 → Git worktrees**에서 `@deepseek-ai/dsh-experimental-tool-worktree`를 켭니다.
2. 입력창의 **Worktree**를 누르고 **새로 만들기** 또는 **기존 경로 사용**을 선택합니다.
3. 새 worktree는 브랜치 이름을 입력하고 **새로 만들기**를 누릅니다. 이름을 비워 두면 모델이 최근 대화의 사용자 메시지를 바탕으로 이름만 정합니다. 기존 경로 재사용은 경로를 입력하고 **모델에 요청**을 누릅니다.
4. 기존 경로를 모르면 **목록 요청**으로 대화에서 목록을 확인한 다음, 사용할 경로를 입력합니다.
5. 새 worktree의 생성·전환 결과와 오류는 UI에서 확인합니다. 재사용·목록 요청의 실행 결과는 대화에서 확인합니다.

## 동작 범위

- 생성은 공식 `worktrees.create` 런타임을 직접 호출합니다. 브랜치 이름이 있으면 모델을 호출하지 않습니다. 이름이 없으면 도구 없는 별도 모델 호출로 이름만 생성한 뒤 런타임을 호출합니다. 공식 런타임이 없으면 UI에서 활성화를 안내합니다.
- 재사용은 같은 저장소의 worktree인지 확인한 뒤 기존 `working_directory({ cd: path })` 도구를 사용하도록 요청합니다. 목록 요청은 읽기 전용이며 자동으로 경로를 바꾸지 않습니다.
- 이름 생성·재사용·목록 요청에는 모델 호출 비용이 발생할 수 있습니다. 생성은 세션의 maintenance 작업으로 실행하여 대화 실행과 경로 변경이 겹치지 않게 하며, 공식 런타임의 파일 정책과 기존 브랜치·경로 충돌 검사를 유지합니다. 실패 후 일부 생성물이 남을 수 있으므로 재시도 전에 작업 경로와 worktree 목록을 확인하세요.
- 실행 중이거나 세션을 불러오는 동안, 요청 전송 중이거나 메시지 전송 권한이 없을 때는 버튼을 비활성화합니다. 다른 세션으로 이동하면 입력 폼을 초기화합니다.
- 영어·한국어 UI, Escape 닫기와 키보드 탐색을 지원합니다. 생성 API는 인증된 소유자만 호출할 수 있으며, 별도의 Git 실행 코드나 worktree 런타임, 자동 정리·삭제 기능은 추가하지 않습니다.

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

테스트는 생성 API의 직접 생성·모델 이름 생성 분기와 실패 처리를 확인합니다. 실제 UI 컴포넌트에서는 생성 API 호출, 목록·재사용 요청, 중복 실행 방지, 오류 표시, 초안 보존, 세션 전환 격리, 언어 전환과 비활성화 조건을 확인합니다.
