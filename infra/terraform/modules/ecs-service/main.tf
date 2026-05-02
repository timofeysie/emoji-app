# ECS service module
#
# Owns:
#   - CloudWatch log group (/ecs/emoji-staging).
#   - ECS cluster (emoji-staging-cluster).
#   - ECS task definition family (emoji-staging-task).
#   - ECS service (emoji-staging-service) wired to the ALB target group.
#
# Status: skeleton only.
#   - Task definition is re-authored in T5.
#   - Cluster, log group, and service are greenfield in T6.
#
# Inputs (planned):
#   - environment (string)
#   - aws_region (string)
#   - image_uri (string)
#   - cognito_user_pool_id (string)
#   - cognito_app_client_id (string)
#   - cognito_region (string)
#   - execution_role_arn (string)
#   - task_role_arn (string)
#   - target_group_arn (string)
#   - subnet_ids (list(string))
#   - ecs_security_group_id (string)
#   - mongodb_uri_secret_arn (string)
#   - openai_secret_enabled (bool, default false)
#
# Outputs (planned):
#   - cluster_name
#   - service_name
#   - task_definition_arn
