output "certificate_arn" {
  description = "ACM certificate ARN after DNS validation (attach to ALB HTTPS listener)."
  value       = aws_acm_certificate_validation.app.certificate_arn
}
