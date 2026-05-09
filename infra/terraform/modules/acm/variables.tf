variable "certificate_domain_name" {
  description = "FQDN on the ACM certificate (e.g. emoji-staging.example.com)."
  type        = string
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone ID that is authoritative for DNS validation (same zone or parent as certificate_domain_name)."
  type        = string
}
