export const copy = {
  en: {
    nav: 'Version control',
    scope:
      'Changes are saved automatically and apply to future worktrees from both tools and the Forge UI. Existing checkouts and Git configuration are not changed.',
    worktree: 'Worktrees',
    panel: 'Forge panel',
    directory: 'Worktree directory',
    prefix: 'Worktree name prefix',
    directoryHint:
      'Use a repository-relative subdirectory with / separators; absolute paths and . or .. segments are not supported.',
    prefixHint: 'Used for automatically generated names, not semantic branch naming.',
    unsupported:
      'The official Forge bundle does not support the previous commit author, commit signing, default checkout selection, tracked remote, delete-on-archive, or semantic branch naming settings. These settings are not migrated or saved here.',
    empty: 'No editable Forge settings were found. Enable the official Forge bundle first.',
    loading: 'Loading…',
    saving: 'Saving…',
    saved: 'Saved automatically',
    mixed: 'Different values',
    mixedHint:
      'Existing values differ. Editing a field applies that value to both tool and UI worktrees; other fields are kept unchanged.',
    refresh: 'Reload saved values',
    error: 'Could not confirm the result. Reload saved values before retrying.',
    conflict: 'Settings changed elsewhere. Reload saved values before retrying.',
    invalid:
      'Enter a valid relative directory (up to 4096 characters). A prefix may be empty or start with an ASCII letter, digit, or underscore, followed by those characters or hyphens (up to 100 characters).',
  },
  ko: {
    nav: '버전 관리',
    scope:
      '변경 사항은 자동 저장되며, 이후 도구와 Forge UI에서 생성할 워크트리에 공통 적용됩니다. 기존 체크아웃과 Git 설정은 변경하지 않습니다.',
    worktree: '워크트리',
    panel: 'Forge 패널',
    directory: '워크트리 디렉터리',
    prefix: '워크트리 이름 접두사',
    directoryHint:
      '저장소 아래의 상대 경로를 /로 구분해 입력하세요. 절대 경로와 . 또는 .. 경로 조각은 지원하지 않습니다.',
    prefixHint: '자동 생성 이름에 사용하며, 시멘틱 브랜치 이름 형식은 지원하지 않습니다.',
    unsupported:
      '공식 Forge 번들은 기존의 커밋 작성자, 커밋 서명, 기본 체크아웃 선택, 추적 중인 원격 브랜치, 보관 시 삭제, 시멘틱 브랜치 이름 설정을 지원하지 않습니다. 이 항목들은 여기서 이전하거나 저장하지 않습니다.',
    empty: '편집할 수 있는 Forge 설정이 없습니다. 먼저 공식 Forge 번들을 활성화하세요.',
    loading: '불러오는 중…',
    saving: '저장 중…',
    saved: '자동 저장됨',
    mixed: '서로 다른 값',
    mixedHint:
      '기존 값이 서로 다릅니다. 항목을 변경하면 도구와 UI 워크트리에 공통 적용하며, 변경하지 않은 항목은 그대로 유지합니다.',
    refresh: '저장된 값 다시 불러오기',
    error: '결과를 확인하지 못했습니다. 저장된 값을 다시 불러온 뒤 재시도하세요.',
    conflict: '다른 곳에서 설정을 변경했습니다. 저장된 값을 다시 불러온 뒤 재시도하세요.',
    invalid:
      '올바른 상대 디렉터리(4096자 이내)를 입력하세요. 접두사는 비우거나 영문자·숫자·밑줄로 시작해 영문자·숫자·밑줄·하이픈으로 100자 이내로 입력하세요.',
  },
  zh: {
    nav: '版本控制',
    scope: '更改会自动保存，并同时应用于之后通过工具和 Forge UI 创建的工作树。不会修改现有检出或 Git 配置。',
    worktree: '工作树',
    panel: 'Forge 面板',
    directory: '工作树目录',
    prefix: '工作树名称前缀',
    directoryHint: '请输入以 / 分隔的仓库内相对目录。不支持绝对路径以及 . 或 .. 路径段。',
    prefixHint: '用于自动生成的名称，不支持语义化分支命名。',
    unsupported:
      '官方 Forge 插件包不支持旧版的提交作者、提交签名、默认检出选择、跟踪远程分支、归档时删除或语义化分支命名设置。此处不会迁移或保存这些设置。',
    empty: '未找到可编辑的 Forge 设置。请先启用官方 Forge 插件包。',
    loading: '正在加载…',
    saving: '正在保存…',
    saved: '已自动保存',
    mixed: '值不一致',
    mixedHint: '现有值不一致。编辑字段会将该值同时应用于工具和 UI 工作树，未编辑的字段保持不变。',
    refresh: '重新加载已保存的值',
    error: '无法确认结果。请重新加载已保存的值后重试。',
    conflict: '设置已在其他位置更改。请重新加载已保存的值后重试。',
    invalid:
      '请输入有效的相对目录（最多 4096 个字符）。前缀可留空，或以 ASCII 字母、数字、下划线开头，后接这些字符或连字符（最多 100 个字符）。',
  },
}
export const localized = (language: string) =>
  copy[language.startsWith('ko') ? 'ko' : language.startsWith('zh') ? 'zh' : 'en']
