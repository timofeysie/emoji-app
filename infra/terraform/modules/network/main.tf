# Network module
#
# Owns:
#   - Default VPC and subnet data sources for staging.
#   - Security groups (emoji-staging-alb-sg, emoji-staging-ecs-sg) and the
#     ingress rule from ALB SG to ECS SG on port 3000.
#
# Status: skeleton only. Resources are added in Milestone T2.
#
# Inputs (planned):
#   - environment (string)
#
# Outputs (planned):
#   - vpc_id
#   - subnet_ids
#   - alb_security_group_id
#   - ecs_security_group_id
