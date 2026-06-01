export const MAIN_TRIGGER_PRESETS = [
  '坐到书桌前',
  '打开任务资料',
  '戴上耳机',
  '打开电脑',
  '开始计时',
  '深呼吸三次后戴上指定物品',
  '自定义',
];

export const AUXILIARY_TRIGGER_PRESETS = [
  '打一个响指',
  '设置一个闹钟',
  '打开任务资料',
  '发送一条消息给自己',
  '戴上耳机',
  '自定义',
];

export const COMPLETION_CONDITION_TEMPLATES = [
  '持续专注到计时结束，期间不主动切换到娱乐内容。',
  '完成一个明确成果，并坚持到计时结束。',
  '完成最低可接受任务量，即使状态不好也不提前退出。',
  '只允许处理与本任务直接相关的资料、笔记和工具。',
];

export const AUXILIARY_COMPLETION_TEMPLATES = [
  '在预约时间结束前启动该主链的正式任务。',
  '预约到期后立即触发主链，不再重新谈判。',
  '到期时若仍未进入主链，自动记录辅助链失败。',
];

export const FAILURE_DEBUG_CATEGORIES = [
  '触发动作太重',
  '完成条件过高',
  '时间太长',
  '环境不适合',
  '规则不清',
  '状态不足',
  '其他',
];
