variable "environment" {
  description = "Logical environment name used in resource tags."
  type        = string
}

variable "vpc_id" {
  description = "VPC the target group registers against (must be the same VPC the ECS service runs in)."
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs the ALB is attached to. Provide only the subnets you intend the ALB to use, not all available subnets."
  type        = list(string)
}

variable "alb_security_group_id" {
  description = "Security group ID attached to the ALB."
  type        = string
}

variable "enable_https_listener" {
  description = "If true, create :443 listener and redirect :80→HTTPS. Must be known at plan time (do not derive from ACM output alone)."
  type        = bool
  default     = false
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for the HTTPS listener. Required when enable_https_listener is true; may be unknown until apply."
  type        = string
  default     = ""
}

variable "app_dns_name" {
  description = "Public FQDN for the app (Route 53 alias to this ALB). Leave empty to skip DNS. Requires route53_zone_id."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone ID for app_dns_name. Leave empty when app_dns_name is empty."
  type        = string
  default     = ""
}
