# @dungsil/dsh-plugin-i-have-adhd

[i-have-adhd](https://github.com/ayghri/i-have-adhd)의 ADHD 친화적 응답 규칙을 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)에 제공하는 플러그인입니다. DSH `0.2.1-rc.5` 이상이 필요합니다.

## 설치

아직 npm에 게시하지 않았다면 이 저장소에서 빌드한 패키지를 설치합니다.

```sh
pnpm install --frozen-lockfile
pnpm --filter @dungsil/dsh-plugin-i-have-adhd pack --pack-destination /tmp
dsh plugin --profile web add @dungsil/dsh-plugin-i-have-adhd@file:/tmp/dungsil-dsh-plugin-i-have-adhd-0.1.0.tgz
```

DSH를 다시 시작한 뒤 새 대화에서 `/i-have-adhd`를 선택해 전송합니다. `web` 대신 사용하는 profile 이름을 지정할 수 있습니다. npm 게시 후에는 다음 명령으로 설치할 수 있습니다.

```sh
dsh plugin --profile web add @dungsil/dsh-plugin-i-have-adhd
```

## 사용

설치만으로 응답 방식이 바뀌지는 않습니다. `/i-have-adhd`를 호출하면 원본의 10개 규칙과 예외 지침이 대화에 전달됩니다.

- 답변이나 다음 행동을 먼저 제시하고, 여러 단계는 번호로 나눕니다.
- 진행 상황과 완료한 작업을 명시하고, 시간은 구체적인 단위로 표현합니다.
- 관련 없는 주제와 불필요한 서두·맺음말을 줄이고, 긴 목록은 묶어서 제시합니다.
- 오류의 위치·원인·해결책을 담백하게 설명하고, 미완료 작업에는 작은 다음 행동 하나를 제시합니다.

`stop adhd mode` 또는 `normal mode`를 보내면 기본 응답 방식으로 돌아가도록 지시합니다. 다시 적용하려면 `/i-have-adhd`를 호출합니다. 이는 모델이 따르는 대화 지침이며, 별도의 강제 상태 전환이나 응답 후처리는 아닙니다. 컨텍스트 압축 후 규칙이 누락되면 다시 호출합니다. 응답 언어는 바꾸지 않습니다.

## 구현 방식과 한계

Claude Code의 사용자 호출 전용 스킬과 OpenCode의 네이티브 스킬 등록 방식을 참고했습니다. DSH의 `ctx.skills.register()`에 원본 `SKILL.md`를 등록하므로 DSH가 사용자 호출과 지침 전달을 담당합니다. `disable-model-invocation: true`를 DSH 호출 정책으로 변환해 모델의 자동 호출을 막습니다. 플러그인을 해제하면 등록도 함께 해제됩니다.

Pi의 상태 표시·세션 상태 저장, OpenCode의 always-on 플래그, 별도의 `/i-have-adhd on|off` 명령은 구현하지 않습니다. 이미 대화에 전달한 지침은 플러그인을 제거해도 남을 수 있으므로, 완전히 초기화하려면 새 대화를 시작합니다.

## 제거

```sh
dsh plugin --profile web remove @dungsil/dsh-plugin-i-have-adhd
```

## 원본 및 라이선스

원본 규칙은 [리비전 `1ecea1993b7fce257ffbd686c070948b5e07eda6`](https://github.com/ayghri/i-have-adhd/commit/1ecea1993b7fce257ffbd686c070948b5e07eda6)의 `skills/i-have-adhd/SKILL.md`를 변경 없이 포함합니다. 네트워크 다운로드나 원본 자동 업데이트는 수행하지 않습니다. MIT 라이선스와 원저작자 표기는 `LICENSE` 및 `NOTICE`에 보존했습니다.
