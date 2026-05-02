# ACM module
#
# Owns:
#   - ACM certificate (DNS-validated) for the staging domain.
#   - HTTPS:443 listener on the ALB (added once a domain is decided).
#   - Optional HTTP-to-HTTPS redirect on the existing port 80 listener.
#
# Status: skeleton only. Resources are added in Milestone T7.
#
# Inputs (planned):
#   - domain_name (string)
#   - alb_arn (string)
#   - target_group_arn (string)
#
# Outputs (planned):
#   - certificate_arn
#   - https_listener_arn
