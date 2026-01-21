export const PUSH_LIMITS = {
  get perTaskMaxPush() { return Number(process.env.PUSH_PER_TASK_MAX ?? 10); },
  get perSourceWindowMinutes() { return Number(process.env.PUSH_PER_SOURCE_WINDOW_MINUTES ?? 10); },
  get perSourceWindowMaxPush() { return Number(process.env.PUSH_PER_SOURCE_WINDOW_MAX ?? 10); },
  get bigBatchThreshold() { return Number(process.env.PUSH_BIG_BATCH_THRESHOLD ?? 50); },
};

