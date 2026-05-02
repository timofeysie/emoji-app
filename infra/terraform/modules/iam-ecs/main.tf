# IAM ECS module
#
# Owns:
#   - emoji-staging-ecs-execution-role (ECR pull, CloudWatch logs).
#   - emoji-staging-ecs-task-role (Secrets Manager access).
#   - Inline policy emoji-staging-read-secrets on the task role.
#
# Status: skeleton only. Resources are added in Milestone T4.
#
# Inputs (planned):
#   - environment (string)
#   - mongodb_uri_secret_arn (string)
#   - openai_api_key_secret_arn (optional string, see T5 prerequisites)
#
# Outputs (planned):
#   - execution_role_arn
#   - task_role_arn
