# @dungsil/dsh-plugin-yoonmoon

[yoonmoon](https://github.com/amondnet/yoonmoon)의 한국어 글다듬기 스킬 6개를 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)에 제공하는 플러그인입니다. DSH 호환 범위는 `^0.2.1-rc.5`입니다.

## 설치

아직 npm에 게시하지 않았으므로 이 저장소에서 만든 tarball을 설치합니다.

```sh
pnpm install --frozen-lockfile
pnpm --filter @dungsil/dsh-plugin-yoonmoon pack --pack-destination /tmp
dsh plugin --profile web add @dungsil/dsh-plugin-yoonmoon@file:/tmp/dungsil-dsh-plugin-yoonmoon-0.1.0.tgz
```

`web`은 사용하는 profile 이름으로 바꿀 수 있습니다. DSH를 다시 시작하면 스킬 목록에 등록됩니다. npm 게시 후에는 `dsh plugin --profile web add @dungsil/dsh-plugin-yoonmoon`으로 설치할 수 있습니다.

## 사용

한국어 텍스트를 붙여 넣거나 파일을 지정하고 자연어로 요청합니다. 모델이 스킬 설명을 보고 필요한 지침을 불러옵니다. 직접 선택하려면 아래 스킬 이름을 지정합니다.

| 스킬                            | 용도                                       | 요청 예시                                         |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------- |
| `polishing-korean`              | 진단부터 교정·윤문·재진단까지 전체 처리    | 이 글을 전체적으로 다듬어 줘.                     |
| `humanizing-korean`             | 문체를 유지하면서 AI 특유의 표현 교정      | 이 글의 AI 티를 없애 줘. 강도는 보수적으로 해 줘. |
| `polishing-korean-translations` | 번역문의 번역투 교정, 재번역 제외          | 이 번역문의 어색한 번역투를 다듬어 줘.            |
| `proofreading-korean`           | 맞춤법·띄어쓰기·문법 등 객관적 오류만 교정 | 문체는 바꾸지 말고 맞춤법만 봐 줘.                |
| `restyling-korean`              | 지정한 문체·격식·매체에 맞춰 변환          | 이 글을 하십시오체 비즈니스 이메일로 바꿔 줘.     |
| `detecting-korean-ai`           | 수정 없이 AI 작성 가능성과 근거 진단       | 이 글이 AI가 쓴 글인지 진단해 줘.                 |

원본의 `polish-all`, `humanize`, `translate-polish`, `proofread`, `restyle`, `detect`에 각각 대응합니다. DSH의 kebab-case 스킬 이름 규칙과 작업별 이름을 사용하며, Claude 전용 `yoonmoon:스킬` 이름은 사용하지 않습니다.

전체 처리에서는 진단 → 맞춤법 교정 → 번역투 교정 → AI 표현 교정 → 문체 변환 → 재진단 순으로 진행합니다. 번역투·AI 표현 교정은 진단에 따라 선택하고, 문체 변환은 목표 문체를 지정했을 때만 실행합니다. `강도: 보수 | 기본 | 적극`, 특정 단계만 실행하거나 제외하는 요청도 지원합니다.

## 연동 방식과 한계

Claude Code 원본의 `SKILL.md`·상대경로 참고 자료 구성과 [OpenCode의 필요 시 `skill` 로딩 방식](https://opencode.ai/docs/skills/)을 참고했습니다. DSH의 공식 `dsh-skill-office`와 같이 `ctx.skills.registerProvider()`로 번들 스킬을 등록합니다. 모델과 사용자가 모두 호출할 수 있고, 지침 본문은 호출 시 읽습니다. 프로젝트·사용자 스킬의 우선순위는 DSH 레지스트리 정책을 따릅니다.

전체 처리 스킬은 DSH의 `skill({ name: "…" })`로 각 단계의 지침을 불러온 뒤 같은 대화에서 순차 수행합니다. 도구 자체가 글을 교정하거나 별도 에이전트를 실행하는 구조는 아닙니다. 매 요청의 시스템 프롬프트에 전체 규칙을 자동 주입하지 않으며, 외부 교정 API·추가 모델·MCP 서버를 설치하지 않습니다. 기본 DSH의 스킬 로더와 로컬 참고 자료를 읽을 수 있는 파일 도구가 필요합니다. 원격 실행 도구를 쓰는 구성에서는 플러그인 자료에도 접근할 수 있어야 합니다.

고유명사·수치·날짜·직접 인용·주장의 의미를 보존하도록 지시하며, AI 판별은 확률적 추정입니다. 탐지 결과를 표절·부정행위 등 불이익 판단의 단독 근거로 사용하면 안 됩니다. 실제 교정 품질과 내용 보존 여부는 사용 중인 모델에 따라 달라집니다. 참고 문헌의 외부 원문까지 번들에 포함하지는 않습니다.

## 제거

```sh
dsh plugin --profile web remove @dungsil/dsh-plugin-yoonmoon
```

플러그인 해제 시 스킬 등록도 해제됩니다. 이미 대화에 불러온 지침은 기록에 남으므로 완전히 초기화하려면 새 대화를 시작합니다.

## 원본 및 라이선스

원본 [리비전 `c888531`](https://github.com/amondnet/yoonmoon/commit/c88853106c8fa8448447136f5aa3fc8bb9650303)의 6개 스킬과 참고 자료를 포함합니다. 스킬 이름·형제 디렉터리 경로·하네스 호출 지침만 DSH에 맞게 조정했으며, 교정 규칙은 유지합니다. MIT 라이선스와 원저작자·제3자 고지는 `LICENSE` 및 `NOTICE`에 보존했습니다. 실행 시 다운로드하거나 자동 업데이트하지 않습니다.

기존 저장소 릴리스는 `locale-ko` 전용이므로 이 패키지를 자동 게시하지 않습니다. 별도 게시 전에는 위 tarball 설치 방식을 사용합니다.
