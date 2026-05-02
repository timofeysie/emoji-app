# ALB module
#
# Owns:
#   - Application Load Balancer (existing AWS name: emoji-load-balancer).
#   - Target group (existing AWS name: emoji-staging-tg).
#   - HTTP:80 listener (existing).
#   - HTTPS:443 listener (added in T7).
#
# Status: skeleton only. Resources are added in Milestone T3.
#
# Inputs (planned):
#   - environment (string)
#   - vpc_id (string)
#   - subnet_ids (list(string))
#   - alb_security_group_id (string)
#
# Outputs (planned):
#   - alb_arn
#   - alb_dns_name
#   - target_group_arn
#   - http_listener_arn
