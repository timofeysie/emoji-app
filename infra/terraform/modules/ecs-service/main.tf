# ECS service module
#
# Owns (eventually):
#   - CloudWatch log group (T6).
#   - ECS cluster - emoji-staging-cluster (T6).
#   - ECS task definition family - emoji-staging-task (T5, this file family).
#   - ECS service - emoji-staging-service (T6) wired to the ALB target group.
#
# Current scope (T5): only the task definition. See task-definition.tf.
# Cluster, log group, and service are added in T6 and will live in
# additional .tf files in this directory rather than re-opening this module.
