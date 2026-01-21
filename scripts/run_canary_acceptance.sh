
#!/bin/bash
export CANARY_ENABLED="true"
export PUSH_MODE="canary"
export MAX_PUSH_PER_RUN="1"
export PUSH_PER_TASK_MAX="1"
export ONLY_SOURCE="中央民族大学-通知公告"

# Run canary push
npx tsx scripts/canary_push.ts
